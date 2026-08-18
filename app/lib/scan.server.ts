/**
 * Catalog scanning.
 *
 * Walks a shop's products, reads each image's provenance, runs the Article 50
 * engine, persists the result, records it in the audit chain and publishes the
 * outcome to product metafields for the storefront to render.
 */

import { createHash } from "node:crypto";

import prisma from "~/db.server";
import { assessImage, rollUpProduct, ENGINE_VERSION } from "./compliance/article50";
import { parseProvenance } from "./compliance/provenance";
import type {
  Assessment,
  CompliancePolicy,
  MerchantDeclaration,
  ProvenanceFinding,
} from "./compliance/types";
import { appendAudit } from "./audit.server";
import { effectiveLabel } from "./declare.server";
import {
  publishProductDecision,
  type AdminGraphqlClient,
  type ImageDecision,
} from "./metafields.server";

/**
 * How much of each image to download.
 *
 * EXIF, XMP and C2PA all sit in the header, before the pixel data, so a range
 * request over the first chunk is enough to classify an image. Pulling whole
 * product photos would multiply bandwidth by 20–50x for no extra signal.
 */
const HEAD_BYTES = 256 * 1024;

// `media` comes back in the order the merchant arranged it, which is the order
// a customer sees on the product page. `featuredMedia` identifies the listing
// image — the one shown in collections and search, and therefore usually the
// first exposure a customer has to the product at all.
const PRODUCT_FIELDS = `#graphql
  fragment ScannedProduct on Product {
    id
    title
    handle
    status
    featuredMedia { id }
    media(first: 30) {
      nodes {
        ... on MediaImage {
          id
          image { url width height altText }
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query ScanProducts($cursor: String) {
    products(first: 25, after: $cursor, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ...ScannedProduct }
    }
  }
`;

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredMedia?: { id?: string | null } | null;
  media: {
    nodes: Array<{
      id?: string;
      image?: {
        url: string;
        width: number | null;
        height: number | null;
        altText: string | null;
      } | null;
    }>;
  };
}

/**
 * Downloads the head of an image.
 *
 * Returns null rather than throwing on any failure — an unreachable image
 * becomes an unresolved assessment the merchant is asked about, which is the
 * safe outcome. Silently treating it as clean would not be.
 */
export async function fetchImageHead(
  url: string,
  maxBytes = HEAD_BYTES,
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${maxBytes - 1}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 206) return null;

    const buffer = await response.arrayBuffer();
    // A server that ignores Range returns 200 with the whole file; trim it.
    return new Uint8Array(buffer.byteLength > maxBytes ? buffer.slice(0, maxBytes) : buffer);
  } catch {
    return null;
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * The scan's cost is almost entirely waiting on image downloads, and doing them
 * one at a time is what made a large catalog impossible to finish inside a
 * request. Six is chosen to be brisk without hammering the CDN.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Hash of the downloaded prefix, used to recognise the same asset reused
 * across products so the merchant declares it once. Not a hash of the whole
 * file — two distinct images sharing a 256KB prefix is not a realistic case.
 */
function hashHead(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadPolicy(shopDomain: string): Promise<CompliancePolicy> {
  const settings = await prisma.settings.findUnique({ where: { shopDomain } });
  return {
    conservativeDefault: settings?.conservativeDefault ?? true,
    labelPreCutoffContent: settings?.labelPreCutoffContent ?? false,
  };
}

/** Rebuilds a stored declaration into the shape the engine expects. */
function declarationFrom(row: {
  declaredOrigin: string | null;
  declaredRealism: string | null;
  declaredContext: string | null;
  declaredNote: string | null;
  declaredAt: Date | null;
  declaredBy: string | null;
  contentCreatedAt: Date | null;
}): MerchantDeclaration | undefined {
  if (!row.declaredOrigin || !row.declaredAt) return undefined;
  return {
    origin: row.declaredOrigin as MerchantDeclaration["origin"],
    realism: (row.declaredRealism ?? undefined) as MerchantDeclaration["realism"],
    context: (row.declaredContext ?? undefined) as MerchantDeclaration["context"],
    editScope: undefined,
    contentCreatedAt: row.contentCreatedAt ?? undefined,
    note: row.declaredNote ?? undefined,
    declaredBy: row.declaredBy ?? "merchant",
    declaredAt: row.declaredAt,
  };
}

export interface ScanResult {
  productsSeen: number;
  imagesSeen: number;
  imagesFlagged: number;
  /**
   * True when the time budget ran out before the catalog was finished.
   *
   * Running the scan again continues from where it effectively stopped: an
   * image already assessed is not downloaded a second time, so each run reaches
   * further than the last until the catalog is covered. That is why this needs
   * no stored cursor — re-walking the product pages is cheap next to the
   * downloads, which are what the budget is actually protecting.
   */
  partial: boolean;
}

/**
 * How long a single scan may spend before stopping and reporting partial.
 *
 * A scan runs inside an HTTP request. Without a bound, a catalog of any size
 * simply hangs until something upstream gives up, and the merchant is left with
 * no result and no explanation.
 */
export const SCAN_TIME_BUDGET_MS = 20_000;

/**
 * Turns a thrown value into something a merchant can act on.
 *
 * The Shopify admin client throws the raw `Response` when a GraphQL call is
 * rejected, and String(response) is "[object Response]" — which is exactly what
 * was recorded for the first failures on this app, telling nobody anything.
 * Reading the status and body back costs one await on a path that has already
 * failed, and turns a dead end into a diagnosis.
 */
export async function describeScanError(error: unknown): Promise<string> {
  if (error instanceof Response) {
    let detail = "";
    try {
      detail = (await error.clone().text()).slice(0, 500);
    } catch {
      // Body already consumed or not readable; the status alone still helps.
    }
    const status = `Shopify returned ${error.status}${
      error.statusText ? ` ${error.statusText}` : ""
    }`;
    // 401/403 here almost always means the granted scopes no longer cover the
    // query, which a reinstall fixes and a retry does not.
    const hint =
      error.status === 401 || error.status === 403
        ? " — the app may need reinstalling to regrant permissions"
        : error.status === 429
          ? " — rate limited; run the scan again in a minute"
          : "";
    return `${status}${hint}${detail ? `: ${detail}` : ""}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Scans an entire catalog.
 *
 * Existing merchant declarations are preserved and re-applied: a rescan must
 * never silently discard a human decision, or the audit trail would show the
 * merchant reviewing images that then quietly reverted.
 */
export async function scanCatalog(
  admin: AdminGraphqlClient,
  shopDomain: string,
  trigger: "manual" | "install" | "webhook" = "manual",
): Promise<ScanResult & { scanRunId: string }> {
  const scanRun = await prisma.scanRun.create({
    data: { shopDomain, trigger, status: "running" },
  });

  await appendAudit(shopDomain, {
    action: "scan.started",
    actor: "system",
    payload: { scanRunId: scanRun.id, trigger, engineVersion: ENGINE_VERSION },
  });

  const policy = await loadPolicy(shopDomain);
  const totals: ScanResult = {
    productsSeen: 0,
    imagesSeen: 0,
    imagesFlagged: 0,
    partial: false,
  };

  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;

  try {
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      // Checked per page rather than per product: a page is the unit that can
      // be abandoned without leaving a product half-written.
      if (Date.now() > deadline) {
        totals.partial = true;
        break;
      }

      const response = await admin.graphql(PRODUCTS_QUERY, {
        variables: { cursor },
      });
      const body = (await response.json()) as {
        data?: {
          products?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: ProductNode[];
          };
        };
      };

      const page = body.data?.products;
      if (!page) break;

      for (const product of page.nodes) {
        const result = await assessProduct(admin, shopDomain, product, policy);
        totals.productsSeen += 1;
        totals.imagesSeen += result.imagesSeen;
        totals.imagesFlagged += result.imagesFlagged;
      }

      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        status: totals.partial ? "partial" : "completed",
        finishedAt: new Date(),
        productsSeen: totals.productsSeen,
        imagesSeen: totals.imagesSeen,
        imagesFlagged: totals.imagesFlagged,
      },
    });

    await appendAudit(shopDomain, {
      action: totals.partial ? "scan.partial" : "scan.completed",
      actor: "system",
      payload: { scanRunId: scanRun.id, ...totals },
    });

    return { ...totals, scanRunId: scanRun.id };
  } catch (error) {
    const message = await describeScanError(error);
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: { status: "failed", finishedAt: new Date(), error: message },
    });
    await appendAudit(shopDomain, {
      action: "scan.failed",
      actor: "system",
      payload: { scanRunId: scanRun.id, error: message },
    });
    throw error;
  }
}

/** Assesses one product's images and publishes the result. */
export async function assessProduct(
  admin: AdminGraphqlClient,
  shopDomain: string,
  product: ProductNode,
  policy?: CompliancePolicy,
): Promise<{ imagesSeen: number; imagesFlagged: number }> {
  const effectivePolicy = policy ?? (await loadPolicy(shopDomain));

  const productRow = await prisma.productAssessment.upsert({
    where: { shopDomain_productId: { shopDomain, productId: product.id } },
    create: {
      shopDomain,
      productId: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
    },
    update: { title: product.title, handle: product.handle, status: product.status },
  });

  const assessments: Assessment[] = [];
  const imageDecisions: ImageDecision[] = [];
  let imagesFlagged = 0;

  const mediaImages = product.media.nodes.filter(
    (node): node is { id: string; image: NonNullable<ProductNode["media"]["nodes"][0]["image"]> } =>
      Boolean(node.id && node.image?.url),
  );

  const featuredId = product.featuredMedia?.id ?? null;

  // One query for the whole product instead of one per image.
  const existingRows = await prisma.imageAssessment.findMany({
    where: { shopDomain, imageId: { in: mediaImages.map((m) => m.id) } },
  });
  const existingById = new Map(existingRows.map((row) => [row.imageId, row]));

  // Download the heads we actually need up front and in parallel. Sequentially
  // this was the whole cost of a scan: one 256KB round trip per image, and a
  // product with a dozen photos spent a dozen round trips waiting.
  const needsDownload = mediaImages.filter((media) => {
    const row = existingById.get(media.id);
    return !(row && row.provenanceSource !== "none" && row.contentHash);
  });
  const heads = new Map<string, Uint8Array | null>();
  await mapWithConcurrency(needsDownload, 6, async (media) => {
    heads.set(media.id, await fetchImageHead(media.image.url));
  });

  for (const [position, media] of mediaImages.entries()) {
    const isFeatured = featuredId
      ? media.id === featuredId
      : // No featuredMedia reported: the first media is what Shopify shows.
        position === 0;

    const existing = existingById.get(media.id) ?? null;

    // Re-download only when we have not seen this image before. Product
    // metadata changes far more often than the image bytes do.
    let detected: ProvenanceFinding;
    let contentHash = existing?.contentHash ?? null;

    if (existing && existing.provenanceSource !== "none" && contentHash) {
      detected = {
        source: existing.provenanceSource as ProvenanceFinding["source"],
        origin: existing.detectedOrigin as ProvenanceFinding["origin"],
        generatorName: existing.generatorName ?? undefined,
        contentCreatedAt: existing.contentCreatedAt ?? undefined,
        raw: existing.provenanceRaw ? JSON.parse(existing.provenanceRaw) : undefined,
      };
    } else {
      const bytes = heads.get(media.id) ?? null;
      if (bytes) {
        detected = parseProvenance(bytes);
        contentHash = hashHead(bytes);
      } else {
        detected = { source: "none", origin: "unknown" };
      }
    }

    const declaration = existing ? declarationFrom(existing) : undefined;
    const assessment = assessImage({ detected, declaration, policy: effectivePolicy });
    assessments.push(assessment);

    if (assessment.disclosureState !== "not_required") imagesFlagged += 1;

    await prisma.imageAssessment.upsert({
      where: { shopDomain_imageId: { shopDomain, imageId: media.id } },
      create: {
        shopDomain,
        productAssessmentId: productRow.id,
        imageId: media.id,
        imageUrl: media.image.url,
        altText: media.image.altText,
        width: media.image.width,
        height: media.image.height,
        position,
        isFeatured,
        contentHash,
        provenanceSource: detected.source,
        detectedOrigin: detected.origin,
        generatorName: detected.generatorName ?? null,
        contentCreatedAt: detected.contentCreatedAt ?? null,
        provenanceRaw: detected.raw ? JSON.stringify(detected.raw) : null,
        disclosureState: assessment.disclosureState,
        labelVariant: assessment.labelVariant,
        reasoning: JSON.stringify(assessment.reasoning),
        engineVersion: assessment.engineVersion,
        assessedAt: new Date(),
      },
      update: {
        productAssessmentId: productRow.id,
        imageUrl: media.image.url,
        altText: media.image.altText,
        width: media.image.width,
        height: media.image.height,
        position,
        isFeatured,
        contentHash,
        provenanceSource: detected.source,
        detectedOrigin: detected.origin,
        generatorName: detected.generatorName ?? null,
        contentCreatedAt: detected.contentCreatedAt ?? null,
        provenanceRaw: detected.raw ? JSON.stringify(detected.raw) : null,
        disclosureState: assessment.disclosureState,
        labelVariant: assessment.labelVariant,
        reasoning: JSON.stringify(assessment.reasoning),
        engineVersion: assessment.engineVersion,
        assessedAt: new Date(),
      },
    });

    await appendAudit(shopDomain, {
      action: "image.assessed",
      actor: "system",
      subject: media.id,
      payload: {
        productId: product.id,
        provenanceSource: detected.source,
        detectedOrigin: detected.origin,
        generatorName: detected.generatorName ?? null,
        disclosureState: assessment.disclosureState,
        labelVariant: assessment.labelVariant,
        provisional: assessment.provisional,
        engineVersion: assessment.engineVersion,
        reasoning: assessment.reasoning,
      },
    });

    // Presentation overrides the merchant set earlier survive a rescan — the
    // upsert above never touches those columns.
    const { label, force } = effectiveLabel(
      assessment.labelVariant,
      existing?.labelOverride,
    );
    imageDecisions.push({
      imageId: media.id,
      state: force ? "required" : assessment.disclosureState,
      label,
      provisional: assessment.provisional,
      imageUrl: media.image.url,
      corner: existing?.badgeCorner ?? null,
      style: existing?.badgeStyle ?? null,
      labelOverridden: Boolean(existing?.labelOverride),
      x: existing?.badgeX ?? null,
      y: existing?.badgeY ?? null,
      heightPct: existing?.badgeHeightPct ?? null,
    });
  }

  const rolled = rollUpProduct(assessments);
  const assessedAt = new Date();

  await prisma.productAssessment.update({
    where: { id: productRow.id },
    data: {
      disclosureState: rolled.disclosureState,
      labelVariant: rolled.labelVariant,
      needsReview: rolled.needsReview,
      lastAssessedAt: assessedAt,
    },
  });

  await publishProductDecision(admin, {
    productId: product.id,
    state: rolled.disclosureState,
    label: rolled.labelVariant,
    assessedAt,
    images: imageDecisions,
  });

  await appendAudit(shopDomain, {
    action: "product.published",
    actor: "system",
    subject: product.id,
    payload: {
      disclosureState: rolled.disclosureState,
      labelVariant: rolled.labelVariant,
      imageCount: imageDecisions.length,
    },
  });

  return { imagesSeen: mediaImages.length, imagesFlagged };
}

const SINGLE_PRODUCT_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query ScanSingleProduct($id: ID!) {
    product(id: $id) { ...ScannedProduct }
  }
`;

/** Re-assesses one product, used by the products/create and update webhooks. */
export async function assessProductById(
  admin: AdminGraphqlClient,
  shopDomain: string,
  productGid: string,
): Promise<void> {
  const response = await admin.graphql(SINGLE_PRODUCT_QUERY, {
    variables: { id: productGid },
  });
  const body = (await response.json()) as { data?: { product?: ProductNode | null } };
  const product = body.data?.product;
  if (!product) return;
  await assessProduct(admin, shopDomain, product);
}

/**
 * Re-runs the engine over stored data without re-downloading anything.
 * Used when a policy setting changes, since that can flip conclusions.
 */
export async function reassessStored(
  shopDomain: string,
  admin?: AdminGraphqlClient,
): Promise<number> {
  const policy = await loadPolicy(shopDomain);
  const products = await prisma.productAssessment.findMany({
    where: { shopDomain },
    include: { images: true },
  });

  let updated = 0;

  for (const product of products) {
    const assessments: Assessment[] = [];
    const imageDecisions: ImageDecision[] = [];

    for (const image of product.images) {
      const detected: ProvenanceFinding = {
        source: image.provenanceSource as ProvenanceFinding["source"],
        origin: image.detectedOrigin as ProvenanceFinding["origin"],
        generatorName: image.generatorName ?? undefined,
        contentCreatedAt: image.contentCreatedAt ?? undefined,
      };
      const assessment = assessImage({
        detected,
        declaration: declarationFrom(image),
        policy,
      });
      assessments.push(assessment);

      if (
        assessment.disclosureState !== image.disclosureState ||
        assessment.labelVariant !== image.labelVariant
      ) {
        await prisma.imageAssessment.update({
          where: { id: image.id },
          data: {
            disclosureState: assessment.disclosureState,
            labelVariant: assessment.labelVariant,
            reasoning: JSON.stringify(assessment.reasoning),
            engineVersion: assessment.engineVersion,
            assessedAt: new Date(),
          },
        });
        updated += 1;
      }

      const { label, force } = effectiveLabel(
        assessment.labelVariant,
        image.labelOverride,
      );
      imageDecisions.push({
        imageId: image.imageId,
        state: force ? "required" : assessment.disclosureState,
        label,
        provisional: assessment.provisional,
        imageUrl: image.imageUrl,
        corner: image.badgeCorner,
        style: image.badgeStyle,
        labelOverridden: Boolean(image.labelOverride),
        x: image.badgeX,
        y: image.badgeY,
        heightPct: image.badgeHeightPct,
      });
    }

    const rolled = rollUpProduct(assessments);
    await prisma.productAssessment.update({
      where: { id: product.id },
      data: {
        disclosureState: rolled.disclosureState,
        labelVariant: rolled.labelVariant,
        needsReview: rolled.needsReview,
      },
    });

    if (admin) {
      await publishProductDecision(admin, {
        productId: product.productId,
        state: rolled.disclosureState,
        label: rolled.labelVariant,
        assessedAt: new Date(),
        images: imageDecisions,
      });
    }
  }

  return updated;
}
