/**
 * Presentation mappings shared by the admin routes.
 *
 * Wording here is deliberately careful: the app states what the engine
 * concluded and what the merchant declared, never that the store "is
 * compliant". That determination is not ours to make.
 */

import type {
  ContentOrigin,
  DisclosureState,
  LabelVariant,
  ProvenanceSource,
  RealismClass,
} from "./compliance/types";

export type BadgeTone =
  | "auto"
  | "neutral"
  | "info"
  | "success"
  | "caution"
  | "warning"
  | "critical";

export interface StateDisplay {
  label: string;
  tone: BadgeTone;
  description: string;
}

export function describeState(state: string): StateDisplay {
  switch (state as DisclosureState) {
    case "required":
      return {
        label: "Disclosure required",
        tone: "warning",
        description:
          "Meets the Article 3(60) deep fake definition. A visible label must be shown at first exposure.",
      };
    case "reduced":
      return {
        label: "Reduced disclosure",
        tone: "info",
        description:
          "Part of an evidently creative work. Disclose without hampering the display or enjoyment of the work.",
      };
    case "not_required":
      return {
        label: "No disclosure needed",
        tone: "success",
        description: "Falls outside the Article 50(4) obligation.",
      };
    default:
      return {
        label: "Needs review",
        tone: "critical",
        description:
          "Origin or realism has not been established. Declare this image to resolve it.",
      };
  }
}

export function describeLabel(variant: string): string {
  switch (variant as LabelVariant) {
    case "ai_generated":
      return "AI GENERATED";
    case "ai_modified":
      return "AI MODIFIED";
    case "ai":
      return "AI";
    default:
      return "No label";
  }
}

/** When each official label is the appropriate one to show. */
export function labelGuidance(variant: string): string {
  switch (variant as LabelVariant) {
    case "ai_generated":
      return "The image was produced entirely by a generative model.";
    case "ai_modified":
      return "A real photograph with generative edits composited into it.";
    case "ai":
      return "Generic mark. Discloses AI involvement without stating how the image was made — the right choice when you are not certain.";
    default:
      return "No label is shown.";
  }
}

/**
 * Filename of the official EU label artwork for a label and style.
 *
 * Shared by the admin preview (served from /badges) and the theme extension
 * (served from the extension's assets), so both resolve identically.
 */
export function badgeAssetName(variant: string, style: string): string | null {
  const base: Record<string, string> = {
    ai_generated: "eu-ai-generated",
    ai_modified: "eu-ai-modified",
    ai: "eu-ai",
  };
  const suffix: Record<string, string> = {
    black_transparent: "black",
    white_transparent: "white",
    black: "black-solid",
    white: "white-solid",
  };

  const prefix = base[variant];
  if (!prefix) return null;
  return `${prefix}-${suffix[style] ?? "black"}.png`;
}

export function describeCorner(corner: string): string {
  switch (corner) {
    case "top_left":
      return "Top left";
    case "top_right":
      return "Top right";
    case "bottom_left":
      return "Bottom left";
    case "bottom_right":
      return "Bottom right";
    default:
      return corner;
  }
}

export function describeStyle(style: string): string {
  switch (style) {
    case "black":
      return "Black — solid";
    case "white":
      return "White — solid";
    case "black_transparent":
      return "Black — translucent";
    case "white_transparent":
      return "White — translucent";
    default:
      return style;
  }
}

export function describeOrigin(origin: string): string {
  switch (origin as ContentOrigin) {
    case "ai_generated":
      return "Fully AI-generated";
    case "ai_modified":
      return "AI-modified";
    case "not_ai":
      return "Not AI";
    default:
      return "Undetermined";
  }
}

export function describeRealism(realism: string): string {
  switch (realism as RealismClass) {
    case "realistic":
      return "Passes as a real photograph";
    case "stylised":
      return "Evidently an illustration or render";
    case "fantastical":
      return "Depicts nothing that exists";
    default:
      return "Not declared";
  }
}

export function describeSource(source: string): string {
  switch (source as ProvenanceSource) {
    case "c2pa":
      return "C2PA Content Credentials";
    case "iptc":
      return "IPTC DigitalSourceType";
    case "xmp":
      return "XMP metadata";
    case "exif":
      return "EXIF metadata";
    default:
      return "No metadata found";
  }
}

/** Human-readable label for an audit action code. */
export function describeAction(action: string): string {
  const map: Record<string, string> = {
    "app.installed": "App installed",
    "app.uninstalled": "App uninstalled",
    "disclaimer.accepted": "Terms acknowledged",
    "scan.started": "Catalog scan started",
    "scan.completed": "Catalog scan completed",
    "scan.failed": "Catalog scan failed",
    "image.assessed": "Image assessed",
    "image.declared": "Merchant declaration",
    "image.overridden": "Decision overridden",
    "product.published": "Labels published to storefront",
    "settings.changed": "Settings changed",
    "plan.changed": "Plan changed",
    "export.generated": "Audit export generated",
  };
  return map[action] ?? action;
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Short hash for display, e.g. "a1b2c3d4…". */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…`;
}
