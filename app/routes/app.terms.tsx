import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { TERMS, TERMS_ACKNOWLEDGEMENT, TERMS_VERSION } from "~/lib/terms";
import { formatDateTime } from "~/lib/display";
import { redirectEmbedded } from "~/lib/embedded-redirect.server";
import { boolAttr } from "~/lib/polaris-form";
import { useLiveFieldChecked } from "~/hooks/useFieldValues";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });

  return {
    terms: TERMS,
    version: TERMS_VERSION,
    accepted: shop?.termsVersion === TERMS_VERSION,
    acceptedAt: shop?.disclaimerAcceptedAt?.toISOString() ?? null,
    acceptedBy: shop?.disclaimerAcceptedBy ?? null,
    // A merchant who accepted older wording is re-prompted rather than
    // silently carried over; that acceptance was to different terms.
    supersededVersion:
      shop?.termsVersion && shop.termsVersion !== TERMS_VERSION
        ? shop.termsVersion
        : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    shopDomain;

  const acceptedAt = new Date();

  await prisma.shop.update({
    where: { domain: shopDomain },
    data: {
      disclaimerAcceptedAt: acceptedAt,
      disclaimerAcceptedBy: actor,
      termsVersion: TERMS_VERSION,
    },
  });

  await appendAudit(shopDomain, {
    action: "disclaimer.accepted",
    actor,
    createdAt: acceptedAt,
    payload: {
      termsVersion: TERMS_VERSION,
      acknowledgement: TERMS_ACKNOWLEDGEMENT,
      // The full text is recorded, so what was agreed to can be reconstructed
      // even after the wording changes.
      clauses: TERMS.map((clause) => ({
        heading: clause.heading,
        body: clause.body,
      })),
    },
  });

  throw redirectEmbedded(request, "/app");
};

// Named once so the checkbox and the hook watching it cannot drift apart.
const CONFIRM_FIELD = "confirmed";

export default function Terms() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  const containerRef = useRef<HTMLDivElement>(null);
  const confirmed = useLiveFieldChecked(containerRef, CONFIRM_FIELD);

  return (
    <s-page heading="Terms of use">
      <div ref={containerRef}>
        {data.supersededVersion && (
          <s-banner tone="warning" heading="These terms have changed">
            <s-paragraph>
              You accepted version {data.supersededVersion}. Please read and accept
              the current version to continue.
            </s-paragraph>
          </s-banner>
        )}

        <s-section>
          <s-paragraph>
            <s-text type="strong">
              Please read this before using the app. You need to accept it to
              continue.
            </s-text>
          </s-paragraph>
          <s-paragraph>
            <s-text color="subdued">Version {data.version}</s-text>
          </s-paragraph>
        </s-section>

        {data.terms.map((clause) => (
          <s-section key={clause.heading} heading={clause.heading}>
            {clause.body.map((paragraph, index) => (
              <s-paragraph key={index}>{paragraph}</s-paragraph>
            ))}
          </s-section>
        ))}

        <s-section>
          {data.accepted ? (
            <s-stack direction="block" gap="small">
              <s-badge tone="success" icon="check-circle">
                Accepted
              </s-badge>
              <s-text color="subdued">
                Accepted by {data.acceptedBy}
                {data.acceptedAt ? ` on ${formatDateTime(data.acceptedAt)}` : ""}.
                This acceptance is recorded in your audit trail.
              </s-text>
            </s-stack>
          ) : (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Accepting records your agreement in the audit trail, with your name
                and the time, alongside the full text above.
              </s-paragraph>
              {/*
                Ticking the box is a deliberate, separate act from pressing the
                button. That matters for what this page is: the record says the
                merchant affirmed they read the terms, not merely that they
                clicked the only enabled control on the screen.
              */}
              <s-checkbox
                name={CONFIRM_FIELD}
                label="I have read and understood these terms"
              />
              <s-button
                variant="primary"
                disabled={boolAttr(!confirmed || busy)}
                onClick={() => fetcher.submit({}, { method: "post" })}
              >
                {busy ? "Recording…" : "Accept and continue"}
              </s-button>
            </s-stack>
          )}
        </s-section>
      </div>
    </s-page>
  );
}
