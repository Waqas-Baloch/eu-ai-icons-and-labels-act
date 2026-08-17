import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-remix/server";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { ensureMetafieldDefinitions } from "~/lib/metafields.server";
import { TERMS_VERSION } from "~/lib/terms";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const existing = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    include: { settings: true },
  });

  if (!existing) {
    // First load after install: create the shop, its default settings and the
    // metafield definitions the theme extension reads. The guided setup then
    // takes over from the dashboard.
    await prisma.shop.create({
      data: { domain: shopDomain, settings: { create: {} } },
    });
    await appendAudit(shopDomain, {
      action: "app.installed",
      actor: "system",
      payload: { shop: shopDomain },
    });
    await ensureMetafieldDefinitions(admin);
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
    throw redirect("/app/terms");
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
  };
};

export default function AppLayout() {
  const { pendingReview, onboardingComplete } = useLoaderData<typeof loader>();

  return (
    <>
      {/*
        Products is the home screen and the only working surface. The old
        review queue is now a filter on that list rather than a separate page,
        so there is one place to go and one mental model: pick a product, answer
        its images.
      */}
      <NavMenu>
        <Link to="/app" rel="home">
          Products
        </Link>
        {/* Setup stays in the nav until finished, then disappears rather than
            lingering as a permanently ticked-off item. */}
        {!onboardingComplete && <Link to="/app/setup">Setup</Link>}
        {pendingReview > 0 && (
          <Link to="/app?filter=review">Needs review ({pendingReview})</Link>
        )}
        <Link to="/app/audit">Audit trail</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/billing">Plan</Link>
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
