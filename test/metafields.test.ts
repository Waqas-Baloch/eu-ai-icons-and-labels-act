import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { imageFileKey, numericId } from "../app/lib/metafields.server";

describe("numericId", () => {
  it("extracts the id from a media gid", () => {
    expect(numericId("gid://shopify/MediaImage/123456789")).toBe("123456789");
  });

  it("extracts the id from a product gid", () => {
    expect(numericId("gid://shopify/Product/987")).toBe("987");
  });

  it("returns the input unchanged when there is no trailing number", () => {
    expect(numericId("not-a-gid")).toBe("not-a-gid");
  });
});

describe("imageFileKey", () => {
  it("takes the filename from a CDN URL", () => {
    expect(
      imageFileKey("https://cdn.shopify.com/s/files/1/0001/0001/files/shirt.jpg"),
    ).toBe("shirt.jpg");
  });

  it("drops the version query string", () => {
    expect(
      imageFileKey("https://cdn.shopify.com/s/files/1/0001/files/shirt.jpg?v=1712345678"),
    ).toBe("shirt.jpg");
  });

  it.each([
    ["shirt_800x.jpg", "shirt.jpg"],
    ["shirt_1024x1024.jpg", "shirt.jpg"],
    ["shirt_x800.jpg", "shirt.jpg"],
    ["shirt_grande.jpg", "shirt.jpg"],
    ["shirt_master.png", "shirt.png"],
    ["shirt_pico.webp", "shirt.webp"],
  ])("strips the CDN size suffix from %s", (input, expected) => {
    expect(imageFileKey(`https://cdn.shopify.com/s/files/1/${input}`)).toBe(expected);
  });

  it("is case-insensitive so both sides agree", () => {
    expect(imageFileKey("https://cdn.shopify.com/s/files/1/Shirt_800x.JPG")).toBe(
      "shirt.jpg",
    );
  });

  it("does not mangle a filename that merely contains an x", () => {
    expect(imageFileKey("https://cdn.shopify.com/s/files/1/box_relax.jpg")).toBe(
      "box_relax.jpg",
    );
  });

  it("resolves a resized variant and its original to the same key", () => {
    const original = imageFileKey(
      "https://cdn.shopify.com/s/files/1/0001/files/tee_front.jpg?v=1",
    );
    const resized = imageFileKey(
      "https://cdn.shopify.com/s/files/1/0001/files/tee_front_800x.jpg?v=1",
    );
    expect(resized).toBe(original);
  });
});

describe("storefront/server key parity", () => {
  /**
   * The overlay script re-implements imageFileKey in plain JS because it runs
   * in the theme with no bundler. If the two implementations drift, badges stop
   * matching and simply never render — a silent under-disclosure, which is the
   * exact failure this product exists to prevent. Compare the regex literals.
   */
  it("uses identical normalisation regexes on both sides", () => {
    const serverSource = readFileSync(
      join(process.cwd(), "app/lib/metafields.server.ts"),
      "utf8",
    );
    const clientSource = readFileSync(
      join(
        process.cwd(),
        "extensions/ai-disclosure/assets/eu-ai-disclosure.js",
      ),
      "utf8",
    );

    const extract = (source: string): string[] => [
      ...(source.match(/\/_\(\\d\+x[^\n]*?\/i/g) ?? []),
      ...(source.match(/\/_\(pico\|icon[\s\S]*?\/i/g) ?? []),
    ];

    const serverRegexes = extract(serverSource);
    const clientRegexes = extract(clientSource);

    expect(serverRegexes.length).toBe(2);
    expect(clientRegexes.length).toBe(2);

    const normalise = (list: string[]) =>
      list.map((r) => r.replace(/\s+/g, "")).sort();
    expect(normalise(clientRegexes)).toEqual(normalise(serverRegexes));
  });

  /**
   * Stronger than comparing the regexes: run the storefront's own fileKey()
   * against imageFileKey() on the same URLs. Matching source text would still
   * miss a change to the query-string split or the lowercasing, and either
   * would break matching just as silently.
   */
  it("produces identical keys when actually run, not just identical regexes", () => {
    const clientSource = readFileSync(
      join(
        process.cwd(),
        "extensions/ai-disclosure/assets/eu-ai-disclosure.js",
      ),
      "utf8",
    );

    const start = clientSource.indexOf("function fileKey(url)");
    const end = clientSource.indexOf("function decisionFor");
    expect(start, "fileKey() not found in the overlay script").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fileKey = new Function(
      `${clientSource.slice(start, end)}; return fileKey;`,
    )() as (url: string) => string;

    const CDN = "https://cdn.shopify.com/s/files/1/0001/0001/files";
    const urls = [
      `${CDN}/carrots.jpg`,
      `${CDN}/carrots.jpg?v=1712345678`,
      `${CDN}/carrots_800x.jpg?v=1`,
      `${CDN}/carrots_x800.jpg`,
      `${CDN}/carrots_1024x1024.jpg?v=9`,
      `${CDN}/CARROTS_grande.PNG`,
      `${CDN}/photo_master.webp`,
      `${CDN}/my_small_thing_small.jpg`,
      `${CDN}/box_relax.jpg`,
      `${CDN}/a_b_c.jpg`,
      `${CDN}/pack-of-carrots_2048x2048.jpg?v=1700000000`,
      `${CDN}/with%20space_medium.jpg`,
    ];

    for (const url of urls) {
      expect(fileKey(url), `diverged on ${url}`).toBe(imageFileKey(url));
    }

    // And a sanity check that the corpus is not all trivially equal, which
    // would make the comparison meaningless.
    expect(fileKey(`${CDN}/carrots_800x.jpg?v=1`)).toBe("carrots.jpg");
  });
});

/**
 * The webhook feedback loop.
 *
 * Publishing a decision writes product metafields. That fires products/update,
 * which this app subscribes to and answers by re-assessing the product, which
 * publishes again. Because assessed_at carried a fresh timestamp on every pass,
 * every write was a change and the cycle never converged: roughly 3,000
 * assessments an hour on one merchant's catalogue, 1.37 million audit rows, and
 * a server killed repeatedly by its memory limit.
 *
 * The cycle is broken by writing only when the decision actually changed. These
 * assert the shape of that guard, since a unit test cannot run the loop.
 */
describe("publishing cannot feed itself", () => {
  const source = readFileSync("app/lib/metafields.server.ts", "utf8");
  const scan = readFileSync("app/lib/scan.server.ts", "utf8");

  it("reads the current metafields before writing", () => {
    expect(source).toContain("READ_METAFIELDS");
    expect(source).toContain("const unchanged =");
    expect(source).toContain("if (unchanged) return");
  });

  it("compares state, label and images", () => {
    const guard = source.slice(
      source.indexOf("const unchanged ="),
      source.indexOf("if (unchanged) return"),
    );
    expect(guard).toContain("METAFIELD_KEYS.STATE");
    expect(guard).toContain("METAFIELD_KEYS.LABEL");
    expect(guard).toContain("METAFIELD_KEYS.IMAGES");
  });

  /*
   * assessed_at differs on every assessment. Including it in the comparison
   * would make every write a change again and restore the loop exactly.
   */
  it("excludes assessed_at from the comparison", () => {
    const guard = source.slice(
      source.indexOf("const unchanged ="),
      source.indexOf("if (unchanged) return"),
    );
    expect(guard).not.toContain("ASSESSED_AT");
  });

  // Two encodings of one decision must not read as different.
  it("serialises the image map canonically", () => {
    expect(source).toContain("function canonicalJson");
    expect(source).toContain("value: imagesJson,");
    expect(source).not.toContain("JSON.stringify(imageMap)");
  });

  it("only records an audit entry when something changed", () => {
    expect(scan).toContain("const assessmentChanged =");
    expect(scan).toContain("if (assessmentChanged) await appendAudit");
    expect(scan).toContain("if (published.changed !== false)");
  });
});
