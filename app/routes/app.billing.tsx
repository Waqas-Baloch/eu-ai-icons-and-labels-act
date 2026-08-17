import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { isPlanName, PLANS, PLAN_DETAILS } from "~/lib/plans";
import { boolAttr } from "~/lib/polaris-form";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  const check = await billing.check({
    plans: [PLANS.UNLIMITED],
    isTest: process.env.SHOPIFY_BILLING_TEST !== "0",
  });

  const [productCount, shop] = await Promise.all([
    prisma.productAssessment.count({ where: { shopDomain: session.shop } }),
    prisma.shop.findUnique({ where: { domain: session.shop } }),
  ]);

  return {
    hasActivePayment: check.hasActivePayment,
    activePlans: check.appSubscriptions.map((subscription) => subscription.name),
    productCount,
    trialEndsAt: shop?.trialEndsAt?.toISOString() ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = String(form.get("plan") ?? "");

  if (!isPlanName(plan)) {
    return { ok: false, error: "Unknown plan." };
  }

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    session.shop;

  await appendAudit(session.shop, {
    action: "plan.changed",
    actor,
    payload: { requestedPlan: plan },
  });

  // Throws a redirect to Shopify's confirmation screen; the merchant approves
  // the charge there, and Shopify returns them to the app.
  await billing.request({
    plan,
    isTest: process.env.SHOPIFY_BILLING_TEST !== "0",
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });

  return { ok: true };
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
      <s-section>
        <s-text color="subdued">
          {data.hasActivePayment
            ? `Current plan: ${data.activePlans.join(", ")}`
            : "No active subscription"}
        </s-text>
      </s-section>

      {!data.hasActivePayment && (
        <s-banner tone="info" heading={`${PLAN.trialDays}-day free trial`}>
          <s-paragraph>
            The trial is the full app, not a reduced version, and nothing is
            charged until it ends. Article 50(4) is an ongoing obligation — new
            products need assessing as you add them — so the app keeps working
            in the background once set up.
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
              onClick={() => fetcher.submit({ plan: PLAN.name }, { method: "post" })}
            >
              {busy
                ? "Opening Shopify…"
                : `Start ${PLAN.trialDays}-day free trial`}
            </s-button>
          )}
        </s-stack>

        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <s-banner tone="critical">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}
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
