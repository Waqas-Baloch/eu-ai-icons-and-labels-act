import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { isPlanName, PLANS, PLAN_DETAILS, type PlanName } from "~/lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  const check = await billing.check({
    plans: [PLANS.STARTER, PLANS.GROWTH, PLANS.SCALE],
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

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

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
        <s-banner tone="info" heading="14-day free trial">
          <s-paragraph>
            Every plan starts with a 14-day trial. Article 50(4) is an ongoing
            obligation — new products need assessing as you add them — so the app
            keeps working in the background once set up.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Plans">
        <s-paragraph>
          Your catalog currently has {data.productCount} assessed product
          {data.productCount === 1 ? "" : "s"}.
        </s-paragraph>

        <s-stack direction="inline" gap="base" alignItems="stretch">
          {PLAN_DETAILS.map((plan) => {
            const active = data.activePlans.includes(plan.name);
            return (
              <s-box key={plan.name} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>{plan.name}</s-heading>
                  <s-text type="strong">{plan.price} / month</s-text>
                  <s-text color="subdued">{plan.products}</s-text>
                  <s-paragraph>{plan.blurb}</s-paragraph>
                  {active ? (
                    <s-badge tone="success">Current plan</s-badge>
                  ) : (
                    <s-button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        fetcher.submit({ plan: plan.name }, { method: "post" })
                      }
                    >
                      {data.hasActivePayment ? "Switch to this plan" : "Start trial"}
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            );
          })}
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
