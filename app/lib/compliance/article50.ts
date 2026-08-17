/**
 * The Article 50(4) decision engine.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT LEGAL ADVICE. It encodes one defensible reading of the AI Act's
 * transparency rules so that a merchant's decisions are consistent, explained
 * and logged. The merchant remains the deployer and remains responsible.
 * ---------------------------------------------------------------------------
 *
 * What the law says, and where each rule below comes from:
 *
 *  - Art. 50(4), first subparagraph: deployers of an AI system that generates
 *    or manipulates image, audio or video content *constituting a deep fake*
 *    must disclose that the content has been artificially generated or
 *    manipulated. This is the obligation a Shopify merchant carries.
 *
 *  - Art. 3(60) defines a deep fake as AI-generated or manipulated image,
 *    audio or video content that (a) resembles existing persons, objects,
 *    places, entities or events and (b) would falsely appear to a person to be
 *    authentic or truthful. The Commission's July 2026 guidelines read these as
 *    cumulative criteria, together with a resemblance threshold. Only a human
 *    who knows what the image depicts can settle them, which is why realism is
 *    a merchant declaration rather than an inference.
 *
 *  - Art. 50(4), second subparagraph: where the content forms part of an
 *    evidently artistic, creative, satirical or fictional work, the obligation
 *    is limited to disclosing in a manner that does not hamper the display or
 *    enjoyment of the work.
 *
 *  - Art. 50(2) carves out AI that performs an assistive function for standard
 *    editing, or does not substantially alter the input data. A colour-graded
 *    real photograph is still an authentic photograph, so it cannot constitute
 *    a deep fake under 3(60) either.
 *
 *  - Commission guidance (July 2026): content generated before 2 August 2026
 *    need not be labelled retroactively, though doing so is encouraged.
 *
 * Note the deadline that does *not* apply here: the 2 December 2026 grace
 * period covers the Art. 50(2) machine-readable marking duty owed by model
 * *providers*. The deployer disclosure duty in 50(4) applied from
 * 2 August 2026 without a grace period.
 */

import type {
  Assessment,
  CompliancePolicy,
  ContentOrigin,
  LabelVariant,
  MerchantDeclaration,
  ProvenanceFinding,
  ReasoningStep,
} from "./types";

/** The date Article 50's obligations became applicable. */
export const ARTICLE_50_APPLICATION_DATE = new Date("2026-08-02T00:00:00.000Z");

/**
 * Bumped whenever the rules below change. Stored on every assessment so an
 * old decision can always be explained by the logic that actually produced it.
 */
export const ENGINE_VERSION = "1.0.0";

export interface AssessmentInput {
  detected: ProvenanceFinding;
  declaration?: MerchantDeclaration;
  policy: CompliancePolicy;
}

export function assessImage(input: AssessmentInput): Assessment {
  const { detected, declaration, policy } = input;
  const reasoning: ReasoningStep[] = [];

  // --- Step 1: establish origin ------------------------------------------
  // A merchant declaration always beats a metadata inference. The merchant
  // knows how the asset was produced; the parser only knows what survived the
  // export pipeline.
  const origin: ContentOrigin = declaration?.origin ?? detected.origin;

  if (declaration) {
    reasoning.push({
      code: "origin.declared",
      finding: `Merchant declared this image as ${labelOrigin(origin)} on ${formatDate(
        declaration.declaredAt,
      )}${declaration.declaredBy ? ` by ${declaration.declaredBy}` : ""}.`,
    });
  } else if (detected.source !== "none") {
    reasoning.push({
      code: "origin.detected",
      finding:
        `${sourceName(detected.source)} metadata indicates ${labelOrigin(origin)}` +
        `${detected.generatorName ? ` (generator: ${detected.generatorName})` : ""}.`,
    });
  } else {
    reasoning.push({
      code: "origin.no_metadata",
      finding:
        "No provenance metadata found. Shopify's image pipeline and most export " +
        "tools strip it, so absence is not evidence the image is not AI-generated.",
    });
  }

  // --- Step 2: content that is not AI is outside the Article entirely -----
  if (origin === "not_ai") {
    reasoning.push({
      code: "scope.not_ai",
      legalBasis: "Article 50(4)",
      finding:
        "Content is not AI-generated or AI-manipulated, so the disclosure " +
        "obligation does not arise.",
    });
    return done("not_required", "none", reasoning, { needsMerchantReview: false });
  }

  // --- Step 3: nothing established yet -----------------------------------
  if (origin === "unknown") {
    reasoning.push({
      code: "scope.undetermined",
      finding:
        "Origin could not be established from metadata and has not been declared. " +
        "A merchant declaration is required to resolve this image.",
    });

    if (policy.conservativeDefault) {
      reasoning.push({
        code: "policy.conservative_default",
        finding:
          "Shop policy is set to label unresolved images provisionally. The generic " +
          "'AI' label is shown — it discloses the possibility without asserting how " +
          "the image was produced.",
      });
      return done("unknown", "ai", reasoning, {
        needsMerchantReview: true,
        provisional: true,
      });
    }

    reasoning.push({
      code: "policy.no_provisional_label",
      finding:
        "Shop policy leaves unresolved images unlabelled pending declaration. " +
        "This image is currently undisclosed.",
    });
    return done("unknown", "none", reasoning, { needsMerchantReview: true });
  }

  // From here on the image is ai_generated or ai_modified.

  // --- Step 4: temporal scope --------------------------------------------
  const createdAt = declaration?.contentCreatedAt ?? detected.contentCreatedAt;
  if (createdAt && createdAt < ARTICLE_50_APPLICATION_DATE) {
    if (!policy.labelPreCutoffContent) {
      reasoning.push({
        code: "temporal.pre_cutoff",
        legalBasis: "Commission guidelines on Article 50 (July 2026)",
        finding:
          `Content was created on ${formatDate(createdAt)}, before Article 50 became ` +
          "applicable on 2 August 2026. Retroactive labelling is encouraged but not required.",
      });
      return done("not_required", "none", reasoning, { needsMerchantReview: false });
    }
    reasoning.push({
      code: "temporal.pre_cutoff_voluntary",
      finding:
        `Content predates the 2 August 2026 cutoff, but shop policy opts into ` +
        "labelling legacy AI content voluntarily. Assessment continues.",
    });
  } else if (!createdAt) {
    reasoning.push({
      code: "temporal.unknown_date",
      finding:
        "No reliable creation date, so the pre-2 August 2026 exemption cannot be " +
        "relied on. Treated as in scope.",
    });
  }

  // --- Step 5: assistive editing is not manipulation ---------------------
  if (origin === "ai_modified" && declaration?.editScope === "assistive") {
    reasoning.push({
      code: "scope.assistive_editing",
      legalBasis: "Article 50(2); Article 3(60)",
      finding:
        "Merchant declared the AI edit as assistive (colour correction, denoising, " +
        "background removal or similar) that does not substantially alter the image. " +
        "The result remains an authentic photograph and cannot constitute a deep fake.",
    });
    return done("not_required", "none", reasoning, { needsMerchantReview: false });
  }

  // --- Step 6: the Article 3(60) deep fake test --------------------------
  const realism = declaration?.realism;

  if (!realism) {
    reasoning.push({
      code: "deepfake.realism_undeclared",
      legalBasis: "Article 3(60)",
      finding:
        "Image is AI-generated or AI-modified, but whether it resembles something " +
        "that exists and would pass as authentic has not been declared. That test " +
        "cannot be settled automatically.",
    });

    if (policy.conservativeDefault) {
      reasoning.push({
        code: "policy.conservative_default",
        finding:
          "Shop policy labels provisionally pending declaration. For product imagery " +
          "the realistic reading is the likely one, so a label is shown.",
      });
      return done("unknown", variantFor(origin), reasoning, {
        needsMerchantReview: true,
        provisional: true,
      });
    }
    return done("unknown", "none", reasoning, { needsMerchantReview: true });
  }

  if (realism === "fantastical") {
    reasoning.push({
      code: "deepfake.not_resembling",
      legalBasis: "Article 3(60)",
      finding:
        "Merchant declared the image as fantastical — it does not depict persons, " +
        "objects, places or events that exist or plausibly could. The resemblance " +
        "criterion fails, so the content is not a deep fake.",
    });
    return done("not_required", "none", reasoning, { needsMerchantReview: false });
  }

  if (realism === "stylised") {
    reasoning.push({
      code: "deepfake.not_authentic_appearing",
      legalBasis: "Article 3(60)",
      finding:
        "Merchant declared the image as evidently stylised — an illustration or render " +
        "rather than something presenting itself as a photograph. It does not falsely " +
        "appear authentic, so the deep fake definition is not met.",
    });
    reasoning.push({
      code: "advisory.borderline_stylised",
      finding:
        "This is a judgement call. If the image could still read as a real photograph " +
        "to a customer, reclassify it as realistic — voluntary labelling carries no " +
        "penalty, under-labelling does.",
    });
    return done("not_required", "none", reasoning, { needsMerchantReview: false });
  }

  // realism === "realistic": all three prongs of Art. 3(60) are satisfied.
  reasoning.push({
    code: "deepfake.criteria_met",
    legalBasis: "Article 3(60)",
    finding:
      "Merchant declared the image as realistic: it resembles something that exists " +
      "and would pass as an authentic photograph. Combined with its AI origin, the " +
      "content meets the deep fake definition.",
  });

  // --- Step 7: the creative-works carve-out ------------------------------
  if (declaration?.context === "artistic") {
    reasoning.push({
      code: "carveout.creative_work",
      legalBasis: "Article 50(4), second subparagraph",
      finding:
        "Merchant declared the image as part of an evidently artistic or creative work. " +
        "Disclosure is still required, but limited to a manner that does not hamper the " +
        "display or enjoyment of the work — rendered as an unobtrusive caption rather " +
        "than an overlay.",
    });
    return done("reduced", variantFor(origin), reasoning, { needsMerchantReview: false });
  }

  reasoning.push({
    code: "obligation.disclosure_required",
    legalBasis: "Article 50(4), first subparagraph",
    finding:
      "Disclosure is required. The label must be perceivable by a person at first " +
      "exposure to the image, without special tools — embedded metadata alone is not " +
      "sufficient for a deployer.",
  });

  return done("required", variantFor(origin), reasoning, { needsMerchantReview: false });
}

/**
 * Rolls per-image assessments up to a product-level state, taking the strictest
 * outcome across the images. A product page showing one disclosable image is a
 * product page that needs a disclosure.
 */
export function rollUpProduct(assessments: Assessment[]): {
  disclosureState: Assessment["disclosureState"];
  labelVariant: LabelVariant;
  needsReview: boolean;
} {
  if (assessments.length === 0) {
    return { disclosureState: "not_required", labelVariant: "none", needsReview: false };
  }

  const rank: Record<Assessment["disclosureState"], number> = {
    required: 3,
    unknown: 2,
    reduced: 1,
    not_required: 0,
  };

  const strictest = assessments.reduce((worst, current) =>
    rank[current.disclosureState] > rank[worst.disclosureState] ? current : worst,
  );

  return {
    disclosureState: strictest.disclosureState,
    labelVariant: strictest.labelVariant,
    needsReview: assessments.some((a) => a.needsMerchantReview),
  };
}

// --- helpers ---------------------------------------------------------------

function done(
  disclosureState: Assessment["disclosureState"],
  labelVariant: LabelVariant,
  reasoning: ReasoningStep[],
  opts: { needsMerchantReview: boolean; provisional?: boolean },
): Assessment {
  return {
    disclosureState,
    labelVariant,
    reasoning,
    needsMerchantReview: opts.needsMerchantReview,
    provisional: opts.provisional ?? false,
    engineVersion: ENGINE_VERSION,
  };
}

function variantFor(origin: ContentOrigin): LabelVariant {
  if (origin === "ai_generated") return "ai_generated";
  if (origin === "ai_modified") return "ai_modified";
  return "ai";
}

function labelOrigin(origin: ContentOrigin): string {
  switch (origin) {
    case "ai_generated":
      return "fully AI-generated";
    case "ai_modified":
      return "AI-modified";
    case "not_ai":
      return "not AI-generated";
    default:
      return "of undetermined origin";
  }
}

function sourceName(source: ProvenanceFinding["source"]): string {
  switch (source) {
    case "c2pa":
      return "C2PA Content Credentials";
    case "iptc":
      return "IPTC";
    case "xmp":
      return "XMP";
    case "exif":
      return "EXIF";
    default:
      return "No";
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
