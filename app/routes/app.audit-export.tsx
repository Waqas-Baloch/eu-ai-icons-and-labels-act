import type { LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "~/shopify.server";
import { appendAudit, exportShopChainCsv, shopChainHead } from "~/lib/audit.server";

/**
 * Streams the audit chain as CSV.
 *
 * The export is itself an audited event — recorded *after* the CSV is rendered,
 * so the exported file's own head hash stays the one a recipient can verify
 * against the rows they were given.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const csv = await exportShopChainCsv(shopDomain);
  const head = await shopChainHead(shopDomain);

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    session.shop;

  await appendAudit(shopDomain, {
    action: "export.generated",
    actor,
    payload: { headAtExport: head, bytes: csv.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="eu-ai-act-audit-${shopDomain}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
