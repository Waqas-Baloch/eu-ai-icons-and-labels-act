import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  APP_HANDLE,
  PLAN_DETAILS,
  PLAN_PRICE_USD,
  PLAN_TRIAL_DAYS,
  pricingPlansUrl,
} from "~/lib/plans";

describe("plans", () => {
  it("offers exactly one plan", () => {
    expect(PLAN_DETAILS).toHaveLength(1);
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
  // Shopify App Pricing forbids an app from creating its own charges. Calling
  // billing.request() is exactly that, and it is what an App Store reviewer hit
  // as a 401. The app must send merchants to Shopify's plan page instead.
  it("never creates its own subscription", () => {
    // Comments are stripped first: the source deliberately *explains* why
    // billing.request() cannot be used, and a naive substring match would trip
    // over that explanation rather than over a real call.
    const code = (path: string) =>
      readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    const server = code("app/shopify.server.ts");
    const billing = code("app/routes/app.billing.tsx");

    expect(billing).not.toContain("billing.request(");
    expect(server).not.toContain("billing: {");

    // The merchant is sent to Shopify's own plan page, as a plain link.
    expect(billing).toContain("pricingPlansUrl(session.shop)");
    expect(billing).toContain('target="_top"');

    // And not via an action. A fetcher POST + redirect(_top) throws a 401
    // carrying a reauthorize header — App Bridge protocol that any error
    // boundary will render as "401 — Unauthorized" instead of redirecting.
    expect(billing).not.toContain("export const action");
  });

  // A wrong handle sends merchants to a 404 at the moment they try to pay.
  it("builds a plan URL whose handle matches shopify.app.toml", () => {
    const toml = readFileSync("shopify.app.toml", "utf8");
    expect(toml).toContain(`handle = "${APP_HANDLE}"`);

    expect(pricingPlansUrl("nanoapps-uhu4sk0u.myshopify.com")).toBe(
      `https://admin.shopify.com/store/nanoapps-uhu4sk0u/charges/${APP_HANDLE}/pricing_plans`,
    );
  });

  // Under App Pricing the subscription is named by Shopify, so filtering the
  // check by plan name would silently lock a paying merchant out.
  it("checks for any active subscription, not a named plan", () => {
    for (const file of [
      "app/lib/entitlement.server.ts",
      "app/routes/app.billing.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      const call = src.slice(src.indexOf("billing.check({"));
      expect(call.slice(0, 200), file).not.toContain("plans:");
    }
  });

  // The free week is granted at install with no card, and app.billing.tsx
  // passes whatever is left of it to billing.request() per merchant. A standing
  // trial in the config would stack on top and give away fourteen days.


});
