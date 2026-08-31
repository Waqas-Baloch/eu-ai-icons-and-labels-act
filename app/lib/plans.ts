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

import { TRIAL_DAYS } from "./entitlement";

/**
 * The app handle, as it appears in shopify.app.toml.
 *
 * Needed to build the Shopify App Pricing plan page URL. A test asserts the two
 * stay in step, because a wrong handle here sends merchants to a 404 at exactly
 * the moment they are trying to pay.
 */
export const APP_HANDLE = "eu-ai-icons-and-labels-act";

/**
 * Where a merchant chooses and approves a plan.
 *
 * Under Shopify App Pricing the plans live in the Partner Dashboard and Shopify
 * runs the checkout. The app does not — and may not — create the subscription
 * itself: once App Pricing is enabled, appSubscriptionCreate is rejected with
 * "Managed Pricing Apps cannot use the Billing API". That rejection is what an
 * App Store reviewer saw as a 401 when trying to subscribe.
 *
 * The page lives in the Shopify admin, outside this app's iframe, so it must be
 * opened with target "_top".
 */
export function pricingPlansUrl(shopDomain: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

/** USD per 30 days. Mirrored in the billing config in shopify.server.ts. */
export const PLAN_PRICE_USD = 6.99;

/**
 * Days of full access before the first charge.
 *
 * Aliased from lib/entitlement.ts, which owns the trial: it is granted at
 * install with no card, not by Shopify, so the rules that read it live with the
 * access checks rather than with the price.
 */
export const PLAN_TRIAL_DAYS = TRIAL_DAYS;

export interface PlanDetail {
  name: string;
  price: string;
  trialDays: number;
  blurb: string;
  features: string[];
}

export const PLAN_DETAILS: PlanDetail[] = [
  {
    name: "Unlimited",
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
