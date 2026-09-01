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
 * The plan name sent to Shopify, and shown on the merchant's invoice.
 *
 * This app creates its own subscription through the Billing API. It is not on
 * Shopify App Pricing: the "public plan" declared in the App Store listing is
 * listing metadata describing the price, not a managed-pricing configuration.
 * Verified directly — appSubscriptionCreate succeeds against the live shop and
 * returns a confirmation URL, and the /charges/<handle>/pricing_plans page
 * 404s precisely because no managed plan exists to render.
 */
export const PLAN_NAME = "Unlimited";

/**
 * The app handle, exactly as it appears in shopify.app.toml.
 *
 * A test asserts the two stay in step: a wrong handle here sends a merchant who
 * has just paid to a 404.
 */
export const APP_HANDLE = "eu-ai-icons-and-labels-act";

/**
 * The app's own URL *inside the Shopify admin*.
 *
 * Anywhere Shopify sends a merchant back to this app must use this, not
 * SHOPIFY_APP_URL. The raw app URL carries no shop, host or embedded params, so
 * authenticate.admin() cannot tell which shop is asking and redirects to the
 * login form — which is how a reviewer, having just approved a charge, ended up
 * being asked to type in a myshopify domain on a bare page outside the admin.
 *
 * This URL lands them back in the embedded app, with Shopify supplying the
 * parameters that make the session resolvable.
 */
export function adminAppUrl(shopDomain: string, path = ""): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${storeHandle}/apps/${APP_HANDLE}${path}`;
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
    name: PLAN_NAME,
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
