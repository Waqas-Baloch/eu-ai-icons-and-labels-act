import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { ensureMetafieldDefinitions } from "~/lib/metafields.server";
import { TERMS_VERSION } from "~/lib/terms";
import { redirectEmbedded } from "~/lib/embedded-redirect.server";
import { isAlwaysAllowed, trialEndFrom } from "~/lib/entitlement";
import { resolveEntitlement } from "~/lib/entitlement.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const existing = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    include: { settings: true },
  });

  if (!existing) {
    // First load after install: create the shop, its default settings and the
    // metafield definitions the theme extension reads. The guided setup then
    // takes over from the dashboard.
    // The free week starts now. Stored rather than derived from installedAt
    // so that changing TRIAL_DAYS later cannot retroactively lengthen or cut
    // short a trial already under way, and so support can extend one shop.
    await prisma.shop.create({
      data: {
        domain: shopDomain,
        trialEndsAt: trialEndFrom(new Date()),
        settings: { create: {} },
      },
    });
    await appendAudit(shopDomain, {
      action: "app.installed",
      actor: "system",
      payload: { shop: shopDomain },
    });

    // Metafield definitions are a convenience, not a precondition: the
    // storefront reads the metafield values whether or not a definition exists.
    // Letting a failure here escape would turn a cosmetic problem into an app
    // that will not open at all, on the merchant's very first visit.
    try {
      await ensureMetafieldDefinitions(admin);
    } catch (error) {
      console.error(
        `[${shopDomain}] metafield definitions failed on install:`,
        error instanceof Error ? error.message : error,
      );
    }
  } else if (!existing.settings) {
    await prisma.settings.create({ data: { shopDomain } });
  }

  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    include: { settings: true },
  });

  // Hard gate. Nothing in the app is usable until the current terms are
  // accepted — a merchant must not be able to publish a disclosure decision to
  // a live storefront before agreeing who is responsible for it. Enforced in
  // the layout loader so it covers every child route, including any added later.
  const url = new URL(request.url);
  const onTermsPage = url.pathname === "/app/terms";
  if (!onTermsPage && shop?.termsVersion !== TERMS_VERSION) {
    throw redirectEmbedded(request, "/app/terms");
  }

  const { access, trialDaysLeft } = await resolveEntitlement(
    shopDomain,
    billing,
  );

  // Second gate, after terms. Locked shops keep their audit trail and its
  // export — see isAlwaysAllowed() — and every label already published stays
  // on the storefront, because the theme extension reads product metafields
  // and never asks about billing.
  if (access === "locked" && !isAlwaysAllowed(url.pathname)) {
    throw redirectEmbedded(request, "/app/billing");
  }

  const pendingReview = await prisma.imageAssessment.count({
    where: { shopDomain, disclosureState: "unknown" },
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    shopDomain,
    pendingReview,
    onboardingComplete: Boolean(shop?.onboardingCompletedAt),
    termsAccepted: shop?.termsVersion === TERMS_VERSION,
    access,
    trialDaysLeft,
  };
};

export default function AppLayout() {
  const { pendingReview, onboardingComplete, access, trialDaysLeft } =
    useLoaderData<typeof loader>();

  // A locked shop is redirected away from the working pages, so listing them
  // would only offer links that bounce straight back to the plan page. What
  // stays is what still works: their record, the terms, and how to subscribe.
  const locked = access === "locked";

  return (
    <>
      {/*
        Products is the home screen and the only working surface. The old
        review queue is now a filter on that list rather than a separate page,
        so there is one place to go and one mental model: pick a product, answer
        its images.
      */}
      <NavMenu>
        {/*
          rel="home" must stay on the first link whatever the state — App Bridge
          uses it to resolve the app's root, not merely to style the item.
        */}
        <Link to={locked ? "/app/billing" : "/app"} rel="home">
          {locked ? "Plan" : "Products"}
        </Link>
        {!locked && (
          <>
            {/* Setup stays in the nav until finished, then disappears rather
                than lingering as a permanently ticked-off item. */}
            {!onboardingComplete && <Link to="/app/setup">Setup</Link>}
            {pendingReview > 0 && (
              <Link to="/app?filter=review">Needs review ({pendingReview})</Link>
            )}
          </>
        )}
        <Link to="/app/audit">Audit trail</Link>
        {!locked && <Link to="/app/settings">Settings</Link>}
        {!locked && (
          <Link to="/app/billing">
            {access === "trial"
              ? `Plan (${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left)`
              : "Plan"}
          </Link>
        )}
        <Link to="/app/terms">Terms</Link>
      </NavMenu>
      <Outlet />
    </>
  );
}

// Shopify needs its own error and header boundaries so that auth redirects
// inside the embedded frame are handled rather than rendered as errors.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
