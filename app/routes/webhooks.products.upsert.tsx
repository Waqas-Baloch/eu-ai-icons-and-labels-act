import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "~/shopify.server";
import { assessProductById } from "~/lib/scan.server";

/**
 * Re-assesses a product whenever it is created or its images change.
 *
 * This is what keeps a merchant compliant after the initial scan: a product
 * photo swapped for an AI-generated one months later gets caught without
 * anyone remembering to re-run anything.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin, topic } = await authenticate.webhook(request);

  // `admin` is absent when the app has already been uninstalled but a webhook
  // was still in flight.
  if (!admin) return new Response();

  const productId = (payload as { admin_graphql_api_id?: string })
    .admin_graphql_api_id;
  if (!productId) return new Response();

  try {
    await assessProductById(admin, shop, productId);
  } catch (error) {
    // Never 500 back to Shopify: that triggers retries and eventually gets the
    // subscription disabled. Log and acknowledge; the next scan will catch it.
    // eslint-disable-next-line no-console
    console.error(`Failed to assess ${productId} for ${shop} (${topic})`, error);
  }

  return new Response();
};
