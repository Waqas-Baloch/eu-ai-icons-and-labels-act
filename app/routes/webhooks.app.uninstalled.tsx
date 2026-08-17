import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  // Shopify retries webhooks, so this can arrive more than once.
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  const existing = await prisma.shop.findUnique({ where: { domain: shop } });
  if (existing) {
    await prisma.shop.update({
      where: { domain: shop },
      data: { uninstalledAt: new Date(), plan: "none", subscriptionId: null },
    });

    // The audit chain deliberately survives uninstall. A merchant may need to
    // evidence what was disclosed during a period when the app was live, long
    // after removing it. Full erasure happens on the shop/redact webhook.
    await appendAudit(shop, {
      action: "app.uninstalled",
      actor: `webhook:${topic}`,
      payload: { shop },
    });
  }

  return new Response();
};
