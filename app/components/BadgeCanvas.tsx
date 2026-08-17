import { useCallback, useRef, useState } from "react";

import {
  clampPlacement,
  placementToStyle,
  pointerToHeightPct,
  pointerToPlacement,
  SAFE_MARGIN_PX,
  type BadgePlacement,
} from "~/lib/badge-layout";
import { badgeAssetName } from "~/lib/display";

export interface BadgeCanvasProps {
  imageUrl: string;
  alt: string;
  /** Which official label to draw. */
  labelVariant: string;
  /** Which artwork variant. */
  badgeStyle: string;
  placement: BadgePlacement;
  onChange: (placement: BadgePlacement) => void;
  /**
   * Whether this image is marked as AI-generated. False hides the badge
   * entirely, so ticking and unticking is visible immediately.
   */
  showBadge: boolean;
}

type Mode = "idle" | "move" | "resize";

/** Corner handles, in the order they are drawn. */
const HANDLES = ["nw", "ne", "sw", "se"] as const;

/** How far an arrow key nudges the badge, as a fraction of the safe area. */
const NUDGE = 0.02;

/**
 * The image with its badge, draggable and resizable.
 *
 * The stage wraps the image exactly, so the browser resolves the badge's
 * percentage position and the 20px keep-out against the picture itself rather
 * than a padded container. All the arithmetic lives in badge-layout.ts; this
 * component only turns pointer events into placements.
 *
 * Selecting the badge draws a bounding box with corner handles. The artwork
 * itself is never decorated — the selection chrome is drawn outside it and
 * disappears on deselect.
 */
export function BadgeCanvas({
  imageUrl,
  alt,
  labelVariant,
  badgeStyle,
  placement,
  onChange,
  showBadge,
}: BadgeCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [selected, setSelected] = useState(false);

  const asset = badgeAssetName(labelVariant, badgeStyle);
  const style = placementToStyle(placement);
  const visible = showBadge && Boolean(asset);

  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      if (mode === "idle") return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (mode === "move") {
        onChange(clampPlacement({ ...placement, ...pointerToPlacement(event, rect) }));
      } else {
        onChange(
          clampPlacement({
            ...placement,
            heightPct: pointerToHeightPct(event, rect, placement),
          }),
        );
      }
    },
    [mode, onChange, placement],
  );

  const start = (next: Mode) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(true);
    // Capture so a fast drag that leaves the stage keeps tracking.
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setMode(next);
  };

  const end = (event: React.PointerEvent) => {
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    setMode("idle");
  };

  function onKeyDown(event: React.KeyboardEvent) {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    };
    const delta = deltas[event.key];
    if (delta) {
      event.preventDefault();
      onChange(
        clampPlacement({
          ...placement,
          x: placement.x + delta[0],
          y: placement.y + delta[1],
        }),
      );
      return;
    }
    if (event.key === "Escape") setSelected(false);
  }

  return (
    <div className="ed-stage-wrap">
      <div
        ref={stageRef}
        className={`ed-stage${mode !== "idle" ? " ed-stage--active" : ""}${
          visible ? "" : " ed-stage--empty"
        }`}
        onPointerMove={handleMove}
        onPointerUp={end}
        onPointerCancel={end}
        // Clicking the picture itself drops the selection, as in any canvas.
        onPointerDown={() => setSelected(false)}
      >
        <img className="ed-photo" src={imageUrl} alt={alt} draggable={false} />

        {/* The 20px keep-out, shown only while the merchant is moving things. */}
        <div className="ed-safe" aria-hidden="true" />

        {visible && (
          <span
            className={`ed-badge${selected ? " ed-badge--selected" : ""}`}
            style={{
              left: style.left,
              top: style.top,
              height: style.height,
              transform: style.transform,
            }}
            onPointerDown={start("move")}
            role="button"
            tabIndex={0}
            aria-label={`Badge position. Arrow keys move it. Currently ${Math.round(
              placement.x * 100,
            )}% across, ${Math.round(placement.y * 100)}% down, ${placement.heightPct.toFixed(
              1,
            )}% tall. Stays at least ${SAFE_MARGIN_PX} pixels from every edge.`}
            onFocus={() => setSelected(true)}
            onKeyDown={onKeyDown}
          >
            <img src={`/badges/${asset}`} alt="" />

            {selected &&
              HANDLES.map((corner) => (
                <span
                  key={corner}
                  className={`ed-handle ed-handle--${corner}`}
                  onPointerDown={start("resize")}
                  aria-hidden="true"
                />
              ))}
          </span>
        )}
      </div>
    </div>
  );
}
