import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";

/**
 * The mandatory privacy webhooks required for App Store review.
 *
 * This app processes product imagery and staff decisions, not customer data.
 * The customer topics therefore have nothing to return or erase, but they must
 * still be answered — Shopify checks that the endpoints exist and verify HMAC.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // No customer personal data is stored. Nothing to disclose or erase.
      break;

    case "SHOP_REDACT": {
      // Sent 48 hours after uninstall. Now the shop's data really does go,
      // audit chain included — retention beyond this point is not ours to
      // choose. Merchants who need the trail for their own records should
      // export it before uninstalling; the app warns about this on uninstall.
      await prisma.shop.deleteMany({ where: { domain: shop } });
      // Rows whose shop was never created still need clearing.
      await prisma.auditEntry.deleteMany({ where: { shopDomain: shop } });
      await prisma.imageAssessment.deleteMany({ where: { shopDomain: shop } });
      await prisma.productAssessment.deleteMany({ where: { shopDomain: shop } });
      await prisma.scanRun.deleteMany({ where: { shopDomain: shop } });
      await prisma.session.deleteMany({ where: { shop } });
      break;
    }

    default:
      // eslint-disable-next-line no-console
      console.warn(`Unhandled privacy topic ${topic} for ${shop}`);
  }

  return new Response();
};
