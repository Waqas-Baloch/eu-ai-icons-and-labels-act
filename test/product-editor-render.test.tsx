import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProductEditor, type EditorImage } from "~/components/ProductEditor";

/**
 * Renders the editor with the shape a freshly scanned product actually has.
 *
 * Every badge field is null, because nothing has been placed yet, and every
 * image is unresolved. That is the state of literally every product the first
 * time a merchant opens it — and it was never covered, because the fixtures
 * used until now all had placements already saved.
 */
const freshImage = (i: number): EditorImage => ({
  imageId: `gid://shopify/MediaImage/${i}`,
  imageUrl: `https://cdn.shopify.com/s/files/1/0/candle-0${i}.jpg?v=1`,
  altText: `Candle view ${i}`,
  position: i - 1,
  isFeatured: i === 1,
  disclosureState: "unknown",
  labelVariant: "ai",
  labelOverride: null,
  badgeStyle: null,
  badgeX: null,
  badgeY: null,
  badgeHeightPct: null,
  declaredOrigin: null,
  declaredRealism: null,
});

function render(images: EditorImage[]) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <ProductEditor
          images={images}
          defaults={{ corner: "bottom_left", style: "black" }}
        />
      ),
    },
  ]);
  return renderToString(<RouterProvider router={router} />);
}

describe("ProductEditor renders a freshly scanned product", () => {
  it("does not throw on images with no placement saved", () => {
    expect(() => render([freshImage(1), freshImage(2), freshImage(3)])).not.toThrow();
  });

  it("produces visible markup, not an empty tree", () => {
    const html = render([freshImage(1), freshImage(2), freshImage(3)]);
    expect(html.length).toBeGreaterThan(200);
    expect(html).toContain("candle-01.jpg");
  });

  it("survives a product with a single image", () => {
    expect(() => render([freshImage(1)])).not.toThrow();
  });

  it("survives a product with no images at all", () => {
    expect(() => render([])).not.toThrow();
  });
});
