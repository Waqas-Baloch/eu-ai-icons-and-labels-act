import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { PLAN_DETAILS, pricingPlansUrl } from "~/lib/plans";
import { accessState, trialDaysRemaining } from "~/lib/entitlement";
import { boolAttr } from "~/lib/polaris-form";
import { formatDateTime } from "~/lib/display";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  // No `plans` filter: Shopify names the subscription under App Pricing, and
  // this app has exactly one plan, so any active subscription is the answer.
  const check = await billing.check({
    isTest: process.env.SHOPIFY_BILLING_TEST !== "0",
  });

  const [productCount, shop] = await Promise.all([
    prisma.productAssessment.count({ where: { shopDomain: session.shop } }),
    prisma.shop.findUnique({ where: { domain: session.shop } }),
  ]);

  const now = new Date();
  const trialDaysLeft = trialDaysRemaining(shop?.trialEndsAt, now);

  return {
    hasActivePayment: check.hasActivePayment,
    activePlans: check.appSubscriptions.map((subscription) => subscription.name),
    productCount,
    trialEndsAt: shop?.trialEndsAt?.toISOString() ?? null,
    trialDaysLeft,
    access: accessState({
      trialEndsAt: shop?.trialEndsAt,
      hasActivePayment: check.hasActivePayment,
      now,
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    session.shop;

  await appendAudit(session.shop, {
    action: "plan.changed",
    actor,
    payload: { action: "opened Shopify plan selection" },
  });

  // Send the merchant to Shopify's own plan page rather than creating the
  // subscription here.
  //
  // This app is on Shopify App Pricing: the plan is defined in the Partner
  // Dashboard and Shopify runs the checkout. An app with App Pricing enabled is
  // forbidden from calling appSubscriptionCreate — Shopify rejects it with
  // "Managed Pricing Apps cannot use the Billing API", which an App Store
  // reviewer saw as a 401 when trying to subscribe. billing.request() is
  // exactly that call, so it cannot be used here.
  //
  // target "_top" because the plan page lives in the Shopify admin, outside
  // this app's iframe, and will not render inside it.
  throw redirect(pricingPlansUrl(session.shop), { target: "_top" });
};

// The only plan. Named here so the component reads as "the plan", not "a plan".
const PLAN = PLAN_DETAILS[0];

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  // hasActivePayment covers the trial too: Shopify reports a subscription in
  // its trial period as active, which is what we want — the merchant has
  // subscribed and should not be asked to again.
  const isSubscribed = data.hasActivePayment || data.activePlans.includes(PLAN.name);

  return (
    <s-page heading="Plan">
      {/*
        Three states, three different things the merchant needs to know: how
        long they have left, that they are paying, or what they have lost and
        how to get it back.
      */}
      {data.access === "subscribed" && (
        <s-section>
          <s-text color="subdued">
            Current plan: {data.activePlans.join(", ") || PLAN.name}
          </s-text>
        </s-section>
      )}

      {data.access === "trial" && (
        <s-banner
          tone={data.trialDaysLeft <= 2 ? "warning" : "info"}
          heading={
            data.trialDaysLeft === 1
              ? "1 day left in your free trial"
              : `${data.trialDaysLeft} days left in your free trial`
          }
        >
          <s-paragraph>
            No card needed until it ends
            {data.trialEndsAt ? ` on ${formatDateTime(data.trialEndsAt)}` : ""}.
            You have the full app, not a reduced version. There is no need to
            choose a plan before then — if you do, billing starts straight away
            rather than when the trial would have ended.
          </s-paragraph>
        </s-banner>
      )}

      {data.access === "locked" && (
        <s-banner tone="critical" heading="Your free trial has ended">
          <s-paragraph>
            Subscribe to assess products and publish labels again. Two things
            continue regardless: every label already on your storefront keeps
            showing, and your audit trail stays readable and exportable.
          </s-paragraph>
        </s-banner>
      )}

      {/*
        One plan, so this is a description rather than a comparison. Nothing
        here asks the merchant to work out which tier their catalog falls into.
      */}
      <s-section heading="Plan">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small">
            <s-heading>{PLAN.name}</s-heading>
            <s-text type="strong">
              {PLAN.price} USD per month, per store
            </s-text>
            <s-text color="subdued">{PLAN.blurb}</s-text>
          </s-stack>

          <s-stack direction="block" gap="small-100">
            {PLAN.features.map((feature) => (
              <s-text key={feature}>• {feature}</s-text>
            ))}
          </s-stack>

          <s-paragraph>
            <s-text color="subdued">
              Your catalog currently has {data.productCount} assessed product
              {data.productCount === 1 ? "" : "s"}, and there is no limit on how
              many you assess.
            </s-text>
          </s-paragraph>

          {isSubscribed ? (
            <s-badge tone="success">Subscribed</s-badge>
          ) : (
            <s-button
              variant="primary"
              disabled={boolAttr(busy)}
              onClick={() => fetcher.submit({}, { method: "post" })}
            >
              {busy ? "Opening Shopify…" : "Choose a plan"}
            </s-button>
          )}
        </s-stack>
      </s-section>

      <s-section heading="What you keep">
        <s-paragraph>
          Your audit trail belongs to you. Export it as CSV at any time. If you
          uninstall the app, Shopify sends a shop redaction request 48 hours
          later and the record is deleted — export it first if you need to retain
          evidence of what was disclosed while it was live.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
