import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { loadChain, verifyShopChain } from "~/lib/audit.server";
import { chainHead } from "~/lib/compliance/audit";
import { describeAction, formatDateTime, shortHash } from "~/lib/display";

const PAGE_SIZE = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const page = Math.max(
    0,
    Number(new URL(request.url).searchParams.get("page") ?? "0") || 0,
  );

  const [verification, total, entries] = await Promise.all([
    verifyShopChain(shopDomain),
    prisma.auditEntry.count({ where: { shopDomain } }),
    loadChain(shopDomain, { offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
  ]);

  const full = await loadChain(shopDomain);

  return {
    verification,
    head: chainHead(full),
    total,
    page,
    pageCount: Math.ceil(total / PAGE_SIZE),
    entries: entries.map((entry) => ({
      seq: entry.seq,
      action: entry.action,
      actor: entry.actor,
      subject: entry.subject,
      createdAt: entry.createdAt.toISOString(),
      hash: entry.hash,
      payload: entry.payload,
    })),
  };
};

export default function AuditTrail() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentPage = Number(searchParams.get("page") ?? "0") || 0;

  return (
    <s-page heading="Audit trail">
      <s-section heading="Integrity">
        <s-paragraph>
          <s-text color="subdued">{data.total} entries recorded.</s-text>
        </s-paragraph>
        {data.verification.valid ? (
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="success" icon="shield-check-mark">
                Chain verified
              </s-badge>
              <s-text>{data.verification.length} entries recomputed and matched.</s-text>
            </s-stack>
            <s-paragraph>
              <s-text color="subdued">Head hash: </s-text>
              <code>{data.head}</code>
            </s-paragraph>
            <s-paragraph>
              <s-text color="subdued">
                This single value fixes the entire history. Record it somewhere
                outside this app — an email to yourself is enough — and any later
                rewrite of the record becomes provable rather than merely
                unlikely.
              </s-text>
            </s-paragraph>
          </s-stack>
        ) : (
          <s-banner tone="critical" heading="Verification failed">
            <s-paragraph>{data.verification.reason}</s-paragraph>
            <s-paragraph>
              Entries before {data.verification.brokenAt} are still intact.
              From that point the record cannot be relied on as evidence.
            </s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section heading="Export">
        <s-paragraph>
          Export the full chain as CSV, including the hash columns, so a
          recipient can re-verify it independently.
        </s-paragraph>
        {/*
          Opened in a new top-level tab rather than fetched into the iframe:
          an embedded app cannot hand the browser a file download from inside
          the Shopify frame, and App Bridge attaches the session token to the
          navigation so the resource route can still authenticate.
        */}
        <s-button href="/app/audit-export" target="_blank" icon="export">
          Download CSV
        </s-button>
      </s-section>

      <s-section heading="Entries">
        <s-table>
          <s-table-header-row>
            <s-table-header>#</s-table-header>
            <s-table-header>When</s-table-header>
            <s-table-header>Action</s-table-header>
            <s-table-header>Actor</s-table-header>
            <s-table-header>Hash</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.entries.map((entry) => (
              <s-table-row key={entry.seq}>
                <s-table-cell>{entry.seq}</s-table-cell>
                <s-table-cell>{formatDateTime(entry.createdAt)}</s-table-cell>
                <s-table-cell>{describeAction(entry.action)}</s-table-cell>
                <s-table-cell>{entry.actor}</s-table-cell>
                <s-table-cell>
                  <code>{shortHash(entry.hash)}</code>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {data.pageCount > 1 && (
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            {currentPage > 0 && (
              <Link to={`/app/audit?page=${currentPage - 1}`}>
                <s-button icon="chevron-left">Previous</s-button>
              </Link>
            )}
            <s-text>
              Page {currentPage + 1} of {data.pageCount}
            </s-text>
            {currentPage + 1 < data.pageCount && (
              <Link to={`/app/audit?page=${currentPage + 1}`}>
                <s-button icon="chevron-right">Next</s-button>
              </Link>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
