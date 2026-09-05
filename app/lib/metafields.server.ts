/**
 * Publishes disclosure decisions to product metafields.
 *
 * The storefront reads these directly in Liquid rather than calling back to the
 * app. That matters for a disclosure obligation: Article 50(4) requires the
 * label to be perceivable at first exposure, so it has to render with the page
 * itself — not after a round trip that a slow network, a blocked request or a
 * caching layer could drop.
 */

/**
 * Structural type for the admin GraphQL client, so this module does not depend
 * on an internal type name from the Shopify package.
 */
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export const METAFIELD_NAMESPACE = "eu_ai_act";

export const METAFIELD_KEYS = {
  /** Product-level rolled-up state: required | reduced | not_required | unknown */
  STATE: "state",
  /** Which official EU label to draw: ai_generated | ai_modified | ai | none */
  LABEL: "label",
  /** Per-image decisions, keyed by media id. */
  IMAGES: "images",
  /** ISO timestamp of the assessment that produced this state. */
  ASSESSED_AT: "assessed_at",
} as const;

interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

const DEFINITIONS = [
  {
    key: METAFIELD_KEYS.STATE,
    name: "AI disclosure state",
    type: "single_line_text_field",
    description:
      "EU AI Act Article 50(4) disclosure state for this product's imagery.",
  },
  {
    key: METAFIELD_KEYS.LABEL,
    name: "AI disclosure label",
    type: "single_line_text_field",
    description: "Which official EU AI content label applies to this product.",
  },
  {
    key: METAFIELD_KEYS.IMAGES,
    name: "AI disclosure per image",
    type: "json",
    description: "Per-image disclosure decisions, keyed by media id.",
  },
  {
    key: METAFIELD_KEYS.ASSESSED_AT,
    name: "AI disclosure assessed at",
    type: "single_line_text_field",
    description: "When this product's imagery was last assessed.",
  },
];

const CREATE_DEFINITION = `#graphql
  mutation CreateAiDisclosureDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id key }
      userErrors { field message code }
    }
  }
`;

/**
 * Creates the metafield definitions. Idempotent: a definition that already
 * exists comes back as a TAKEN error, which is a success for our purposes.
 */
export async function ensureMetafieldDefinitions(
  admin: AdminGraphqlClient,
): Promise<{ created: string[]; existing: string[]; failed: UserError[] }> {
  const created: string[] = [];
  const existing: string[] = [];
  const failed: UserError[] = [];

  for (const definition of DEFINITIONS) {
    const response = await admin.graphql(CREATE_DEFINITION, {
      variables: {
        definition: {
          name: definition.name,
          namespace: METAFIELD_NAMESPACE,
          key: definition.key,
          description: definition.description,
          type: definition.type,
          ownerType: "PRODUCT",
          // The theme extension reads these in Liquid, so the storefront needs
          // read access; without it the badge silently never renders.
          access: { storefront: "PUBLIC_READ" },
        },
      },
    });

    const body = (await response.json()) as {
      data?: {
        metafieldDefinitionCreate?: {
          createdDefinition?: { id: string; key: string } | null;
          userErrors?: UserError[];
        };
      };
    };

    const result = body.data?.metafieldDefinitionCreate;
    const errors = result?.userErrors ?? [];

    if (result?.createdDefinition) {
      created.push(definition.key);
    } else if (errors.some((e) => e.code === "TAKEN")) {
      existing.push(definition.key);
    } else {
      failed.push(...errors);
    }
  }

  return { created, existing, failed };
}

const SET_METAFIELDS = `#graphql
  mutation SetAiDisclosureMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message code }
    }
  }
`;

export interface ImageDecision {
  imageId: string;
  state: string;
  /** The label actually shown — a merchant override, if set, is already applied. */
  label: string;
  provisional: boolean;
  /** CDN URL, used to derive a filename key the storefront can match on. */
  imageUrl?: string;
  /** Per-image corner override; null means inherit the shop setting. */
  corner?: string | null;
  /** Per-image artwork override; null means inherit the shop setting. */
  style?: string | null;
  /** True when the merchant chose the label rather than the engine. */
  labelOverridden?: boolean;
  /** Free placement: fractions of the safe area, and height as % of image. */
  x?: number | null;
  y?: number | null;
  heightPct?: number | null;
}

/**
 * Extracts the filename from a Shopify CDN URL, dropping the query string and
 * any size suffix the CDN appends.
 *
 * The storefront needs this because Liquid and the rendered DOM expose image
 * URLs, not media gids — so a filename is the only stable key both sides share.
 * `shirt_front_800x.jpg?v=17` and `shirt_front.jpg` must resolve alike.
 */
export function imageFileKey(url: string): string {
  const withoutQuery = url.split("?")[0];
  const filename = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  // Strip a trailing CDN size suffix such as _800x, _1024x1024, _grande.
  return filename
    .replace(/_(\d+x\d*|\d*x\d+)(?=\.[a-z0-9]+$)/i, "")
    .replace(/_(pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.[a-z0-9]+$)/i, "")
    .toLowerCase();
}

export interface ProductDecision {
  productId: string;
  state: string;
  label: string;
  assessedAt: Date;
  images: ImageDecision[];
}

const READ_METAFIELDS = `#graphql
  query DisclosureMetafields($id: ID!) {
    product(id: $id) {
      metafields(first: 10, namespace: "${METAFIELD_NAMESPACE}") {
        nodes { key value }
      }
    }
  }
`;

/**
 * JSON with object keys sorted, so an unchanged decision always serialises to
 * the same string.
 *
 * Without this the comparison below could see two byte-different encodings of
 * an identical decision, write anyway, and the loop would never converge.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val as Record<string, unknown>)
            .sort()
            .map((key) => [key, (val as Record<string, unknown>)[key]]),
        )
      : val,
  );
}

/**
 * Writes one product's decisions.
 *
 * The per-image payload is keyed two ways because the storefront has two ways
 * to reach it: an app block iterating `product.images` in Liquid knows each
 * image's numeric id, while the JS overlay only sees rendered `<img>` URLs.
 * Publishing both indexes means neither path has to guess.
 *
 * Writes only when something actually changed. This is not an optimisation: a
 * metafield write fires products/update, which this app subscribes to and
 * answers by re-assessing the product, which published again. The assessed_at
 * timestamp differed on every pass, so every write was a change and the cycle
 * could not converge. It ran at roughly 3,000 assessments an hour on one
 * merchant's catalogue, wrote 1.37 million audit rows, and exhausted the
 * server's memory until Render restarted it.
 *
 * assessed_at is deliberately excluded from the comparison — it is metadata
 * about when we looked, not part of the decision, and comparing it would
 * restore the loop exactly.
 */
export async function publishProductDecision(
  admin: AdminGraphqlClient,
  decision: ProductDecision,
): Promise<{ ok: boolean; errors: UserError[]; changed?: boolean }> {
  type Entry = {
    state: string;
    label: string;
    provisional: boolean;
    /** Omitted when the image inherits the shop default. */
    corner?: string;
    style?: string;
    // Free placement, published as short keys because this JSON is fetched on
    // every product page view.
    x?: number;
    y?: number;
    h?: number;
  };
  const byId: Record<string, Entry> = {};
  const byFile: Record<string, Entry> = {};

  for (const image of decision.images) {
    const entry: Entry = {
      state: image.state,
      label: image.label,
      provisional: image.provisional,
    };
    // Only per-image overrides are published; anything absent falls through to
    // the block settings, so changing the shop default keeps working.
    if (image.corner) entry.corner = image.corner;
    if (image.style) entry.style = image.style;

    // Rounded: three decimals is well under a pixel on any real image, and it
    // keeps the metafield small.
    if (typeof image.x === "number" && typeof image.y === "number") {
      entry.x = Math.round(image.x * 1000) / 1000;
      entry.y = Math.round(image.y * 1000) / 1000;
    }
    if (typeof image.heightPct === "number") {
      entry.h = Math.round(image.heightPct * 100) / 100;
    }

    byId[numericId(image.imageId)] = entry;
    if (image.imageUrl) byFile[imageFileKey(image.imageUrl)] = entry;
  }

  const imageMap = { byId, byFile };
  const imagesJson = canonicalJson(imageMap);

  // What is already on the product?
  const currentResponse = await admin.graphql(READ_METAFIELDS, {
    variables: { id: decision.productId },
  });
  const currentBody = (await currentResponse.json()) as {
    data?: { product?: { metafields?: { nodes?: { key: string; value: string }[] } } };
  };
  const current = new Map(
    (currentBody.data?.product?.metafields?.nodes ?? []).map((node) => [
      node.key,
      node.value,
    ]),
  );

  const unchanged =
    current.get(METAFIELD_KEYS.STATE) === decision.state &&
    current.get(METAFIELD_KEYS.LABEL) === decision.label &&
    current.get(METAFIELD_KEYS.IMAGES) === imagesJson;

  if (unchanged) return { ok: true, errors: [], changed: false };

  const response = await admin.graphql(SET_METAFIELDS, {
    variables: {
      metafields: [
        {
          ownerId: decision.productId,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEYS.STATE,
          value: decision.state,
          type: "single_line_text_field",
        },
        {
          ownerId: decision.productId,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEYS.LABEL,
          value: decision.label,
          type: "single_line_text_field",
        },
        {
          ownerId: decision.productId,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEYS.IMAGES,
          value: imagesJson,
          type: "json",
        },
        {
          ownerId: decision.productId,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEYS.ASSESSED_AT,
          value: decision.assessedAt.toISOString(),
          type: "single_line_text_field",
        },
      ],
    },
  });

  const body = (await response.json()) as {
    data?: { metafieldsSet?: { userErrors?: UserError[] } };
  };
  const errors = body.data?.metafieldsSet?.userErrors ?? [];
  return { ok: errors.length === 0, errors, changed: true };
}

/** Extracts the trailing numeric id from a Shopify gid. */
export function numericId(gid: string): string {
  const match = /(\d+)(?:\?.*)?$/.exec(gid);
  return match ? match[1] : gid;
}
