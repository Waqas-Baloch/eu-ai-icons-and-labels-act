/**
 * Billing plan identifiers.
 *
 * Deliberately kept out of shopify.server.ts: the billing UI renders these in
 * the browser, and importing them from the server module would pull the whole
 * Shopify server config — API secret included — into the client bundle.
 *
 * These strings are the contract between the Shopify Billing API, the
 * `Shop.plan` column and the entitlement checks, so they must not be renamed
 * without a migration.
 */

export const PLANS = {
  STARTER: "Starter",
  GROWTH: "Growth",
  SCALE: "Scale",
} as const;

export type PlanName = (typeof PLANS)[keyof typeof PLANS];

export interface PlanDetail {
  name: PlanName;
  price: string;
  products: string;
  blurb: string;
  /** Assessed-product ceiling; null means unlimited. */
  productLimit: number | null;
}

export const PLAN_DETAILS: PlanDetail[] = [
  {
    name: PLANS.STARTER,
    price: "$19",
    products: "Up to 100 products",
    blurb: "For small catalogs with occasional AI imagery.",
    productLimit: 100,
  },
  {
    name: PLANS.GROWTH,
    price: "$49",
    products: "Up to 1,000 products",
    blurb: "For stores generating product imagery regularly.",
    productLimit: 1000,
  },
  {
    name: PLANS.SCALE,
    price: "$149",
    products: "Unlimited products",
    blurb: "For large catalogs and multi-market stores.",
    productLimit: null,
  },
];

export function isPlanName(value: string): value is PlanName {
  return (Object.values(PLANS) as string[]).includes(value);
}
