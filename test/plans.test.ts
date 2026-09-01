import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  adminAppUrl,
  APP_HANDLE,
  PLAN_DETAILS,
  PLAN_NAME,
  PLAN_PRICE_USD,
  PLAN_TRIAL_DAYS,
} from "~/lib/plans";

describe("plans", () => {
  // Comments are stripped: the source deliberately explains why certain calls
  // are avoided, and a naive substring match would trip over the explanation.
  const code = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("offers exactly one plan", () => {
    expect(PLAN_DETAILS).toHaveLength(1);
  });

  it("is $6.99 per month with a 7-day trial", () => {
    expect(PLAN_PRICE_USD).toBe(6.99);
    expect(PLAN_TRIAL_DAYS).toBe(7);
  });

  it("displays the price it charges", () => {
    expect(PLAN_DETAILS[0].price).toBe("$6.99");
    expect(PLAN_DETAILS[0].name).toBe(PLAN_NAME);
    expect(PLAN_DETAILS[0].trialDays).toBe(PLAN_TRIAL_DAYS);
  });

  // The displayed price and the charged amount live in different files. If
  // shopify.server.ts ever goes back to a literal, the merchant can be shown
  // one number and billed another — which is the one billing bug that is not
  // recoverable by apologising.
  /*
   * The app creates its own subscription through the Billing API.
   *
   * Verified against the live shop: appSubscriptionCreate succeeds and returns
   * a confirmation URL, so this app is not on Shopify App Pricing — the public
   * plan in the App Store listing is metadata describing the price, and
   * /charges/<handle>/pricing_plans 404s because no managed plan exists.
   */
  it("creates the subscription itself and returns the confirmation URL", () => {
    const billing = code("app/routes/app.billing.tsx");

    expect(billing).toContain("appSubscriptionCreate");
    expect(billing).toContain("confirmationUrl");
    expect(billing).toContain("PLAN_NAME");
    expect(billing).toContain("PLAN_PRICE_USD");
  });

  /*
   * Not billing.request(). It throws a redirect, which for a fetcher becomes a
   * bare 401 carrying a reauthorize header — App Bridge protocol that any error
   * boundary renders as "401 — Unauthorized". That is the failure an App Store
   * reviewer reported.
   */
  it("never routes the subscription through a thrown redirect", () => {
    const billing = code("app/routes/app.billing.tsx");
    expect(billing).not.toContain("billing.request(");
    expect(billing).not.toContain('target: "_top"');
  });

  // The merchant must always be able to reach Shopify, even if the automatic
  // top-frame navigation is refused for want of user activation.
  it("offers a visible link when the top frame cannot be moved", () => {
    const billing = code("app/routes/app.billing.tsx");
    expect(billing).toContain('window.open(confirmationUrl, "_top")');
    expect(billing).toContain('href={confirmationUrl}');
  });

  /*
   * Where Shopify sends the merchant after they approve the charge.
   *
   * SHOPIFY_APP_URL carries no shop, host or embedded parameters, so a merchant
   * returning to it cannot be identified and is bounced to the login form and
   * asked to type a myshopify domain. An App Store reviewer hit exactly that
   * after approving, on a bare page outside the admin.
   */
  it("returns the merchant into the embedded admin, not the bare app URL", () => {
    const billing = code("app/routes/app.billing.tsx");

    expect(billing).toContain('adminAppUrl(session.shop, "/app/billing")');
    expect(billing).not.toContain("${process.env.SHOPIFY_APP_URL}/app/billing");
  });

  it("builds an admin URL whose handle matches shopify.app.toml", () => {
    const toml = readFileSync("shopify.app.toml", "utf8");
    expect(toml).toContain(`handle = "${APP_HANDLE}"`);

    expect(adminAppUrl("nanoapps-uhu4sk0u.myshopify.com", "/app/billing")).toBe(
      `https://admin.shopify.com/store/nanoapps-uhu4sk0u/apps/${APP_HANDLE}/app/billing`,
    );
    // Works without a path too, for a plain "open the app" link.
    expect(adminAppUrl("cool-shop.myshopify.com")).toBe(
      `https://admin.shopify.com/store/cool-shop/apps/${APP_HANDLE}`,
    );
  });

  // Under any pricing model the subscription may be named by Shopify, so
  // filtering the entitlement check by plan name can lock out a paying shop.
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
