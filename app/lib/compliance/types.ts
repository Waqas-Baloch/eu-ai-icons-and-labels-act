/**
 * Vocabulary shared by the provenance parser, the rule engine, the database
 * layer and the storefront extension.
 *
 * These string unions are the source of truth for the `String` columns in
 * prisma/schema.prisma — SQLite has no enums, so the constraint lives here.
 */

/** Where an image came from, as far as we can establish. */
export type ContentOrigin =
  | "ai_generated" // wholly produced by a generative model
  | "ai_modified" // real capture with generative edits composited in
  | "not_ai" // ordinary photography or non-generative editing
  | "unknown"; // nothing conclusive found, and no merchant declaration yet

/**
 * How closely the image passes for a real photograph. This is the merchant's
 * call, because it is the prong of the Art. 3(60) test a parser cannot reach.
 */
export type RealismClass =
  | "realistic" // reads as an authentic photograph of something that exists
  | "stylised" // recognisable subject, but evidently an illustration/render
  | "fantastical"; // depicts nothing that exists or plausibly could

/** Whether the image is ordinary commerce or an evidently creative work. */
export type ContentContext = "commercial" | "artistic";

/** For `ai_modified` images: how far the generative edit went. */
export type EditScope =
  | "substantial" // generative fill, subject replacement, synthetic scene
  | "assistive"; // colour correction, denoise, background removal, upscaling

/** The obligation the engine concludes applies. */
export type DisclosureState =
  | "required" // Art. 50(4) disclosure applies in full
  | "reduced" // creative-work carve-out: disclose without hampering the work
  | "not_required" // outside the scope of Art. 50(4)
  | "unknown"; // insufficient information — awaiting merchant declaration

/** Which official EU label to render. */
export type LabelVariant = "ai_generated" | "ai_modified" | "ai" | "none";

/** Where the badge sits on the image. */
export type BadgeCorner = "top_left" | "top_right" | "bottom_left" | "bottom_right";

/** Which artwork variant of the official label to draw. */
export type BadgeStyle =
  | "black_transparent"
  | "white_transparent"
  | "black"
  | "white";

export const BADGE_CORNERS: BadgeCorner[] = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
];

// Solid first: these are the opaque variants. The pack's "transparent" files
// draw the pill at 50% alpha, which reads faintly over light photography.
export const BADGE_STYLES: BadgeStyle[] = [
  "black",
  "white",
  "black_transparent",
  "white_transparent",
];

/** The three official EU labels a merchant can select between. */
export const SELECTABLE_LABELS: Exclude<LabelVariant, "none">[] = [
  "ai_generated",
  "ai_modified",
  "ai",
];

/** Which metadata standard produced the finding. */
export type ProvenanceSource = "c2pa" | "iptc" | "xmp" | "exif" | "none";

/** A single step in the engine's explanation of its conclusion. */
export interface ReasoningStep {
  /** Stable machine-readable code; safe to key UI copy and tests off. */
  code: string;
  /** The provision relied on, where one applies. */
  legalBasis?: string;
  /** Plain-language statement of what was found and what follows from it. */
  finding: string;
}

/** What the provenance parser extracted from the image bytes. */
export interface ProvenanceFinding {
  source: ProvenanceSource;
  origin: ContentOrigin;
  /** e.g. "Midjourney", "DALL·E", "Adobe Firefly" — when identifiable. */
  generatorName?: string;
  /** Creation timestamp from metadata, used for the 2 Aug 2026 cutoff. */
  contentCreatedAt?: Date;
  /** Raw findings, retained as evidence in the audit record. */
  raw?: Record<string, unknown>;
}

/** What the merchant attested about the image. */
export interface MerchantDeclaration {
  origin: ContentOrigin;
  realism?: RealismClass;
  context?: ContentContext;
  editScope?: EditScope;
  /** Merchant's own timestamp for when the content was created, if known. */
  contentCreatedAt?: Date;
  note?: string;
  declaredBy: string;
  declaredAt: Date;
}

/** Shop-level policy that modulates the engine's output. */
export interface CompliancePolicy {
  /**
   * Treat an unresolved image as disclosable on the storefront until the
   * merchant says otherwise. On by default: over-labelling carries no fine,
   * under-labelling does.
   */
  conservativeDefault: boolean;
  /**
   * Label AI content created before 2 Aug 2026. The Commission does not
   * require retroactive labelling but encourages it, so this is opt-in.
   */
  labelPreCutoffContent: boolean;
}

/** The engine's conclusion for one image. */
export interface Assessment {
  disclosureState: DisclosureState;
  labelVariant: LabelVariant;
  reasoning: ReasoningStep[];
  /** True when a merchant declaration would change or firm up the outcome. */
  needsMerchantReview: boolean;
  /**
   * True when the label is being shown as a precaution rather than because the
   * engine concluded the obligation applies. Drives the "provisional" UI state.
   */
  provisional: boolean;
  engineVersion: string;
}

export const DEFAULT_POLICY: CompliancePolicy = {
  conservativeDefault: true,
  labelPreCutoffContent: false,
};
