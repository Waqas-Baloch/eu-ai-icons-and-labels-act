import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const productId = (payload as { admin_graphql_api_id?: string })
    .admin_graphql_api_id;
  if (!productId) return new Response();

  // The assessment rows go, but the audit entries stay — they record what was
  // disclosed while the product was live, which is the point of the trail.
  await prisma.productAssessment.deleteMany({
    where: { shopDomain: shop, productId },
  });

  return new Response();
};
