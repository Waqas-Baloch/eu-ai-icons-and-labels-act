/**
 * Free badge placement geometry.
 *
 * The merchant drags the label anywhere on the image and resizes it, but it
 * must never sit closer than 20px to any edge. Two things make that awkward:
 * the same placement has to hold on a 400px thumbnail and a 2000px hero, and
 * the badge's own width varies with the label (the wide "AI GENERATED" strip
 * versus the square "AI" mark).
 *
 * Both are solved by storing the position as a fraction of the *safe area* and
 * anchoring the badge proportionally to itself:
 *
 *   left      = 20px + x * (100% - 40px)
 *   translate = -x * 100% of the badge's own width
 *
 * At x = 0 the badge's left edge lands on the 20px margin; at x = 1 its right
 * edge lands on the opposite margin; at 0.5 it is centred. The browser resolves
 * both percentages against the rendered image, so the margin is exactly 20px at
 * any size, and nothing needs to know how wide the badge is.
 */

/** Required clear space between the badge and every image edge. */
export const SAFE_MARGIN_PX = 20;

/** Badge height as a percentage of image height. */
export const MIN_HEIGHT_PCT = 2;
export const MAX_HEIGHT_PCT = 20;
export const DEFAULT_HEIGHT_PCT = 6;

export interface BadgePlacement {
  /** 0 = left margin, 1 = right margin. */
  x: number;
  /** 0 = top margin, 1 = bottom margin. */
  y: number;
  /** Badge height as a percentage of the image's height. */
  heightPct: number;
}

export const DEFAULT_PLACEMENT: BadgePlacement = {
  x: 0,
  y: 1,
  heightPct: DEFAULT_HEIGHT_PCT,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Forces a placement into range.
 *
 * Non-finite values collapse to the default rather than propagating NaN into
 * a CSS calc, where they would silently drop the whole declaration and put the
 * badge somewhere unpredictable.
 */
export function clampPlacement(input: Partial<BadgePlacement> | null | undefined): BadgePlacement {
  const safe = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    x: clamp(safe(input?.x, DEFAULT_PLACEMENT.x), 0, 1),
    y: clamp(safe(input?.y, DEFAULT_PLACEMENT.y), 0, 1),
    heightPct: clamp(
      safe(input?.heightPct, DEFAULT_HEIGHT_PCT),
      MIN_HEIGHT_PCT,
      MAX_HEIGHT_PCT,
    ),
  };
}

/** The four corner presets, as placements. */
export const CORNER_PRESETS: Record<string, { x: number; y: number }> = {
  top_left: { x: 0, y: 0 },
  top_right: { x: 1, y: 0 },
  bottom_left: { x: 0, y: 1 },
  bottom_right: { x: 1, y: 1 },
};

/** Maps a legacy corner name onto a placement, for shop defaults. */
export function placementFromCorner(
  corner: string | null | undefined,
  heightPct = DEFAULT_HEIGHT_PCT,
): BadgePlacement {
  const preset = CORNER_PRESETS[corner ?? "bottom_left"] ?? CORNER_PRESETS.bottom_left;
  return clampPlacement({ ...preset, heightPct });
}

/** Names the nearest corner, or null when the badge is not near one. */
export function nearestCorner(placement: BadgePlacement): string | null {
  const snapped = Object.entries(CORNER_PRESETS).find(
    ([, preset]) =>
      Math.abs(preset.x - placement.x) < 0.02 && Math.abs(preset.y - placement.y) < 0.02,
  );
  return snapped ? snapped[0] : null;
}

export interface PlacementStyle {
  left: string;
  top: string;
  height: string;
  transform: string;
}

/**
 * CSS for a placement. Works unchanged at any rendered image size, which is
 * why the margin can be promised in pixels rather than as a percentage.
 */
export function placementToStyle(input: Partial<BadgePlacement>): PlacementStyle {
  const { x, y, heightPct } = clampPlacement(input);
  const span = SAFE_MARGIN_PX * 2;

  return {
    left: `calc(${SAFE_MARGIN_PX}px + ${x} * (100% - ${span}px))`,
    top: `calc(${SAFE_MARGIN_PX}px + ${y} * (100% - ${span}px))`,
    height: `${heightPct}%`,
    // Pulls the badge back by its own size in proportion to the position, so
    // x = 1 aligns its right edge rather than its left.
    transform: `translate(${-x * 100}%, ${-y * 100}%)`,
  };
}

/**
 * Converts a pointer position over the image into a placement fraction.
 *
 * `rect` is the image's bounding box. The usable span is the box inset by the
 * margin on both sides; when an image is rendered narrower than 2x the margin
 * that span collapses, so the fraction falls back to centre rather than
 * dividing by zero.
 */
export function pointerToPlacement(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const spanX = rect.width - SAFE_MARGIN_PX * 2;
  const spanY = rect.height - SAFE_MARGIN_PX * 2;

  const x = spanX > 0 ? (point.clientX - rect.left - SAFE_MARGIN_PX) / spanX : 0.5;
  const y = spanY > 0 ? (point.clientY - rect.top - SAFE_MARGIN_PX) / spanY : 0.5;

  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/**
 * Height percentage implied by dragging a resize handle to a pointer position.
 *
 * Measured from the badge's anchor point outward, so the badge grows away from
 * wherever it is pinned rather than jumping across the image.
 */
export function pointerToHeightPct(
  point: { clientY: number },
  rect: { top: number; height: number },
  placement: BadgePlacement,
): number {
  if (rect.height <= 0) return DEFAULT_HEIGHT_PCT;

  const anchorY = rect.top + SAFE_MARGIN_PX + placement.y * (rect.height - SAFE_MARGIN_PX * 2);
  // Dragging up from a bottom-anchored badge should still enlarge it.
  const distance = Math.abs(point.clientY - anchorY);
  const pct = (distance / rect.height) * 100;

  return clamp(pct, MIN_HEIGHT_PCT, MAX_HEIGHT_PCT);
}
