import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Where the terms are enforced.
 *
 * They used to gate the layout loader, so they were the first thing a merchant
 * saw — ahead of any product, any scan, anything worth agreeing to. The only
 * organic install this app has had arrived on 7 September, met that screen, and
 * left without scanning a single product.
 *
 * What the terms actually govern is publishing a disclosure to a live
 * storefront and who answers for it. So the gate sits on the first publish
 * instead, and until then nothing the app decides reaches the merchant's
 * products.
 */
describe("terms gate sits at publish, not at the door", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const code = (path: string) =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("does not block the layout loader", () => {
    const layout = code("app/routes/app.tsx");
    expect(layout).not.toContain('redirectEmbedded(request, "/app/terms")');
    expect(layout).not.toContain("onTermsPage");
  });

  it("blocks the action that applies a label", () => {
    const publish = code("app/routes/app.products.$id.tsx");
    expect(publish).toContain("requireTermsAccepted(session.shop, request)");
  });

  /*
   * Anything that can reach a merchant's products must be covered — either by
   * the gate on the action, or by the publish being held back underneath it.
   * Scanning and changing settings are deliberately not gated: a merchant
   * should be able to explore and configure, and neither publishes until the
   * terms are accepted.
   */
  it.each(
    readdirSync("app/routes")
      .filter((f) => f.startsWith("app.") && f.endsWith(".tsx"))
      .filter((f) => code(`app/routes/${f}`).includes("requireUnlocked(")),
  )("%s cannot publish without the terms", (file) => {
    const src = code(`app/routes/${file}`);
    const gated = src.includes("requireTermsAccepted(");
    // The alternative to gating is calling only paths that hold publishing
    // back themselves — scanCatalog and reassessStored both check.
    const publishesOnlyViaGuardedPaths =
      !src.includes("publishProductDecision(") &&
      !src.includes("applyDeclarationToImages(");
    expect(
      gated || publishesOnlyViaGuardedPaths,
      `${file} can write to products without the terms`,
    ).toBe(true);
  });

  // Reached from the settings page, so it needs its own check rather than
  // relying on a gate one level up.
  it("holds publishing back in reassessStored as well", () => {
    const scan = code("app/lib/scan.server.ts");
    const fn = scan.slice(scan.indexOf("export async function reassessStored"));
    expect(fn.slice(0, 1200)).toContain("await mayPublish(shopDomain, admin)");
    expect(fn).toContain("if (admin && publish)");
  });

  // Assessment is the app's own opinion and costs nothing. Publishing writes to
  // the merchant's products, and that is what the terms cover.
  it("holds publishing back until the terms are accepted", () => {
    const scan = code("app/lib/scan.server.ts");
    expect(scan).toContain("publish = true");
    expect(scan).toContain("const publish = await mayPublish(shopDomain, admin)");
    expect(scan).toContain("const published = publish");
  });

  /*
   * The terms check now lives inside mayPublish(), which also enforces billing.
   * Folding the two together is what closed the webhook hole, but it would be
   * an easy thing to unpick later without noticing that the terms went with it.
   */
  it("keeps the terms check inside mayPublish", () => {
    const entitlement = code("app/lib/entitlement.server.ts");
    const fn = entitlement.slice(
      entitlement.indexOf("export async function mayPublish"),
    );
    expect(fn).toContain("hasAcceptedTerms(shopDomain)");
    expect(fn).toContain("return false");
  });

  // Otherwise the app would show labels the storefront never received.
  it("releases what was held back once the terms are accepted", () => {
    const terms = code("app/routes/app.terms.tsx");
    expect(terms).toContain("reassessStored(shopDomain, admin)");
  });

  // A merchant interrupted mid-task must land back where they were.
  it("returns the merchant to where the gate caught them", () => {
    const gate = read("app/lib/terms.server.ts");
    expect(gate).toContain("?return=");

    const terms = code("app/routes/app.terms.tsx");
    expect(terms).toContain('form.get("return")');
    expect(terms).toContain('requested.startsWith("/app/")');
  });

  /*
   * An open redirect on a page every merchant is sent to would be a gift. The
   * value is validated where it is consumed — the terms route — rather than
   * where it is created, which is our own pathname.
   */
  it("only honours in-app return paths", () => {
    const terms = code("app/routes/app.terms.tsx");
    expect(terms).toContain('requested?.startsWith("/app/")');
    expect(terms).toContain('requested.startsWith("/app/")');
  });

  it("still bounds the republish, since it runs inside a request", () => {
    const scan = code("app/lib/scan.server.ts");
    const fn = scan.slice(scan.indexOf("export async function reassessStored"));
    expect(fn.slice(0, 900)).toContain("SCAN_TIME_BUDGET_MS");
    expect(fn.slice(0, 1600)).toContain("Date.now() > deadline");
  });
});
