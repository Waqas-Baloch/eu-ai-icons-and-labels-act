import type { authenticate } from "~/shopify.server";

import prisma from "~/db.server";
import { accessState, trialDaysRemaining, trialEndFrom } from "~/lib/entitlement";
import type { AccessState } from "~/lib/entitlement";

/**
 * Resolving what a shop is currently entitled to, in one place.
 *
 * The layout loader in routes/app.tsx guards every page, but Remix does not run
 * a parent loader before a child action — so a POST straight to a save endpoint
 * would otherwise write happily for a shop that stopped paying. The write paths
 * call requireUnlocked() for that reason; the gate has to live on both sides.
 */

type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

export interface Entitlement {
  access: AccessState;
  trialEndsAt: Date | null;
  trialDaysLeft: number;
}

export async function resolveEntitlement(
  shopDomain: string,
  billing: Billing,
): Promise<Entitlement> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });

  // Shops installed before the trial existed have no end date. Backfill from
  // their install date rather than from now, so an old install cannot mint
  // itself a fresh free week simply by being opened today.
  let trialEndsAt = shop?.trialEndsAt ?? null;
  if (shop && !trialEndsAt) {
    trialEndsAt = trialEndFrom(shop.installedAt);
    await prisma.shop.update({
      where: { domain: shopDomain },
      data: { trialEndsAt },
    });
  }

  const now = new Date();
  const trialDaysLeft = trialDaysRemaining(trialEndsAt, now);

  // Only ask Shopify about the subscription once the free week is over. During
  // the trial the answer cannot change the outcome, and the layout loader runs
  // on every navigation — an unnecessary API call there is paid on every click.
  //
  // Fails open. If Shopify cannot be reached the honest answer is "unknown",
  // and of the two ways to be wrong, locking out a paying merchant during an
  // API blip is far worse than a lapsed one keeping access until the next load.
  let hasActivePayment = false;
  if (trialDaysLeft === 0) {
    try {
      // No `plans` filter on purpose. Under Shopify App Pricing the plans are
      // defined in the Partner Dashboard, and the subscription comes back named
      // by whatever Shopify chose — the plan's display name or its handle. This
      // app has exactly one plan, so "any active subscription" is the correct
      // question, and asking it this way cannot be broken by a rename.
      const check = await billing.check({
        isTest: process.env.SHOPIFY_BILLING_TEST !== "0",
      });
      hasActivePayment = check.hasActivePayment;
    } catch (error) {
      console.error(
        `[${shopDomain}] billing check failed, granting access:`,
        error instanceof Error ? error.message : error,
      );
      hasActivePayment = true;
    }
  }

  const access = accessState({ trialEndsAt, hasActivePayment, now });

  // Keep Shop.plan truthful. Nothing reads it for entitlement — billing.check
  // is the source of truth — but it was previously never written at all, so the
  // column said "none" for paying shops and would mislead anyone reading the
  // table. It records whether the shop is paying, not which plan: under Shopify
  // App Pricing the plan is Shopify's to name, not ours. Written only when it
  // changes, so this is a no-op on the overwhelming majority of loads.
  const plan = access === "subscribed" ? "subscribed" : "none";
  if (shop && shop.plan !== plan) {
    await prisma.shop.update({ where: { domain: shopDomain }, data: { plan } });
  }

  return { access, trialEndsAt, trialDaysLeft };
}

/**
 * Refuse a write from a shop whose trial ended without a subscription.
 *
 * Returns 402 rather than redirecting: these are fetcher submissions, and a
 * redirect to the plan page would be followed silently by the client router,
 * leaving the merchant looking at a form that appears to have saved nothing for
 * no stated reason.
 */
export async function requireUnlocked(
  shopDomain: string,
  billing: Billing,
): Promise<void> {
  const { access } = await resolveEntitlement(shopDomain, billing);
  if (access === "locked") {
    throw new Response(
      "Your free trial has ended. Subscribe on the Plan page to continue.",
      { status: 402, statusText: "Payment Required" },
    );
  }
}
