/**
 * Recording a merchant declaration.
 *
 * This is the hinge of the whole workflow. The parser can only report what
 * metadata survived; whether an image resembles something real and would pass
 * as authentic is a judgement about the world, so a person has to make it.
 * Capturing that judgement — attributed and timestamped — is what converts an
 * imperfect classifier into a defensible record.
 */

import prisma from "~/db.server";
import { assessImage, rollUpProduct } from "./compliance/article50";
import type {
  Assessment,
  CompliancePolicy,
  ContentContext,
  ContentOrigin,
  EditScope,
  MerchantDeclaration,
  ProvenanceFinding,
  RealismClass,
} from "./compliance/types";
import { appendAudit } from "./audit.server";
import { effectiveLabel, type BadgeSettingsInput } from "./badge";
import type { BadgePlacement } from "./badge-layout";
import {
  publishProductDecision,
  type AdminGraphqlClient,
  type ImageDecision,
} from "./metafields.server";

export interface DeclarationInput {
  origin: ContentOrigin;
  realism?: RealismClass;
  context?: ContentContext;
  editScope?: EditScope;
  contentCreatedAt?: Date;
  note?: string;
}

const ORIGINS: ContentOrigin[] = ["ai_generated", "ai_modified", "not_ai", "unknown"];
const REALISMS: RealismClass[] = ["realistic", "stylised", "fantastical"];
const CONTEXTS: ContentContext[] = ["commercial", "artistic"];
const EDIT_SCOPES: EditScope[] = ["substantial", "assistive"];

/** Validates untrusted form input into a declaration, or explains why not. */
export function parseDeclaration(
  form: FormData,
): { ok: true; value: DeclarationInput } | { ok: false; error: string } {
  const origin = String(form.get("origin") ?? "");
  if (!ORIGINS.includes(origin as ContentOrigin) || origin === "unknown") {
    return { ok: false, error: "Choose how this image was made." };
  }

  const realismRaw = form.get("realism");
  const realism = realismRaw ? String(realismRaw) : undefined;
  if (realism && !REALISMS.includes(realism as RealismClass)) {
    return { ok: false, error: "Invalid realism value." };
  }

  const contextRaw = form.get("context");
  const context = contextRaw ? String(contextRaw) : undefined;
  if (context && !CONTEXTS.includes(context as ContentContext)) {
    return { ok: false, error: "Invalid context value." };
  }

  const editScopeRaw = form.get("editScope");
  const editScope = editScopeRaw ? String(editScopeRaw) : undefined;
  if (editScope && !EDIT_SCOPES.includes(editScope as EditScope)) {
    return { ok: false, error: "Invalid edit scope value." };
  }

  // An AI image without a realism call cannot be resolved — the Article 3(60)
  // test needs it, so the engine would just return "unknown" again.
  if (origin !== "not_ai" && !realism) {
    return {
      ok: false,
      error: "Say whether the image passes as a real photograph.",
    };
  }

  const createdRaw = form.get("contentCreatedAt");
  let contentCreatedAt: Date | undefined;
  if (createdRaw) {
    const parsed = new Date(String(createdRaw));
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Invalid creation date." };
    }
    contentCreatedAt = parsed;
  }

  const note = form.get("note");

  return {
    ok: true,
    value: {
      origin: origin as ContentOrigin,
      realism: realism as RealismClass | undefined,
      context: context as ContentContext | undefined,
      editScope: editScope as EditScope | undefined,
      contentCreatedAt,
      note: note ? String(note).slice(0, 2000) : undefined,
    },
  };
}

async function loadPolicy(shopDomain: string): Promise<CompliancePolicy> {
  const settings = await prisma.settings.findUnique({ where: { shopDomain } });
  return {
    conservativeDefault: settings?.conservativeDefault ?? true,
    labelPreCutoffContent: settings?.labelPreCutoffContent ?? false,
  };
}

/**
 * Records a declaration, re-runs the engine, and republishes the product.
 * Returns the resulting assessment so the caller can show it immediately.
 */
export async function declareImage(options: {
  shopDomain: string;
  imageId: string;
  declaration: DeclarationInput;
  actor: string;
  admin?: AdminGraphqlClient;
  badge?: BadgeSettingsInput;
  /** Free badge placement; null or omitted leaves the stored position alone. */
  placement?: BadgePlacement | null;
}): Promise<Assessment> {
  const { shopDomain, imageId, declaration, actor, admin, badge, placement } =
    options;

  const image = await prisma.imageAssessment.findUnique({
    where: { shopDomain_imageId: { shopDomain, imageId } },
  });
  if (!image) throw new Error(`Unknown image ${imageId}`);

  const declaredAt = new Date();
  const policy = await loadPolicy(shopDomain);

  const detected: ProvenanceFinding = {
    source: image.provenanceSource as ProvenanceFinding["source"],
    origin: image.detectedOrigin as ProvenanceFinding["origin"],
    generatorName: image.generatorName ?? undefined,
    contentCreatedAt: image.contentCreatedAt ?? undefined,
  };

  const merchantDeclaration: MerchantDeclaration = {
    origin: declaration.origin,
    realism: declaration.realism,
    context: declaration.context,
    editScope: declaration.editScope,
    contentCreatedAt: declaration.contentCreatedAt ?? image.contentCreatedAt ?? undefined,
    note: declaration.note,
    declaredBy: actor,
    declaredAt,
  };

  const assessment = assessImage({
    detected,
    declaration: merchantDeclaration,
    policy,
  });

  // Presentation fields are only written when the caller supplied them, so a
  // plain re-declaration from the quick queue cannot silently reset a corner
  // or style the merchant set earlier on the detail page.
  const badgeData: Record<string, unknown> = {};
  if (badge && "corner" in badge) badgeData.badgeCorner = badge.corner ?? null;
  if (badge && "style" in badge) badgeData.badgeStyle = badge.style ?? null;

  if (placement) {
    badgeData.badgeX = placement.x;
    badgeData.badgeY = placement.y;
    badgeData.badgeHeightPct = placement.heightPct;
  }

  const labelOverrideChanged =
    badge && "labelOverride" in badge && badge.labelOverride !== image.labelOverride;

  if (labelOverrideChanged) {
    badgeData.labelOverride = badge!.labelOverride ?? null;
    badgeData.labelOverrideBy = badge!.labelOverride ? actor : null;
    badgeData.labelOverrideAt = badge!.labelOverride ? declaredAt : null;
  }

  await prisma.imageAssessment.update({
    where: { id: image.id },
    data: {
      declaredOrigin: declaration.origin,
      declaredRealism: declaration.realism ?? null,
      declaredContext: declaration.context ?? null,
      declaredNote: declaration.note ?? null,
      declaredAt,
      declaredBy: actor,
      contentCreatedAt: merchantDeclaration.contentCreatedAt ?? null,
      disclosureState: assessment.disclosureState,
      labelVariant: assessment.labelVariant,
      reasoning: JSON.stringify(assessment.reasoning),
      engineVersion: assessment.engineVersion,
      assessedAt: declaredAt,
      ...badgeData,
    },
  });

  if (labelOverrideChanged) {
    const chosen = badge!.labelOverride;
    await appendAudit(shopDomain, {
      action: "image.overridden",
      actor,
      subject: imageId,
      createdAt: declaredAt,
      payload: {
        kind: "label",
        engineRecommended: assessment.labelVariant,
        merchantSelected: chosen ?? null,
        note: chosen
          ? "Merchant selected a different official label from the one the assessment produced."
          : "Merchant cleared a manual label selection; the assessed label applies again.",
      },
    });
  }

  // The declaration and the machine's prior view are both recorded, so a later
  // reader can see whether the human agreed with the parser or overrode it.
  await appendAudit(shopDomain, {
    action:
      image.detectedOrigin !== "unknown" &&
      image.detectedOrigin !== declaration.origin
        ? "image.overridden"
        : "image.declared",
    actor,
    subject: imageId,
    createdAt: declaredAt,
    payload: {
      declared: {
        origin: declaration.origin,
        realism: declaration.realism ?? null,
        context: declaration.context ?? null,
        editScope: declaration.editScope ?? null,
        note: declaration.note ?? null,
      },
      detectedPreviously: {
        source: image.provenanceSource,
        origin: image.detectedOrigin,
        generatorName: image.generatorName,
      },
      resulting: {
        disclosureState: assessment.disclosureState,
        labelVariant: assessment.labelVariant,
        engineVersion: assessment.engineVersion,
      },
      reasoning: assessment.reasoning,
    },
  });

  await republishProduct(shopDomain, image.productAssessmentId, admin);

  return assessment;
}

/** Recomputes a product's rolled-up state and pushes it to metafields. */
export async function republishProduct(
  shopDomain: string,
  productAssessmentId: string,
  admin?: AdminGraphqlClient,
): Promise<void> {
  const product = await prisma.productAssessment.findUnique({
    where: { id: productAssessmentId },
    include: { images: true },
  });
  if (!product) return;

  const assessments: Assessment[] = product.images.map((image) => ({
    disclosureState: image.disclosureState as Assessment["disclosureState"],
    labelVariant: image.labelVariant as Assessment["labelVariant"],
    reasoning: [],
    needsMerchantReview: image.disclosureState === "unknown",
    provisional: image.disclosureState === "unknown" && image.labelVariant !== "none",
    engineVersion: image.engineVersion,
  }));

  const rolled = rollUpProduct(assessments);

  await prisma.productAssessment.update({
    where: { id: product.id },
    data: {
      disclosureState: rolled.disclosureState,
      labelVariant: rolled.labelVariant,
      needsReview: rolled.needsReview,
    },
  });

  if (!admin) return;

  const images: ImageDecision[] = product.images.map((image) => {
    const { label, force } = effectiveLabel(image.labelVariant, image.labelOverride);
    return {
      imageId: image.imageId,
      // A merchant who forces a label onto an image the engine cleared is
      // disclosing voluntarily; publish a state the storefront will render.
      state: force ? "required" : image.disclosureState,
      label,
      provisional: image.disclosureState === "unknown" && label !== "none",
      imageUrl: image.imageUrl,
      corner: image.badgeCorner,
      style: image.badgeStyle,
      labelOverridden: Boolean(image.labelOverride),
      x: image.badgeX,
      y: image.badgeY,
      heightPct: image.badgeHeightPct,
    };
  });

  await publishProductDecision(admin, {
    productId: product.productId,
    state: rolled.disclosureState,
    label: rolled.labelVariant,
    assessedAt: new Date(),
    images,
  });
}

export interface BulkApplyResult {
  applied: number;
  skipped: number;
}

/**
 * Applies one declaration to an explicit set of images.
 *
 * Each image gets its own assessment and its own audit entry rather than one
 * bulk record. That matters: the merchant is attesting something about each
 * image individually, and an enforcement conversation is about a specific
 * image. A single "applied to 12 images" row would be much weaker evidence.
 *
 * Takes image ids rather than a product so a filtered multi-select — the
 * agency-facing case — can reuse it unchanged.
 */
export async function applyDeclarationToImages(options: {
  shopDomain: string;
  imageIds: string[];
  declaration: DeclarationInput;
  actor: string;
  admin?: AdminGraphqlClient;
  badge?: BadgeSettingsInput;
  placement?: BadgePlacement | null;
}): Promise<BulkApplyResult> {
  const { shopDomain, imageIds, declaration, actor, admin, badge, placement } =
    options;

  let applied = 0;
  let skipped = 0;
  const touchedProducts = new Set<string>();

  for (const imageId of imageIds) {
    try {
      const row = await prisma.imageAssessment.findUnique({
        where: { shopDomain_imageId: { shopDomain, imageId } },
        select: { productAssessmentId: true },
      });
      if (!row) {
        skipped += 1;
        continue;
      }

      await declareImage({
        shopDomain,
        imageId,
        declaration,
        actor,
        badge,
        placement,
        // Republish once per product at the end rather than per image.
        admin: undefined,
      });
      touchedProducts.add(row.productAssessmentId);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }

  for (const productAssessmentId of touchedProducts) {
    await republishProduct(shopDomain, productAssessmentId, admin);
  }

  return { applied, skipped };
}

/**
 * Applies one image's declaration to every other image on the same product.
 * Thin wrapper over applyDeclarationToImages.
 */
export async function applyToAllImages(options: {
  shopDomain: string;
  sourceImageId: string;
  declaration: DeclarationInput;
  actor: string;
  admin?: AdminGraphqlClient;
  badge?: BadgeSettingsInput;
}): Promise<BulkApplyResult> {
  const { shopDomain, sourceImageId } = options;

  const source = await prisma.imageAssessment.findUnique({
    where: { shopDomain_imageId: { shopDomain, imageId: sourceImageId } },
    select: { productAssessmentId: true },
  });
  if (!source) throw new Error(`Unknown image ${sourceImageId}`);

  const siblings = await prisma.imageAssessment.findMany({
    where: {
      shopDomain,
      productAssessmentId: source.productAssessmentId,
      // The source was just saved by the caller.
      imageId: { not: sourceImageId },
    },
    select: { imageId: true },
  });

  return applyDeclarationToImages({
    ...options,
    imageIds: siblings.map((image) => image.imageId),
  });
}

export { effectiveLabel, parseBadgeSettings } from "./badge";
export type { BadgeSettingsInput } from "./badge";
