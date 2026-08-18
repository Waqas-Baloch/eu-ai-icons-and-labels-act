import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  isPlanName,
  PLANS,
  PLAN_DETAILS,
  PLAN_PRICE_USD,
  PLAN_TRIAL_DAYS,
} from "~/lib/plans";

describe("plans", () => {
  it("offers exactly one plan", () => {
    expect(Object.keys(PLANS)).toHaveLength(1);
    expect(PLAN_DETAILS).toHaveLength(1);
    expect(PLAN_DETAILS[0].name).toBe(PLANS.UNLIMITED);
  });

  it("is $6.99 per month with a 7-day trial", () => {
    expect(PLAN_PRICE_USD).toBe(6.99);
    expect(PLAN_TRIAL_DAYS).toBe(7);
  });

  it("displays the price it charges", () => {
    expect(PLAN_DETAILS[0].price).toBe("$6.99");
    expect(PLAN_DETAILS[0].trialDays).toBe(PLAN_TRIAL_DAYS);
  });

  // The displayed price and the charged amount live in different files. If
  // shopify.server.ts ever goes back to a literal, the merchant can be shown
  // one number and billed another — which is the one billing bug that is not
  // recoverable by apologising.
  it("bills the price it displays", () => {
    const server = readFileSync("app/shopify.server.ts", "utf8");

    expect(server).toContain("amount: PLAN_PRICE_USD");
    expect(server).toContain("[PLANS.UNLIMITED]");
  });

  // The free week is granted at install with no card, and app.billing.tsx
  // passes whatever is left of it to billing.request() per merchant. A standing
  // trial in the config would stack on top and give away fourteen days.
  it("declares no standing Shopify trial, so the two cannot stack", () => {
    const server = readFileSync("app/shopify.server.ts", "utf8");
    expect(server).toContain("trialDays: 0");

    const billing = readFileSync("app/routes/app.billing.tsx", "utf8");
    expect(billing).toContain("trialDays,");
    expect(billing).toContain("shopifyTrialDaysFor");
  });

  describe("isPlanName", () => {
    it("accepts the current plan", () => {
      expect(isPlanName("Unlimited")).toBe(true);
    });

    // These named live subscriptions before the move to one plan. billing.check
    // matches on the name, so anything still carrying an old one reads as
    // unsubscribed rather than silently keeping access.
    it("rejects the retired tier names", () => {
      for (const retired of ["Starter", "Growth", "Scale"]) {
        expect(isPlanName(retired)).toBe(false);
      }
    });

    it("rejects arbitrary input", () => {
      for (const value of ["", "unlimited", "UNLIMITED", "free"]) {
        expect(isPlanName(value)).toBe(false);
      }
    });
  });
});
