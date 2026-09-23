import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hasActiveSubscription } from "~/lib/entitlement.server";

/**
 * The billing gate on publishing.
 *
 * It used to exist in exactly one place: the layout loader in routes/app.tsx.
 * That guards the embedded UI and nothing else — so when a trial ended the
 * merchant lost the admin screens while the products/update webhook carried on
 * assessing and publishing labels to their storefront, free, indefinitely.
 *
 * Observed in production, not hypothesised: a shop whose trial had expired
 * thirteen days earlier had 213 products published and 846 images assessed in
 * the fortnight that followed, the most recent a few hours before this was
 * written. It had no reason to ever subscribe, because it already had the
 * entire product.
 *
 * The gate now sits on the publish itself, in mayPublish(), which every path
 * that can write to a merchant's products goes through.
 */

const stub = (body: unknown) => ({
  graphql: async () => new Response(JSON.stringify(body)),
});

const subscriptions = (nodes: { status: string; name?: string }[]) =>
  stub({
    data: {
      currentAppInstallation: {
        activeSubscriptions: nodes.map((node, index) => ({
          id: `gid://shopify/AppSubscription/${index}`,
          name: node.name ?? "Unlimited",
          status: node.status,
        })),
      },
    },
  });

describe("hasActiveSubscription", () => {
  it("sees an active subscription", async () => {
    expect(await hasActiveSubscription(subscriptions([{ status: "ACTIVE" }]))).toBe(
      true,
    );
  });

  it("is false when the shop has none", async () => {
    expect(await hasActiveSubscription(subscriptions([]))).toBe(false);
  });

  /*
   * A reviewer's subscription is a test subscription — Shopify forces those on
   * App Store review stores. An earlier version of the billing check discarded
   * them and told a reviewer who had just paid to subscribe again. Nothing here
   * filters on `test`, and that is deliberate.
   */
  it("counts a review store's test subscription", async () => {
    const body = {
      data: {
        currentAppInstallation: {
          activeSubscriptions: [
            { id: "gid://x/1", name: "Unlimited", status: "ACTIVE", test: true },
          ],
        },
      },
    };
    expect(await hasActiveSubscription(stub(body))).toBe(true);
  });

  // Renaming the plan must not orphan a paying shop, so the name is not read.
  it("does not care what the plan is called", async () => {
    expect(
      await hasActiveSubscription(
        subscriptions([{ status: "ACTIVE", name: "Something Else Entirely" }]),
      ),
    ).toBe(true);
  });

  /*
   * Deliberately the same answer billing.check() gives, which counts every
   * entry in activeSubscriptions without looking at `status` (see
   * subscriptionMeetsCriteria in @shopify/shopify-api's billing/check).
   *
   * These two gates have to agree. billing.check() decides what the merchant
   * sees in the admin; this one decides whether labels reach the storefront.
   * A shop told it is subscribed while its labels silently stop publishing is
   * a failure nobody would think to look for — and filtering on
   * status === "ACTIVE" here, which looks obviously correct, would do exactly
   * that to a FROZEN subscription.
   */
  it("agrees with billing.check rather than second-guessing status", async () => {
    expect(
      await hasActiveSubscription(subscriptions([{ status: "FROZEN" }])),
    ).toBe(true);
  });

  it("survives a shop with no app installation record", async () => {
    expect(
      await hasActiveSubscription(stub({ data: { currentAppInstallation: null } })),
    ).toBe(false);
  });

  /*
   * Throws rather than returning false, so that entitlementWith()'s fail-open
   * rule applies. Swallowing the error here would silently stop publishing for
   * a paying merchant during an API blip — the one direction of error this app
   * must not take, because the merchant would not find out until a customer or
   * a regulator did.
   */
  it("throws on a GraphQL error instead of reporting 'not subscribed'", async () => {
    await expect(
      hasActiveSubscription(stub({ errors: [{ message: "Throttled" }] })),
    ).rejects.toThrow(/activeSubscriptions query failed/);
  });
});

describe("every path that publishes goes through the gate", () => {
  const code = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  // The three places that decide whether a publish happens. If a fourth
  // appears, it has to make the same call.
  it("resolves publishing through mayPublish and nothing else", () => {
    const scan = code("app/lib/scan.server.ts");
    const decisions = scan.match(/publish = await \w+\(/g) ?? [];

    expect(decisions.length).toBeGreaterThanOrEqual(2);
    for (const decision of decisions) {
      expect(decision).toBe("publish = await mayPublish(");
    }
    // assessProductById passes the answer straight through as an argument.
    expect(scan).toContain("await mayPublish(shopDomain, admin),");
  });

  /*
   * The webhook is the path that was open. It has no loader, no action and no
   * billing helper, so nothing above it was ever going to catch this.
   */
  it("covers the products/update webhook", () => {
    const webhook = code("app/routes/webhooks.products.upsert.tsx");
    expect(webhook).toContain("assessProductById(admin, shop, productId)");

    const scan = code("app/lib/scan.server.ts");
    const fn = scan.slice(scan.indexOf("export async function assessProductById"));
    expect(fn).toContain("mayPublish(shopDomain, admin)");
  });

  // Without this the merchant pays and sees nothing change, because the labels
  // held back while they were locked are still only in our database.
  it("releases held-back labels when the merchant subscribes", () => {
    const layout = code("app/routes/app.tsx");
    expect(layout).toContain("const planBefore = shop?.plan");
    expect(layout).toContain('access === "subscribed" && planBefore !== "subscribed"');
    expect(layout).toContain("reassessStored(shopDomain, admin)");
  });

  /*
   * The transition has to be read before resolveEntitlement() writes Shop.plan,
   * and in the parent loader, which runs first on the way back from Shopify. In
   * the billing route the transition would already have been consumed.
   */
  it("reads the previous plan before the entitlement check overwrites it", () => {
    const layout = code("app/routes/app.tsx");
    expect(layout.indexOf("const planBefore")).toBeLessThan(
      layout.indexOf("await resolveEntitlement("),
    );
  });
});

/*
 * A compliance tool that stops working quietly is worse than one that stops
 * visibly. A merchant who is not told will go on believing their catalog is
 * covered while a newly added AI image sits on their storefront undisclosed —
 * so the lock has to say, in plain words, that labelling has stopped.
 */
describe("the lock is visible to the merchant", () => {
  const source = readFileSync("app/routes/app.billing.tsx", "utf8");
  // JSX wraps prose wherever the line happened to run out, so a sentence is
  // only a substring of the file once the line breaks are flattened.
  const copy = source.replace(/\s+/g, " ");

  it("says labelling has stopped, not merely that the trial ended", () => {
    expect(source).toContain('heading="Labelling has stopped"');
    expect(copy).toContain("no new labels are being published to your storefront");
  });

  it("warns that a new image will not be labelled", () => {
    expect(copy).toContain(
      "add or replace a product image now, it will not be assessed",
    );
  });

  it("tells them how much is waiting, and that subscribing releases it", () => {
    expect(source).toContain("data.heldBack");
    expect(source).toContain("lastAssessedAt: { gt: shop.trialEndsAt }");
    expect(copy).toContain("Subscribing publishes all of them straight away");
    expect(copy).toContain("you do not need to scan again");
  });

  // Both promises the plan page makes about a locked shop must survive.
  it("still promises existing labels and the audit trail", () => {
    expect(copy).toContain("every label already on your storefront keeps showing");
    expect(copy).toContain("audit trail stays readable and exportable");
  });
});
