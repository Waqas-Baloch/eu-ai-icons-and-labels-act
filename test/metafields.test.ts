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
});
