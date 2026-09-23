import type { authenticate } from "~/shopify.server";

import prisma from "~/db.server";
import { accessState, trialDaysRemaining, trialEndFrom } from "~/lib/entitlement";
import type { AccessState } from "~/lib/entitlement";
import { hasAcceptedTerms } from "~/lib/terms.server";
import type { AdminGraphqlClient } from "~/lib/metafields.server";

/**
 * Resolving what a shop is currently entitled to, in one place.
 *
 * The layout loader in routes/app.tsx guards every page, but Remix does not run
 * a parent loader before a child action — so a POST straight to a save endpoint
 * would otherwise write happily for a shop that stopped paying. The write paths
 * call requireUnlocked() for that reason; the gate has to live on both sides.
 *
 * Neither of those runs for a webhook. A product edit arrives with no loader,
 * no action and no billing helper — which is how a shop whose trial had ended
 * thirteen days earlier went on having 213 products labelled for free. That
 * path is gated by mayPublish() below.
 */

type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

export interface Entitlement {
  access: AccessState;
  trialEndsAt: Date | null;
  trialDaysLeft: number;
}

/**
 * "Is this shop paying?", asked however the caller is able to ask it.
 *
 * An embedded request has Shopify's billing helper. A webhook has only an
 * admin client. The rules that surround the question — the trial, the
 * backfill, failing open — are identical either way, so they live here once
 * and the difference is confined to this callback.
 */
type PaymentCheck = () => Promise<boolean>;

async function entitlementWith(
  shopDomain: string,
  checkPayment: PaymentCheck,
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
      hasActivePayment = await checkPayment();
    } catch (error) {
      console.error(
        `[${shopDomain}] billing check failed, granting access:`,
        error instanceof Error ? error.message : error,
      );
      hasActivePayment = true;
    }
  }

  const access = accessState({ trialEndsAt, hasActivePayment, now });

  // Keep Shop.plan truthful. Nothing reads it for entitlement — the live check
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

export async function resolveEntitlement(
  shopDomain: string,
  billing: Billing,
): Promise<Entitlement> {
  return entitlementWith(shopDomain, async () => {
    // No `plans` filter on purpose. Under Shopify App Pricing the plans are
    // defined in the Partner Dashboard, and the subscription comes back named
    // by whatever Shopify chose — the plan's display name or its handle. This
    // app has exactly one plan, so "any active subscription" is the correct
    // question, and asking it this way cannot be broken by a rename.
    // isTest: true means "a test subscription also counts", not "create test
    // charges". Shopify forces test charges on App Store review stores, so a
    // reviewer who subscribes gets an ACTIVE subscription with test: true —
    // and checking with isTest: false discards exactly that, leaving the app
    // insisting they subscribe again. Verified: an active test subscription
    // on the store was not recognised while this was false.
    //
    // Safe, because a merchant cannot create a test charge. Only this app
    // can, and what it creates is governed by SHOPIFY_BILLING_TEST, which
    // stays 0 in production so real merchants are charged for real.
    const check = await billing.check({ isTest: true });
    return check.hasActivePayment;
  });
}

const ACTIVE_SUBSCRIPTIONS = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

/**
 * billing.check(), for callers that do not have it.
 *
 * Reads the same field the billing helper reads, and answers the same way it
 * does: every entry in `activeSubscriptions` counts, without inspecting
 * `status` or `test`.
 *
 * Matching it exactly is the point. This gate decides whether labels reach the
 * storefront while billing.check() decides what the merchant sees in the admin,
 * so any difference between them shows up as a shop being told it is
 * subscribed while its labels quietly stop publishing — a divergence nobody
 * would think to look for. Filtering on status === "ACTIVE" here looked
 * harmless and would have done precisely that to a FROZEN subscription, which
 * the library counts as paying.
 *
 * Throws on transport or GraphQL failure rather than returning false, so the
 * fail-open rule in entitlementWith() applies here too. Returning false on an
 * API blip would silently stop publishing for a paying shop.
 */
export async function hasActiveSubscription(
  admin: AdminGraphqlClient,
): Promise<boolean> {
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS);
  const body = (await response.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: { id: string; name: string; status: string }[];
      } | null;
    };
    errors?: unknown[];
  };

  if (body.errors?.length) {
    throw new Error(`activeSubscriptions query failed: ${JSON.stringify(body.errors)}`);
  }

  const subscriptions =
    body.data?.currentAppInstallation?.activeSubscriptions ?? [];
  return subscriptions.length > 0;
}

export async function resolveEntitlementFromAdmin(
  shopDomain: string,
  admin: AdminGraphqlClient,
): Promise<Entitlement> {
  return entitlementWith(shopDomain, () => hasActiveSubscription(admin));
}

/**
 * Whether this shop may write labels to its own products right now.
 *
 * Two conditions, both of which have to hold, and both of which were being
 * asked in the wrong places:
 *
 *   - Terms accepted. Publishing is what the terms govern; this part was
 *     already enforced here (see app/lib/terms.server.ts).
 *   - Not locked out. Assessment is the app's opinion and costs the merchant
 *     nothing, but publishing to a live storefront is the product — and until
 *     now the only billing gate stood in the embedded UI, so a lapsed shop
 *     kept receiving the product indefinitely through the products/update
 *     webhook.
 *
 * Assessment still runs when this returns false. The result is stored and
 * held back, exactly as it is for unaccepted terms, so subscribing releases
 * everything already known rather than requiring a fresh scan.
 *
 * Without an admin client nothing can be published anyway, so the answer is
 * false and no billing call is made.
 */
export async function mayPublish(
  shopDomain: string,
  admin: AdminGraphqlClient | undefined,
): Promise<boolean> {
  if (!admin) return false;
  if (!(await hasAcceptedTerms(shopDomain))) return false;

  const { access } = await resolveEntitlementFromAdmin(shopDomain, admin);
  return access !== "locked";
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
