import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { applyDeclarationToImages, parseDeclaration } from "~/lib/declare.server";
import { parseBadgeSettings } from "~/lib/badge";
import { clampPlacement } from "~/lib/badge-layout";
import { describeState, formatDateTime } from "~/lib/display";
import { ProductEditor } from "~/components/ProductEditor";
import editorStyles from "~/styles/editor.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: editorStyles },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // The route carries the numeric product id, not the full gid: a gid contains
  // slashes, and an encoded %2F inside a path segment is rejected or silently
  // normalised by a fair number of proxies and CDNs.
  const numeric = (params.id ?? "").replace(/\D/g, "");
  if (!numeric) throw new Response("Invalid product id", { status: 400 });
  const productId = `gid://shopify/Product/${numeric}`;

  const [product, settings] = await Promise.all([
    prisma.productAssessment.findUnique({
      where: { shopDomain_productId: { shopDomain, productId } },
      include: {
        images: {
          // Listing image first, then the order a customer scrolls through.
          orderBy: [{ isFeatured: "desc" }, { position: "asc" }],
        },
      },
    }),
    prisma.settings.findUnique({ where: { shopDomain } }),
  ]);

  if (!product) throw new Response("Product not assessed yet", { status: 404 });

  return {
    product: {
      title: product.title,
      disclosureState: product.disclosureState,
      lastAssessedAt: product.lastAssessedAt.toISOString(),
    },
    defaults: {
      corner: settings?.badgePlacement ?? "bottom_left",
      style: settings?.badgeVariant ?? "black",
    },
    images: product.images.map((image) => ({
      imageId: image.imageId,
      imageUrl: image.imageUrl,
      altText: image.altText,
      position: image.position,
      isFeatured: image.isFeatured,
      disclosureState: image.disclosureState,
      labelVariant: image.labelVariant,
      labelOverride: image.labelOverride,
      badgeStyle: image.badgeStyle,
      badgeX: image.badgeX,
      badgeY: image.badgeY,
      badgeHeightPct: image.badgeHeightPct,
      declaredOrigin: image.declaredOrigin,
      declaredRealism: image.declaredRealism,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const form = await request.formData();

  const imageIds = form.getAll("imageIds").map(String).filter(Boolean);
  if (imageIds.length === 0) {
    return { ok: false, error: "Select at least one image." };
  }

  const parsed = parseDeclaration(form);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const badge = parseBadgeSettings(form);
  if (!badge.ok) return { ok: false, error: badge.error };

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    shopDomain;

  // Placement is only meaningful when a label is actually being applied;
  // clearing an image back to "not AI" leaves its position untouched.
  const placement =
    form.get("intent") === "apply"
      ? clampPlacement({
          x: Number(form.get("badgeX")),
          y: Number(form.get("badgeY")),
          heightPct: Number(form.get("badgeHeightPct")),
        })
      : null;

  try {
    const result = await applyDeclarationToImages({
      shopDomain,
      imageIds,
      declaration: parsed.value,
      badge: badge.value,
      placement,
      actor,
      admin,
    });

    return { ok: true, applied: result.applied, skipped: result.skipped };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save",
    };
  }
};

export default function ProductEditorRoute() {
  const { product, images, defaults } = useLoaderData<typeof loader>();
  const state = describeState(product.disclosureState);
  const unresolved = images.filter((image) => image.disclosureState === "unknown");

  return (
    <s-page heading={product.title}>
      <s-section>
        <s-stack direction="block" gap="small">
          <Link to="/app">
            <s-button variant="tertiary" icon="chevron-left">
              All products
            </s-button>
          </Link>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone={state.tone}>{state.label}</s-badge>
            <s-text color="subdued">
              {images.length} image{images.length === 1 ? "" : "s"} on this product
              page · assessed {formatDateTime(product.lastAssessedAt)}
            </s-text>
          </s-stack>
          {unresolved.length > 0 && (
            <s-paragraph>
              {unresolved.length} of {images.length} still need an answer.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <ProductEditor images={images} defaults={defaults} />
    </s-page>
  );
}
