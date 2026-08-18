import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import type { Prisma } from "@prisma/client";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { verifyShopChain } from "~/lib/audit.server";
import { scanCatalog } from "~/lib/scan.server";
import { describeState } from "~/lib/display";
import { EmptyState } from "~/components/EmptyState";
import { boolAttr } from "~/lib/polaris-form";
import { requireUnlocked } from "~/lib/entitlement.server";

const PAGE_SIZE = 25;

/** Filters offered above the product list. */
const FILTERS = [
  { id: "all", label: "All products" },
  { id: "review", label: "Needs review" },
  { id: "labelled", label: "Labelled" },
  { id: "clear", label: "No label needed" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

function whereFor(shopDomain: string, filter: FilterId, query: string) {
  const where: Prisma.ProductAssessmentWhereInput = { shopDomain };

  if (filter === "review") where.disclosureState = "unknown";
  if (filter === "labelled") where.disclosureState = { in: ["required", "reduced"] };
  if (filter === "clear") where.disclosureState = "not_required";

  // SQLite's LIKE is case-insensitive for ASCII, which is what `contains`
  // compiles to. On Postgres this would need mode: "insensitive".
  if (query) where.title = { contains: query };

  return where;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const rawFilter = url.searchParams.get("filter") ?? "all";
  const filter: FilterId = FILTERS.some((f) => f.id === rawFilter)
    ? (rawFilter as FilterId)
    : "all";
  const query = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);

  const where = whereFor(shopDomain, filter, query);

  const [products, total, counts, imageCounts, chain, shop] = await Promise.all([
    prisma.productAssessment.findMany({
      where,
      orderBy: [{ needsReview: "desc" }, { title: "asc" }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        images: {
          orderBy: [{ isFeatured: "desc" }, { position: "asc" }],
          select: {
            imageId: true,
            imageUrl: true,
            isFeatured: true,
            disclosureState: true,
          },
        },
      },
    }),
    prisma.productAssessment.count({ where }),
    prisma.productAssessment.groupBy({
      by: ["disclosureState"],
      where: { shopDomain },
      _count: true,
    }),
    prisma.imageAssessment.groupBy({
      by: ["disclosureState"],
      where: { shopDomain },
      _count: true,
    }),
    verifyShopChain(shopDomain),
    prisma.shop.findUnique({ where: { domain: shopDomain } }),
  ]);

  const productCounts = Object.fromEntries(
    counts.map((row) => [row.disclosureState, row._count]),
  );
  const images = Object.fromEntries(
    imageCounts.map((row) => [row.disclosureState, row._count]),
  );
  const imageTotal = imageCounts.reduce((sum, row) => sum + row._count, 0);

  return {
    filter,
    query,
    page,
    total,
    pageCount: Math.ceil(total / PAGE_SIZE),
    catalogEmpty: Object.values(productCounts).reduce((a, b) => a + b, 0) === 0,
    onboardingComplete: Boolean(shop?.onboardingCompletedAt),
    imageTotal,
    imagesResolved: imageTotal - (images.unknown ?? 0),
    needsReviewCount: productCounts.unknown ?? 0,
    chainValid: chain.valid,
    products: products.map((product) => {
      const featured = product.images[0] ?? null;
      const unresolved = product.images.filter(
        (image) => image.disclosureState === "unknown",
      ).length;
      return {
        productId: product.productId,
        numericId: product.productId.split("/").pop() ?? "",
        title: product.title,
        disclosureState: product.disclosureState,
        imageCount: product.images.length,
        unresolved,
        featuredUrl: featured?.imageUrl ?? null,
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);

  // Remix does not run the parent layout loader before a child action, so the
  // page gate in routes/app.tsx does not cover this. A scan writes assessment
  // rows and spends Shopify API calls, so it is a write like any other.
  await requireUnlocked(session.shop, billing);

  try {
    const result = await scanCatalog(admin, session.shop, "manual");
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Scan failed",
    };
  }
};

export default function Products() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const busy = fetcher.state !== "idle";

  const percent =
    data.imageTotal > 0
      ? Math.round((data.imagesResolved / data.imageTotal) * 100)
      : 0;

  function linkTo(overrides: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(overrides)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const qs = next.toString();
    return qs ? `/app?${qs}` : "/app";
  }

  if (data.catalogEmpty) {
    return (
      <s-page heading="Products">
        <s-section>
          <EmptyState
            icon="search"
            tone="info"
            heading="Nothing scanned yet"
            body="Scan your catalog to list your products and check every product image for AI provenance."
            detail="We read only the first part of each image and store the findings — never the image itself."
          >
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                disabled={boolAttr(busy)}
                onClick={() => fetcher.submit({}, { method: "post" })}
              >
                {busy ? "Scanning…" : "Scan catalog"}
              </s-button>
              {!data.onboardingComplete && (
                <Link to="/app/setup">
                  <s-button>Guided setup</s-button>
                </Link>
              )}
            </s-stack>
          </EmptyState>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Products">
      {/* --- Status strip: one line, always the same shape --- */}
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          {data.needsReviewCount > 0 ? (
            <s-badge tone="critical">
              {data.needsReviewCount} product
              {data.needsReviewCount === 1 ? " needs" : "s need"} review
            </s-badge>
          ) : (
            <s-badge tone="success" icon="check-circle">
              All products reviewed
            </s-badge>
          )}
          <s-text color="subdued">
            {data.imagesResolved} of {data.imageTotal} images resolved ({percent}%)
          </s-text>
          <Link to="/app/audit">
            <s-button variant="tertiary" icon={data.chainValid ? "shield-check-mark" : "alert-triangle"}>
              Audit trail
            </s-button>
          </Link>
          <s-button
            variant="tertiary"
            disabled={boolAttr(busy)}
            onClick={() => fetcher.submit({}, { method: "post" })}
          >
            {busy ? "Scanning…" : "Rescan"}
          </s-button>
        </s-stack>
      </s-section>

      {/* --- Filter + search --- */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            {FILTERS.map((entry) => (
              <Link key={entry.id} to={linkTo({ filter: entry.id })}>
                <s-button
                  variant={data.filter === entry.id ? "primary" : "tertiary"}
                >
                  {entry.label}
                </s-button>
              </Link>
            ))}
          </s-stack>

          <Form method="get" action="/app">
            <input type="hidden" name="filter" value={data.filter} />
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-search-field
                name="q"
                label="Search products"
                value={data.query}
                placeholder="Search by title"
              />
              <s-button type="submit">Search</s-button>
              {data.query && (
                <Link to={linkTo({ q: "" })}>
                  <s-button variant="tertiary">Clear</s-button>
                </Link>
              )}
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      {/* --- The list --- */}
      <s-section>
        {data.products.length === 0 ? (
          <EmptyState
            icon="search"
            tone="info"
            heading="No products match"
            body={
              data.query
                ? `Nothing matching “${data.query}” in this view.`
                : "No products in this view."
            }
          >
            <Link to="/app">
              <s-button>Show all products</s-button>
            </Link>
          </EmptyState>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Images</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.products.map((product) => {
                const state = describeState(product.disclosureState);
                return (
                  <s-table-row key={product.productId}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small" alignItems="center">
                        {product.featuredUrl && (
                          <s-thumbnail
                            src={product.featuredUrl}
                            alt={product.title}
                            size="base"
                          />
                        )}
                        <s-text>{product.title}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {product.imageCount}
                      {product.unresolved > 0 ? ` · ${product.unresolved} to review` : ""}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={state.tone}>{state.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <Link to={`/app/products/${product.numericId}`}>
                        <s-button variant="tertiary" icon="chevron-right">
                          Open
                        </s-button>
                      </Link>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {data.pageCount > 1 && (
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            {data.page > 0 && (
              <Link to={`/app?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(data.page - 1) })}`}>
                <s-button icon="chevron-left">Previous</s-button>
              </Link>
            )}
            <s-text>
              Page {data.page + 1} of {data.pageCount} · {data.total} products
            </s-text>
            {data.page + 1 < data.pageCount && (
              <Link to={`/app?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(data.page + 1) })}`}>
                <s-button icon="chevron-right">Next</s-button>
              </Link>
            )}
          </s-stack>
        </s-section>
      )}

      {fetcher.data?.ok === false && "error" in fetcher.data && (
        <s-banner tone="critical" heading="Scan failed">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      {/*
        A scan stops on a time budget rather than running until something
        upstream times out. Saying so plainly matters here: silence would let a
        merchant believe a large catalog had been fully assessed when it had
        not, which is precisely the false assurance this app must not give.
      */}
      {fetcher.data?.ok === true &&
        "result" in fetcher.data &&
        fetcher.data.result.partial && (
          <s-banner tone="warning" heading="Catalog not fully scanned yet">
            <s-paragraph>
              {fetcher.data.result.productsSeen} product
              {fetcher.data.result.productsSeen === 1 ? "" : "s"} assessed so
              far. Run the scan again to continue — it picks up where it left
              off, and each run gets further because images already assessed are
              not re-checked.
            </s-paragraph>
          </s-banner>
        )}
    </s-page>
  );
}
