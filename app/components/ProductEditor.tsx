import { useMemo, useState } from "react";
import { useFetcher } from "@remix-run/react";

import { BadgeCanvas } from "./BadgeCanvas";
import {
  clampPlacement,
  CORNER_PRESETS,
  DEFAULT_HEIGHT_PCT,
  MAX_HEIGHT_PCT,
  MIN_HEIGHT_PCT,
  placementFromCorner,
  type BadgePlacement,
} from "~/lib/badge-layout";
import { describeCorner, describeLabel, describeStyle } from "~/lib/display";
import { BADGE_STYLES, SELECTABLE_LABELS } from "~/lib/compliance/types";
import { matchChoice } from "~/lib/quick-choices";

export interface EditorImage {
  imageId: string;
  imageUrl: string;
  altText: string | null;
  position: number;
  isFeatured: boolean;
  disclosureState: string;
  labelVariant: string;
  labelOverride: string | null;
  badgeStyle: string | null;
  badgeX: number | null;
  badgeY: number | null;
  badgeHeightPct: number | null;
  declaredOrigin: string | null;
  declaredRealism: string | null;
}

export interface ProductEditorProps {
  images: EditorImage[];
  defaults: { corner: string; style: string };
}

/** Everything the toolbox controls for one image. */
interface BadgeSetup {
  labelType: string;
  style: string;
  placement: BadgePlacement;
}

function shopDefaultSetup(defaults: { corner: string; style: string }): BadgeSetup {
  return {
    labelType: "ai_generated",
    style: defaults.style,
    placement: placementFromCorner(defaults.corner, DEFAULT_HEIGHT_PCT),
  };
}

/**
 * The setup an image has of its own, or null if it has never been given one.
 *
 * "Of its own" means saved to the database by a previous apply. An image
 * without one is still waiting to inherit.
 */
function savedSetup(
  image: EditorImage,
  defaults: { corner: string; style: string },
): BadgeSetup | null {
  const hasPlacement = image.badgeX !== null && image.badgeY !== null;
  const ownLabel =
    image.labelOverride ?? (image.labelVariant !== "none" ? image.labelVariant : null);

  if (!hasPlacement && !image.badgeStyle && !ownLabel) return null;

  return {
    labelType: ownLabel ?? "ai_generated",
    style: image.badgeStyle ?? defaults.style,
    placement: hasPlacement
      ? clampPlacement({
          x: image.badgeX as number,
          y: image.badgeY as number,
          heightPct: image.badgeHeightPct ?? undefined,
        })
      : placementFromCorner(defaults.corner, image.badgeHeightPct ?? undefined),
  };
}

/**
 * The editing dashboard.
 *
 * Left: the image being edited, with the badge dragged and resized directly on
 * it. Right: the toolbox. Above: the product's images, where the merchant ticks
 * the ones they consider AI-generated.
 *
 * Selection and editing are deliberately separate. Ticking an image says
 * something about the world — this photo was made with AI — and that is what
 * ends up in the audit trail. Where the badge sits is only presentation. Mixing
 * them would let a merchant change a legal declaration by dragging a graphic.
 *
 * --- How a setup reaches an image ------------------------------------------
 *
 * Three layers, checked in order:
 *
 *   1. a draft — an edit made to that image during this session
 *   2. its saved setup — written by a previous apply
 *   3. the template — the FIRST image's setup
 *
 * The template is deliberately pinned to the first image rather than being
 * "whatever the toolbox last held". An earlier version did the latter, and the
 * template drifted: adjusting image 2 silently became the pattern for images 3
 * and 4. Pinning it means the first image defines the house style for the
 * product, and adjusting any other image is a local exception that changes
 * nothing else.
 *
 * Drafts are per image, so edits survive switching away and back. Nothing here
 * writes to the server — that is what the apply buttons are for.
 */
export function ProductEditor({ images, defaults }: ProductEditorProps) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; applied?: number }>();
  const busy = fetcher.state !== "idle";

  // Pre-tick anything already declared as AI, so reopening the editor shows
  // the merchant's previous view rather than a blank slate.
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        images
          .filter((image) => {
            const choice = matchChoice(image);
            return choice === "generated" || choice === "edited";
          })
          .map((image) => image.imageId),
      ),
  );

  const [activeId, setActiveId] = useState<string>(() => images[0]?.imageId ?? "");
  const [drafts, setDrafts] = useState<Record<string, BadgeSetup>>({});

  const active = useMemo(
    () => images.find((image) => image.imageId === activeId) ?? images[0],
    [images, activeId],
  );

  /** The first image's setup: the pattern every uncustomised image follows. */
  const template = useMemo<BadgeSetup>(() => {
    const first = images[0];
    if (!first) return shopDefaultSetup(defaults);
    return (
      drafts[first.imageId] ?? savedSetup(first, defaults) ?? shopDefaultSetup(defaults)
    );
  }, [images, drafts, defaults]);

  /** What the toolbox is showing for the image being edited. */
  const setup = useMemo<BadgeSetup>(() => {
    if (!active) return template;
    return drafts[active.imageId] ?? savedSetup(active, defaults) ?? template;
  }, [active, drafts, defaults, template]);

  /** Records an edit against the active image only. */
  function edit(patch: Partial<BadgeSetup>) {
    if (!active) return;
    setDrafts((previous) => ({
      ...previous,
      [active.imageId]: { ...setup, ...patch },
    }));
  }

  function setPlacement(placement: BadgePlacement) {
    edit({ placement });
  }

  /** Fields describing this setup, shared by every write. */
  function setupFields(data: FormData, value: BadgeSetup) {
    data.set("labelOverride", value.labelType);
    data.set("badgeStyle", value.style);
    data.set("badgeX", String(value.placement.x));
    data.set("badgeY", String(value.placement.y));
    data.set("badgeHeightPct", String(value.placement.heightPct));
    // Ticking an image is the merchant saying it is AI-generated and realistic
    // — the declaration the label rests on.
    data.set("origin", value.labelType === "ai_modified" ? "ai_modified" : "ai_generated");
    data.set("realism", "realistic");
    data.set("context", "commercial");
    if (value.labelType === "ai_modified") data.set("editScope", "substantial");
  }

  /**
   * Ticking an image applies the label immediately; unticking removes it.
   *
   * The checkbox is the declaration — a deliberate act by the merchant, not an
   * inference — so it persists straight away rather than waiting for a save.
   * Local state updates first so the badge appears or disappears on the click,
   * and the write follows; the loader revalidation then confirms it.
   */
  function toggle(imageId: string) {
    const willSelect = !selected.has(imageId);

    setSelected((previous) => {
      const next = new Set(previous);
      if (willSelect) next.add(imageId);
      else next.delete(imageId);
      return next;
    });

    const data = new FormData();
    data.append("imageIds", imageId);

    if (willSelect) {
      data.set("intent", "apply");
      // Whatever that image would show: its own setup if it has one, else the
      // template. Not the toolbox, which may be displaying a different image.
      const image = images.find((candidate) => candidate.imageId === imageId);
      const value =
        drafts[imageId] ??
        (image ? savedSetup(image, defaults) : null) ??
        template;
      setupFields(data, value);
    } else {
      data.set("intent", "clear");
      data.set("origin", "not_ai");
      // Clear any manual label choice too, or effectiveLabel() forces the old
      // label back on and the badge survives the declaration.
      data.set("labelOverride", "");
    }

    fetcher.submit(data, { method: "post" });
  }

  /**
   * Commits the badge design to the ticked images, or to just the active one.
   *
   * Only ever touches images the merchant selected. Unticking is the way to
   * clear a label, and it already acts on the click.
   */
  function save(applyToSelected: boolean) {
    const targets = applyToSelected
      ? Array.from(selected)
      : active
        ? [active.imageId]
        : [];
    if (targets.length === 0) return;

    const data = new FormData();
    data.set("intent", "apply");
    for (const id of targets) data.append("imageIds", id);
    setupFields(data, setup);

    fetcher.submit(data, { method: "post" });
  }

  /**
   * True when this image currently shows a label on the *storefront*.
   *
   * Distinct from being ticked: an image nobody has touched sits at "unknown"
   * and carries a provisional mark, so it can be labelled live while unticked
   * here.
   */
  function isLabelled(image: EditorImage): boolean {
    if (image.disclosureState === "required" || image.disclosureState === "reduced") {
      return true;
    }
    return image.disclosureState === "unknown" && image.labelVariant !== "none";
  }

  if (!active) return null;

  const isCustomised =
    Boolean(drafts[active.imageId]) || Boolean(savedSetup(active, defaults));
  const isFirst = active.imageId === images[0]?.imageId;

  return (
    <>
      <s-section heading="Which images are AI-generated?">
        <s-paragraph>
          <s-text color="subdued">
            Tick every image made or edited with AI. Click one to edit its badge.
          </s-text>
        </s-paragraph>
        <div className="ed-strip">
          {images.map((image) => {
            const isSelected = selected.has(image.imageId);
            const isActive = image.imageId === active.imageId;
            return (
              <button
                key={image.imageId}
                type="button"
                className={`ed-tile${isSelected ? " ed-tile--selected" : ""}${
                  isActive ? " ed-tile--active" : ""
                }`}
                onClick={() => setActiveId(image.imageId)}
                aria-pressed={isActive}
                aria-label={`${image.altText ?? "Image"} ${image.position + 1}${
                  image.isFeatured ? ", listing image" : ""
                }`}
              >
                <img src={image.imageUrl} alt="" />
                <span
                  className="ed-tile__check"
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(image.imageId);
                  }}
                >
                  {isSelected ? "✓" : ""}
                </span>
                {isSelected ? (
                  <span className="ed-tile__flag ed-tile__flag--tagged">Tagged</span>
                ) : isLabelled(image) ? (
                  <span className="ed-tile__flag ed-tile__flag--labelled">
                    Still labelled
                  </span>
                ) : image.isFeatured ? (
                  <span className="ed-tile__flag">Listing</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <s-paragraph>
          <s-text color="subdued">
            {selected.size} of {images.length} selected.
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Badge">
        <div className="ed-layout">
          <BadgeCanvas
            imageUrl={active.imageUrl}
            alt={active.altText ?? "Product image"}
            labelVariant={setup.labelType}
            badgeStyle={setup.style}
            placement={setup.placement}
            onChange={setPlacement}
            // Ticking the image adds the tag on the spot; unticking removes it.
            showBadge={selected.has(active.imageId)}
          />

          <div className="ed-tools">
            <span className="ed-readout">
              {isFirst
                ? "Editing the first image. Its setup is the pattern for images that have none of their own."
                : isCustomised
                  ? "This image has its own setup."
                  : "Following the first image. Editing here affects only this image."}
            </span>

            <div>
              <label className="ed-field-label" htmlFor="ed-label-type">
                Label type
              </label>
              <select
                id="ed-label-type"
                className="ed-select"
                value={setup.labelType}
                onChange={(event) => edit({ labelType: event.target.value })}
              >
                {SELECTABLE_LABELS.map((value) => (
                  <option key={value} value={value}>
                    {describeLabel(value)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="ed-field-label" htmlFor="ed-label-style">
                Label
              </label>
              <select
                id="ed-label-style"
                className="ed-select"
                value={setup.style}
                onChange={(event) => edit({ style: event.target.value })}
              >
                {BADGE_STYLES.map((value) => (
                  <option key={value} value={value}>
                    {describeStyle(value)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="ed-field-label" htmlFor="ed-size">
                Size
              </label>
              <input
                id="ed-size"
                className="ed-range"
                type="range"
                min={MIN_HEIGHT_PCT}
                max={MAX_HEIGHT_PCT}
                step={0.5}
                value={setup.placement.heightPct}
                onChange={(event) =>
                  setPlacement(
                    clampPlacement({
                      ...setup.placement,
                      heightPct: Number(event.target.value),
                    }),
                  )
                }
              />
              <span className="ed-readout">
                {setup.placement.heightPct.toFixed(1)}% of image height
              </span>
            </div>

            <div>
              <span className="ed-field-label">Snap to a corner</span>
              <div className="ed-corner-grid">
                {Object.keys(CORNER_PRESETS).map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    className="ed-corner-btn"
                    onClick={() =>
                      setPlacement(
                        clampPlacement({
                          ...setup.placement,
                          ...CORNER_PRESETS[corner],
                        }),
                      )
                    }
                  >
                    {describeCorner(corner)}
                  </button>
                ))}
              </div>
            </div>

            <p className="ed-hint">
              Drag the badge anywhere on the image, or use arrow keys. It always
              keeps 20&nbsp;px clear of every edge — the dashed guide shows the
              area while you drag.
            </p>

            <span className="ed-readout">
              Position {Math.round(setup.placement.x * 100)}% ×{" "}
              {Math.round(setup.placement.y * 100)}%
            </span>

            <div className="ed-divider" />

            <s-button
              variant="primary"
              disabled={busy || selected.size === 0}
              onClick={() => save(true)}
            >
              {busy
                ? "Applying…"
                : `Apply to ${selected.size} selected image${selected.size === 1 ? "" : "s"}`}
            </s-button>

            <s-button disabled={busy} onClick={() => save(false)}>
              Apply to this image only
            </s-button>

            {fetcher.data?.ok === false && (
              <s-banner tone="critical">
                <s-paragraph>{fetcher.data.error}</s-paragraph>
              </s-banner>
            )}
            {fetcher.data?.ok && (
              <s-banner tone="success">
                <s-paragraph>
                  Saved to {fetcher.data.applied} image
                  {fetcher.data.applied === 1 ? "" : "s"}.
                </s-paragraph>
              </s-banner>
            )}
          </div>
        </div>
      </s-section>
    </>
  );
}
