import { describe, expect, it } from "vitest";

import {
  clampPlacement,
  CORNER_PRESETS,
  DEFAULT_HEIGHT_PCT,
  DEFAULT_PLACEMENT,
  MAX_HEIGHT_PCT,
  MIN_HEIGHT_PCT,
  nearestCorner,
  placementFromCorner,
  placementToStyle,
  pointerToHeightPct,
  pointerToPlacement,
  SAFE_MARGIN_PX,
} from "../app/lib/badge-layout";

describe("clampPlacement", () => {
  it("keeps a valid placement untouched", () => {
    expect(clampPlacement({ x: 0.3, y: 0.7, heightPct: 8 })).toEqual({
      x: 0.3,
      y: 0.7,
      heightPct: 8,
    });
  });

  it("clamps positions into the unit range", () => {
    expect(clampPlacement({ x: -3, y: 42, heightPct: 6 })).toMatchObject({ x: 0, y: 1 });
  });

  it("clamps size to the allowed band", () => {
    expect(clampPlacement({ heightPct: 0.1 }).heightPct).toBe(MIN_HEIGHT_PCT);
    expect(clampPlacement({ heightPct: 900 }).heightPct).toBe(MAX_HEIGHT_PCT);
  });

  it("falls back to defaults for missing input", () => {
    expect(clampPlacement(undefined)).toEqual(DEFAULT_PLACEMENT);
    expect(clampPlacement(null)).toEqual(DEFAULT_PLACEMENT);
    expect(clampPlacement({})).toEqual(DEFAULT_PLACEMENT);
  });

  it("rejects non-finite values rather than passing NaN into CSS", () => {
    // A NaN in a calc() drops the whole declaration, which would silently put
    // the badge in an arbitrary place instead of failing visibly.
    const result = clampPlacement({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      heightPct: Number.NaN,
    });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    expect(result.heightPct).toBe(DEFAULT_HEIGHT_PCT);
  });

  it("coerces non-numeric input", () => {
    const result = clampPlacement({ x: "0.5" as unknown as number });
    expect(result.x).toBe(DEFAULT_PLACEMENT.x);
  });
});

describe("placementToStyle", () => {
  it("puts the badge exactly on the margin at the top-left extreme", () => {
    const style = placementToStyle({ x: 0, y: 0, heightPct: 6 });
    expect(style.left).toContain(`${SAFE_MARGIN_PX}px + 0 *`);
    expect(style.transform).toBe("translate(0%, 0%)");
  });

  it("anchors the opposite edge at the far extreme", () => {
    // At x = 1 the badge is pulled back by its full width, so its right edge —
    // not its left — sits on the margin. That is what keeps the 20px promise
    // without knowing how wide the badge is.
    const style = placementToStyle({ x: 1, y: 1, heightPct: 6 });
    expect(style.transform).toBe("translate(-100%, -100%)");
    expect(style.left).toContain(`${SAFE_MARGIN_PX}px + 1 *`);
  });

  it("centres at the midpoint", () => {
    const style = placementToStyle({ x: 0.5, y: 0.5, heightPct: 6 });
    expect(style.transform).toBe("translate(-50%, -50%)");
  });

  it("reserves the margin on both sides of the span", () => {
    const style = placementToStyle({ x: 0.5, y: 0.5, heightPct: 6 });
    expect(style.left).toContain(`100% - ${SAFE_MARGIN_PX * 2}px`);
    expect(style.top).toContain(`100% - ${SAFE_MARGIN_PX * 2}px`);
  });

  it("expresses size as a percentage so it scales with the image", () => {
    expect(placementToStyle({ heightPct: 7.5 }).height).toBe("7.5%");
  });

  it("never emits NaN in a calc expression", () => {
    const style = placementToStyle({ x: Number.NaN, y: Number.NaN, heightPct: Number.NaN });
    for (const value of Object.values(style)) {
      expect(value).not.toMatch(/NaN/);
    }
  });
});

describe("corner presets", () => {
  it("maps each corner to an extreme of the safe area", () => {
    expect(CORNER_PRESETS.top_left).toEqual({ x: 0, y: 0 });
    expect(CORNER_PRESETS.top_right).toEqual({ x: 1, y: 0 });
    expect(CORNER_PRESETS.bottom_left).toEqual({ x: 0, y: 1 });
    expect(CORNER_PRESETS.bottom_right).toEqual({ x: 1, y: 1 });
  });

  it("builds a placement from a corner name", () => {
    expect(placementFromCorner("top_right", 9)).toEqual({ x: 1, y: 0, heightPct: 9 });
  });

  it("falls back to bottom left for an unknown corner", () => {
    expect(placementFromCorner("middle")).toMatchObject({ x: 0, y: 1 });
    expect(placementFromCorner(null)).toMatchObject({ x: 0, y: 1 });
  });

  it("recognises when a free placement has landed on a corner", () => {
    expect(nearestCorner({ x: 0, y: 1, heightPct: 6 })).toBe("bottom_left");
    expect(nearestCorner({ x: 0.999, y: 0.001, heightPct: 6 })).toBe("top_right");
  });

  it("returns null for a genuinely free placement", () => {
    expect(nearestCorner({ x: 0.4, y: 0.6, heightPct: 6 })).toBeNull();
  });
});

describe("pointerToPlacement", () => {
  const rect = { left: 100, top: 50, width: 420, height: 420 };
  // Usable span is 420 - 40 = 380 on each axis.

  it("maps a pointer on the top-left margin to the origin", () => {
    const result = pointerToPlacement(
      { clientX: 100 + SAFE_MARGIN_PX, clientY: 50 + SAFE_MARGIN_PX },
      rect,
    );
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
  });

  it("maps a pointer on the opposite margin to 1", () => {
    const result = pointerToPlacement(
      { clientX: 100 + 420 - SAFE_MARGIN_PX, clientY: 50 + 420 - SAFE_MARGIN_PX },
      rect,
    );
    expect(result.x).toBeCloseTo(1, 5);
    expect(result.y).toBeCloseTo(1, 5);
  });

  it("maps the centre to 0.5", () => {
    const result = pointerToPlacement({ clientX: 310, clientY: 260 }, rect);
    expect(result.x).toBeCloseTo(0.5, 5);
    expect(result.y).toBeCloseTo(0.5, 5);
  });

  it("clamps a pointer dragged outside the image", () => {
    const far = pointerToPlacement({ clientX: -900, clientY: 9000 }, rect);
    expect(far).toEqual({ x: 0, y: 1 });
  });

  it("does not divide by zero on an image narrower than the margins", () => {
    const tiny = { left: 0, top: 0, width: 10, height: 10 };
    const result = pointerToPlacement({ clientX: 5, clientY: 5 }, tiny);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(result).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("pointerToHeightPct", () => {
  const rect = { top: 0, height: 400 };

  it("grows as the pointer moves away from the anchor", () => {
    const placement = { x: 0, y: 0, heightPct: 6 };
    const near = pointerToHeightPct({ clientY: 40 }, rect, placement);
    const far = pointerToHeightPct({ clientY: 90 }, rect, placement);
    expect(far).toBeGreaterThan(near);
  });

  it("grows when dragging upward from a bottom-anchored badge", () => {
    // Anchor for y = 1 sits near the bottom margin; dragging up must enlarge,
    // not collapse to the minimum.
    const placement = { x: 0, y: 1, heightPct: 6 };
    const result = pointerToHeightPct({ clientY: 260 }, rect, placement);
    expect(result).toBeGreaterThan(MIN_HEIGHT_PCT);
  });

  it("stays within the allowed band", () => {
    const placement = { x: 0, y: 0, heightPct: 6 };
    expect(pointerToHeightPct({ clientY: 20 }, rect, placement)).toBeGreaterThanOrEqual(
      MIN_HEIGHT_PCT,
    );
    expect(pointerToHeightPct({ clientY: 5000 }, rect, placement)).toBe(MAX_HEIGHT_PCT);
  });

  it("survives a zero-height rect", () => {
    const result = pointerToHeightPct({ clientY: 10 }, { top: 0, height: 0 }, DEFAULT_PLACEMENT);
    expect(result).toBe(DEFAULT_HEIGHT_PCT);
  });
});
