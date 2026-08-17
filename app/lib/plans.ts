/**
 * Billing plan identifiers.
 *
 * Deliberately kept out of shopify.server.ts: the billing UI renders these in
 * the browser, and importing them from the server module would pull the whole
 * Shopify server config — API secret included — into the client bundle.
 *
 * These strings are the contract between the Shopify Billing API, the
 * `Shop.plan` column and the entitlement checks, so they must not be renamed
 * without a migration. A rename also orphans live subscriptions: billing.check
 * matches on the plan name, so a merchant subscribed under an old name reads
 * as having no active payment.
 *
 * One plan, deliberately. Article 50(4) applies the same to a ten-product store
 * and a ten-thousand-product one — the duty does not scale with catalog size,
 * so metering it by product count would price the obligation rather than the
 * work. It also removes the worst failure mode of a tiered compliance tool: a
 * merchant who hits a ceiling mid-catalog and is left partly labelled.
 */

export const PLANS = {
  UNLIMITED: "Unlimited",
} as const;

export type PlanName = (typeof PLANS)[keyof typeof PLANS];

/** USD per 30 days. Mirrored in the billing config in shopify.server.ts. */
export const PLAN_PRICE_USD = 6.99;

/** Days of full access before the first charge. */
export const PLAN_TRIAL_DAYS = 7;

export interface PlanDetail {
  name: PlanName;
  price: string;
  trialDays: number;
  blurb: string;
  features: string[];
}

export const PLAN_DETAILS: PlanDetail[] = [
  {
    name: PLANS.UNLIMITED,
    price: `$${PLAN_PRICE_USD.toFixed(2)}`,
    trialDays: PLAN_TRIAL_DAYS,
    blurb: "Everything, for one price per store.",
    features: [
      "Unlimited products and images",
      "Official EU AI Act label artwork",
      "Free placement and sizing on every image",
      "Tamper-evident audit trail, exportable as CSV",
      "Automatic re-assessment when you add or change a photo",
    ],
  },
];

export function isPlanName(value: string): value is PlanName {
  return (Object.values(PLANS) as string[]).includes(value);
}
