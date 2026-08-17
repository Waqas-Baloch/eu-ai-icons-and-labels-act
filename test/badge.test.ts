import { describe, expect, it } from "vitest";

import { effectiveLabel, parseBadgeSettings } from "../app/lib/badge";
import { badgeAssetName, describeCorner, describeStyle } from "../app/lib/display";
import {
  BADGE_CORNERS,
  BADGE_STYLES,
  SELECTABLE_LABELS,
} from "../app/lib/compliance/types";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("effectiveLabel", () => {
  it("uses the engine's label when there is no override", () => {
    expect(effectiveLabel("ai_generated", null)).toEqual({
      label: "ai_generated",
      force: false,
    });
  });

  it("treats an empty override as no override", () => {
    expect(effectiveLabel("ai_modified", "")).toEqual({
      label: "ai_modified",
      force: false,
    });
    expect(effectiveLabel("ai_modified", undefined)).toEqual({
      label: "ai_modified",
      force: false,
    });
  });

  it("replaces the label when the merchant chose a different one", () => {
    expect(effectiveLabel("ai_generated", "ai_modified")).toEqual({
      label: "ai_modified",
      force: false,
    });
  });

  it("flags a label forced onto an image the engine cleared", () => {
    // Voluntary disclosure: permitted and encouraged, but the storefront needs
    // to know to render it, since the state alone says no label is due.
    expect(effectiveLabel("none", "ai")).toEqual({ label: "ai", force: true });
  });

  it("does not flag force when the engine already wanted a label", () => {
    expect(effectiveLabel("ai", "ai_generated").force).toBe(false);
  });
});

describe("parseBadgeSettings", () => {
  it("returns nothing for fields that were not submitted", () => {
    const result = parseBadgeSettings(form({}));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it.each(BADGE_CORNERS)("accepts the %s corner", (corner) => {
    const result = parseBadgeSettings(form({ badgeCorner: corner }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.corner).toBe(corner);
  });

  it.each(BADGE_STYLES)("accepts the %s style", (style) => {
    const result = parseBadgeSettings(form({ badgeStyle: style }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.style).toBe(style);
  });

  it.each(SELECTABLE_LABELS)("accepts %s as a label override", (label) => {
    const result = parseBadgeSettings(form({ labelOverride: label }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.labelOverride).toBe(label);
  });

  it("maps an explicit inherit to null rather than dropping it", () => {
    // null and undefined mean different things downstream: null clears the
    // override, undefined leaves whatever is stored alone.
    const result = parseBadgeSettings(
      form({ badgeCorner: "inherit", badgeStyle: "", labelOverride: "auto" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ corner: null, style: null, labelOverride: null });
      expect("corner" in result.value).toBe(true);
    }
  });

  it.each([
    ["badgeCorner", "middle", /corner/i],
    ["badgeStyle", "chartreuse", /style/i],
    ["labelOverride", "none", /label/i],
    ["labelOverride", "definitely_not_ai", /label/i],
  ])("rejects %s=%s", (field, value, pattern) => {
    const result = parseBadgeSettings(form({ [field]: value }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  });

  it("rejects 'none' as a manual label choice", () => {
    // "No label" is an outcome of the assessment, never something a merchant
    // selects — that would be a way to hide a required disclosure by accident.
    expect(parseBadgeSettings(form({ labelOverride: "none" })).ok).toBe(false);
  });
});

describe("removing a label from a non-AI image", () => {
  it("shows nothing once the engine clears the image and the override is gone", () => {
    // The path taken by "Mark unticked as not AI".
    const parsed = parseBadgeSettings(form({ labelOverride: "" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.labelOverride).toBeNull();

    expect(effectiveLabel("none", null)).toEqual({ label: "none", force: false });
  });

  it("would resurrect the badge if a stale override were left behind", () => {
    // Guards the reason the clear action explicitly sends an empty
    // labelOverride: a leftover manual choice forces the label back on, and
    // `force` republishes the image as disclosable even though the merchant
    // just declared it an ordinary photograph.
    expect(effectiveLabel("none", "ai_generated")).toEqual({
      label: "ai_generated",
      force: true,
    });
  });

  it("keeps a deliberate voluntary label distinguishable from a stale one", () => {
    // Same shape, opposite intent — which is why clearing has to be explicit
    // rather than inferred from the engine's output alone.
    const voluntary = effectiveLabel("none", "ai");
    expect(voluntary.force).toBe(true);
    expect(voluntary.label).toBe("ai");
  });
});

describe("badgeAssetName", () => {
  it("maps every label and style combination to a file", () => {
    for (const label of SELECTABLE_LABELS) {
      for (const style of BADGE_STYLES) {
        expect(badgeAssetName(label, style)).toMatch(/^eu-ai.*\.png$/);
      }
    }
  });

  it.each([
    ["ai_generated", "black_transparent", "eu-ai-generated-black.png"],
    ["ai_generated", "white_transparent", "eu-ai-generated-white.png"],
    ["ai_generated", "black", "eu-ai-generated-black-solid.png"],
    ["ai_modified", "white", "eu-ai-modified-white-solid.png"],
    ["ai", "black_transparent", "eu-ai-black.png"],
  ])("maps %s + %s to %s", (label, style, expected) => {
    expect(badgeAssetName(label, style)).toBe(expected);
  });

  it("returns null for a label with no artwork", () => {
    expect(badgeAssetName("none", "black_transparent")).toBeNull();
  });

  it("falls back to the black artwork for an unknown style", () => {
    expect(badgeAssetName("ai", "nonsense")).toBe("eu-ai-black.png");
  });
});

describe("display helpers", () => {
  it("names every corner", () => {
    for (const corner of BADGE_CORNERS) {
      expect(describeCorner(corner)).not.toBe(corner);
    }
  });

  it("names every style", () => {
    for (const style of BADGE_STYLES) {
      expect(describeStyle(style)).not.toBe(style);
    }
  });
});
