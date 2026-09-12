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
import { reassessStored } from "~/lib/scan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });

  // Where the merchant was when the terms interrupted them, if anywhere.
  // Only in-app paths, so this cannot be used to bounce them off-site.
  const requested = new URL(request.url).searchParams.get("return");
  const returnTo = requested?.startsWith("/app/") ? requested : null;

  return {
    returnTo,
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
  const { session, admin } = await authenticate.admin(request);
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

  // Release everything held back before this moment.
  //
  // While the terms were unaccepted the scan assessed products but published
  // nothing to them, so the storefront and the app disagreed. Accepting is the
  // point that resolves it: republish what is already known, so the labels the
  // app has been showing the merchant actually appear on their products.
  //
  // Failure here must not cost the merchant their acceptance, which is already
  // recorded above. The next scan or product edit republishes anything missed.
  try {
    await reassessStored(shopDomain, admin);
  } catch (error) {
    console.error(
      `[${shopDomain}] publishing held-back labels after acceptance failed:`,
      error instanceof Error ? error.message : error,
    );
  }

  // Back to whatever the merchant was doing when the terms interrupted them.
  // Read from the form rather than the URL: the submission does not
  // necessarily carry the query string, and only in-app paths are honoured.
  const form = await request.formData();
  const requested = String(form.get("return") ?? "");
  const safe = requested.startsWith("/app/") ? requested : "/app";
  throw redirectEmbedded(request, safe);
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
              {data.returnTo
                ? "Before your first labels go live, please read and accept this."
                : "Please read this. You will need to accept it before any label reaches your storefront."}
            </s-text>
          </s-paragraph>
          {data.returnTo && (
            <s-paragraph>
              <s-text color="subdued">
                Nothing has been published to your products yet. Accepting
                applies the labels you just chose and takes you back.
              </s-text>
            </s-paragraph>
          )}
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
                onClick={() =>
                  fetcher.submit(
                    { return: data.returnTo ?? "" },
                    { method: "post" },
                  )
                }
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
