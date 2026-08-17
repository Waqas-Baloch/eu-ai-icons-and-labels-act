/**
 * Badge presentation rules.
 *
 * Pure and free of database imports so it can be unit-tested and shared by
 * client code. The distinction it encodes matters: corner and style are
 * cosmetic, but which official label is shown is a statement about how an
 * image was made — so overriding it is treated as a substantive act, audited
 * under its own action rather than folded into a settings change.
 */

import {
  BADGE_CORNERS,
  BADGE_STYLES,
  SELECTABLE_LABELS,
  type BadgeCorner,
  type BadgeStyle,
  type LabelVariant,
} from "./compliance/types";

export interface BadgeSettingsInput {
  /** `null` means inherit the shop default; `undefined` means leave unchanged. */
  corner?: BadgeCorner | null;
  style?: BadgeStyle | null;
  labelOverride?: Exclude<LabelVariant, "none"> | null;
}

/**
 * The label actually shown, once a merchant override is taken into account.
 *
 * `force` is set when the merchant selected a label for an image the engine
 * cleared. That is voluntary disclosure — permitted and encouraged — but it is
 * flagged rather than silently folded in, so the storefront knows to render it
 * and the reason stays visible in the data.
 */
export function effectiveLabel(
  engineLabel: string,
  labelOverride: string | null | undefined,
): { label: string; force: boolean } {
  if (!labelOverride) return { label: engineLabel, force: false };
  return { label: labelOverride, force: engineLabel === "none" };
}

/** Validates the badge presentation fields from untrusted form input. */
export function parseBadgeSettings(
  form: FormData,
): { ok: true; value: BadgeSettingsInput } | { ok: false; error: string } {
  const value: BadgeSettingsInput = {};

  if (form.has("badgeCorner")) {
    const raw = String(form.get("badgeCorner") ?? "");
    if (raw === "" || raw === "inherit") {
      value.corner = null;
    } else if (BADGE_CORNERS.includes(raw as BadgeCorner)) {
      value.corner = raw as BadgeCorner;
    } else {
      return { ok: false, error: "Invalid badge corner." };
    }
  }

  if (form.has("badgeStyle")) {
    const raw = String(form.get("badgeStyle") ?? "");
    if (raw === "" || raw === "inherit") {
      value.style = null;
    } else if (BADGE_STYLES.includes(raw as BadgeStyle)) {
      value.style = raw as BadgeStyle;
    } else {
      return { ok: false, error: "Invalid badge style." };
    }
  }

  if (form.has("labelOverride")) {
    const raw = String(form.get("labelOverride") ?? "");
    if (raw === "" || raw === "auto") {
      value.labelOverride = null;
    } else if (SELECTABLE_LABELS.includes(raw as Exclude<LabelVariant, "none">)) {
      value.labelOverride = raw as Exclude<LabelVariant, "none">;
    } else {
      return { ok: false, error: "Invalid label selection." };
    }
  }

  return { ok: true, value };
}
