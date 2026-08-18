import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  accessState,
  isAlwaysAllowed,
  shopifyTrialDaysFor,
  TRIAL_DAYS,
  trialDaysRemaining,
  trialEndFrom,
} from "~/lib/entitlement";

const at = (iso: string) => new Date(iso);
const INSTALL = at("2026-08-18T09:00:00.000Z");

describe("trialEndFrom", () => {
  it("gives a full week from install", () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(trialEndFrom(INSTALL).toISOString()).toBe("2026-08-25T09:00:00.000Z");
  });

  it("keeps the time of day, so nobody loses hours to rounding", () => {
    expect(trialEndFrom(at("2026-08-18T23:30:00.000Z")).toISOString()).toBe(
      "2026-08-25T23:30:00.000Z",
    );
  });
});

describe("trialDaysRemaining", () => {
  const end = trialEndFrom(INSTALL);

  it("counts down across the week", () => {
    expect(trialDaysRemaining(end, INSTALL)).toBe(7);
    expect(trialDaysRemaining(end, at("2026-08-21T09:00:00.000Z"))).toBe(4);
    expect(trialDaysRemaining(end, at("2026-08-24T09:00:00.000Z"))).toBe(1);
  });

  // Rounds up, so the number shown never reads as expired while the app works.
  it("still reports a day when hours remain", () => {
    expect(trialDaysRemaining(end, at("2026-08-25T03:00:00.000Z"))).toBe(1);
    expect(trialDaysRemaining(end, at("2026-08-25T08:59:59.000Z"))).toBe(1);
  });

  it("is zero at the boundary and after", () => {
    expect(trialDaysRemaining(end, end)).toBe(0);
    expect(trialDaysRemaining(end, at("2026-09-01T00:00:00.000Z"))).toBe(0);
  });

  it("treats a missing end date as no trial", () => {
    expect(trialDaysRemaining(null, INSTALL)).toBe(0);
    expect(trialDaysRemaining(undefined, INSTALL)).toBe(0);
  });
});

describe("accessState", () => {
  const end = trialEndFrom(INSTALL);

  it("is trial inside the free week", () => {
    expect(
      accessState({ trialEndsAt: end, hasActivePayment: false, now: INSTALL }),
    ).toBe("trial");
  });

  it("is locked once the week is over with no subscription", () => {
    expect(
      accessState({
        trialEndsAt: end,
        hasActivePayment: false,
        now: at("2026-08-26T09:00:00.000Z"),
      }),
    ).toBe("locked");
  });

  // The failure that matters most: a paying merchant must never be locked out,
  // whatever the trial dates say.
  it("is subscribed regardless of the trial, even with no trial recorded", () => {
    for (const trialEndsAt of [end, null, at("2020-01-01T00:00:00.000Z")]) {
      expect(
        accessState({
          trialEndsAt,
          hasActivePayment: true,
          now: at("2027-01-01T00:00:00.000Z"),
        }),
      ).toBe("subscribed");
    }
  });
});

describe("isAlwaysAllowed", () => {
  // A locked merchant keeps their own compliance evidence and the way to pay.
  it("allows the record, its export, the terms and the plan page", () => {
    for (const path of [
      "/app/audit",
      "/app/audit-export",
      "/app/terms",
      "/app/billing",
    ]) {
      expect(isAlwaysAllowed(path), path).toBe(true);
    }
  });

  it("blocks every working surface", () => {
    for (const path of [
      "/app",
      "/app/settings",
      "/app/setup",
      "/app/review",
      "/app/products/123",
    ]) {
      expect(isAlwaysAllowed(path), path).toBe(false);
    }
  });

  it("is not fooled by a trailing slash", () => {
    expect(isAlwaysAllowed("/app/billing/")).toBe(true);
    expect(isAlwaysAllowed("/app/")).toBe(false);
  });

  // Prefix matching would let /app/auditor or /app/billing-x through.
  it("matches whole paths, not prefixes", () => {
    expect(isAlwaysAllowed("/app/auditor")).toBe(false);
    expect(isAlwaysAllowed("/app/billing/upgrade")).toBe(false);
  });
});

describe("shopifyTrialDaysFor", () => {
  const end = trialEndFrom(INSTALL);

  // Subscribing early must not cost the merchant the rest of their free week.
  it("hands Shopify the days still left", () => {
    expect(shopifyTrialDaysFor(end, at("2026-08-21T09:00:00.000Z"))).toBe(4);
  });

  it("is zero after the trial, so approval bills immediately", () => {
    expect(shopifyTrialDaysFor(end, at("2026-08-26T09:00:00.000Z"))).toBe(0);
  });

  // The whole point of trialDays: 0 in the billing config — the two trials must
  // never add up to fourteen days.
  it("never exceeds the trial length", () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const now = new Date(INSTALL.getTime() + day * 86_400_000);
      expect(shopifyTrialDaysFor(end, now)).toBeLessThanOrEqual(TRIAL_DAYS);
    }
  });
});

/**
 * A structural check, not a unit test. The page gate in routes/app.tsx cannot
 * cover actions — Remix does not run a parent loader before a child action — so
 * every write endpoint has to opt in by calling requireUnlocked(). That is
 * exactly the kind of step someone adding a route six months from now will not
 * know about, so assert it rather than document it.
 */
describe("write actions are gated", () => {
  // Reachable while locked on purpose: accepting the terms and subscribing are
  // the two things a locked merchant must still be able to do.
  const EXEMPT = new Set(["app.terms.tsx", "app.billing.tsx"]);

  const routesWithActions = readdirSync("app/routes")
    .filter((file) => file.startsWith("app.") && file.endsWith(".tsx"))
    .filter((file) =>
      readFileSync(`app/routes/${file}`, "utf8").includes("export const action"),
    );

  it("finds the action routes at all, so the check cannot pass vacuously", () => {
    expect(routesWithActions.length).toBeGreaterThanOrEqual(5);
  });

  it.each(routesWithActions)("%s calls requireUnlocked or is exempt", (file) => {
    const source = readFileSync(`app/routes/${file}`, "utf8");
    expect(
      EXEMPT.has(file) || source.includes("requireUnlocked("),
      `${file} has an action that writes without an entitlement check`,
    ).toBe(true);
  });
});
