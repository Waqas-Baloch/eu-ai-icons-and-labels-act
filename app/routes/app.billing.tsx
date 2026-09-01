import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import {
  adminAppUrl,
  PLAN_DETAILS,
  PLAN_NAME,
  PLAN_PRICE_USD,
} from "~/lib/plans";
import { appendAudit } from "~/lib/audit.server";
import {
  accessState,
  shopifyTrialDaysFor,
  trialDaysRemaining,
} from "~/lib/entitlement";
import { formatDateTime } from "~/lib/display";
import { boolAttr } from "~/lib/polaris-form";

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

const SUBSCRIPTION_CREATE = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
    ) {
      confirmationUrl
      userErrors { field message }
    }
  }
`;

/**
 * Starts a subscription and hands the confirmation URL back to the browser.
 *
 * Deliberately not billing.request(). That helper throws a redirect, and for a
 * fetcher submission the redirect becomes a bare 401 carrying
 * X-Shopify-API-Request-Failure-Reauthorize-Url — App Bridge protocol rather
 * than a failure. Anything that renders thrown responses turns it into a page
 * reading "401 — Unauthorized", which is exactly what an App Store reviewer
 * reported and what this app's own error boundary was doing.
 *
 * Returning the URL as data instead keeps the outcome visible: the page can
 * navigate the top frame itself, and can show the merchant a link if that is
 * blocked. Nothing depends on a status code being interpreted correctly.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });

  // Hand Shopify whatever is left of our own free week, so subscribing early
  // costs the merchant nothing: the first charge still falls at the end of the
  // week they were promised. Zero once the trial has run out.
  const trialDays = shopifyTrialDaysFor(shop?.trialEndsAt, new Date());

  const response = await admin.graphql(SUBSCRIPTION_CREATE, {
    variables: {
      name: PLAN_NAME,
      // Back into the embedded app, not the bare app URL — see adminAppUrl().
      returnUrl: adminAppUrl(session.shop, "/app/billing"),
      test: process.env.SHOPIFY_BILLING_TEST !== "0",
      trialDays,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: PLAN_PRICE_USD, currencyCode: "USD" },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });

  const body = (await response.json()) as {
    data?: {
      appSubscriptionCreate?: {
        confirmationUrl?: string | null;
        userErrors?: { field?: string[]; message: string }[];
      };
    };
  };

  const result = body.data?.appSubscriptionCreate;
  const userErrors = result?.userErrors ?? [];

  if (userErrors.length || !result?.confirmationUrl) {
    const message =
      userErrors.map((error) => error.message).join(" ") ||
      "Shopify did not return a confirmation link. Please try again.";
    return { confirmationUrl: null, error: message };
  }

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    session.shop;

  await appendAudit(session.shop, {
    action: "plan.changed",
    actor,
    payload: { requestedPlan: PLAN_NAME, trialDays },
  });

  return { confirmationUrl: result.confirmationUrl, error: null };
};

// The only plan. Named here so the component reads as "the plan", not "a plan".
const PLAN = PLAN_DETAILS[0];

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const confirmationUrl = fetcher.data?.confirmationUrl ?? null;
  const error = fetcher.data?.error ?? null;

  /*
   * Take the merchant to Shopify's approval screen.
   *
   * It lives in the admin, outside this iframe, so the top frame has to move.
   * A frame is only allowed to do that with user activation, and the click that
   * started this may no longer count by the time the response lands — so if the
   * attempt is refused, the link below is rendered and the merchant clicks
   * once more. Either way they get there, and neither path depends on a status
   * code being interpreted correctly.
   */
  useEffect(() => {
    if (!confirmationUrl) return;
    try {
      window.open(confirmationUrl, "_top");
    } catch {
      // Blocked. The fallback link is already on screen.
    }
  }, [confirmationUrl]);

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
            You have the full app, not a reduced version. Subscribing now does
            not shorten the trial — your first charge still falls at the end of
            it.
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
            <s-stack direction="block" gap="small">
              <s-button
                variant="primary"
                disabled={boolAttr(busy)}
                onClick={() => fetcher.submit({}, { method: "post" })}
              >
                {busy ? "Opening Shopify…" : "Subscribe"}
              </s-button>

              {confirmationUrl && (
                <s-paragraph>
                  <s-link href={confirmationUrl} target="_top">
                    Continue to Shopify to approve the charge
                  </s-link>
                </s-paragraph>
              )}

              {error && (
                <s-banner tone="critical">
                  <s-paragraph>{error}</s-paragraph>
                </s-banner>
              )}
            </s-stack>
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
