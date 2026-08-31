import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { PLAN_DETAILS, pricingPlansUrl } from "~/lib/plans";
import { accessState, trialDaysRemaining } from "~/lib/entitlement";
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
    planUrl: pricingPlansUrl(session.shop),
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

/*
 * There is deliberately no action here.
 *
 * The obvious implementation — POST, then redirect(planUrl, {target: "_top"})
 * — does not work from a fetcher. For a data request that helper throws a 401
 * carrying X-Shopify-API-Request-Failure-Reauthorize-Url, which is a signal for
 * App Bridge rather than a failure. Anything that renders thrown responses,
 * including this app's own root ErrorBoundary, turns that signal into an error
 * page reading "401 — Unauthorized".
 *
 * A plain link avoids the whole exchange: the merchant clicks, the browser
 * navigates the top frame, and no request reaches this app at all.
 */
// The only plan. Named here so the component reads as "the plan", not "a plan".
const PLAN = PLAN_DETAILS[0];

export default function Billing() {
  const data = useLoaderData<typeof loader>();
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
            // target="_top" because the plan page lives in the Shopify admin,
            // outside this app's iframe and will not render inside it. A
            // user-initiated click may navigate the top frame.
            <s-button variant="primary" href={data.planUrl} target="_top">
              Choose a plan
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
