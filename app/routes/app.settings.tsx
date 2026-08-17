import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { reassessStored } from "~/lib/scan.server";
import { collectFields } from "~/lib/polaris-form";
import { useFieldValues } from "~/hooks/useFieldValues";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.settings.findUnique({
    where: { shopDomain: session.shop },
  });

  return {
    settings: settings ?? {
      badgeVariant: "black",
      badgePlacement: "bottom_left",
      badgeSize: "medium",
      showTextNotice: true,
      noticeText:
        "This image was created or edited using artificial intelligence.",
      conservativeDefault: true,
      labelPreCutoffContent: false,
      euOnlyRendering: false,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const form = await request.formData();

  const previous = await prisma.settings.findUnique({ where: { shopDomain } });

  const next = {
    badgeVariant: String(form.get("badgeVariant") ?? "black"),
    badgePlacement: String(form.get("badgePlacement") ?? "bottom_left"),
    badgeSize: String(form.get("badgeSize") ?? "medium"),
    showTextNotice: form.get("showTextNotice") === "on",
    noticeText: String(
      form.get("noticeText") ??
        "This image was created or edited using artificial intelligence.",
    ).slice(0, 500),
    conservativeDefault: form.get("conservativeDefault") === "on",
    labelPreCutoffContent: form.get("labelPreCutoffContent") === "on",
    euOnlyRendering: form.get("euOnlyRendering") === "on",
  };

  await prisma.settings.upsert({
    where: { shopDomain },
    create: { shopDomain, ...next },
    update: next,
  });

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    shopDomain;

  await appendAudit(shopDomain, {
    action: "settings.changed",
    actor,
    payload: {
      from: previous
        ? {
            conservativeDefault: previous.conservativeDefault,
            labelPreCutoffContent: previous.labelPreCutoffContent,
            euOnlyRendering: previous.euOnlyRendering,
          }
        : null,
      to: {
        conservativeDefault: next.conservativeDefault,
        labelPreCutoffContent: next.labelPreCutoffContent,
        euOnlyRendering: next.euOnlyRendering,
      },
    },
  });

  // The two compliance-posture switches change what the engine concludes, so
  // stored assessments have to be recomputed and republished rather than left
  // showing decisions made under the old policy.
  const policyChanged =
    !previous ||
    previous.conservativeDefault !== next.conservativeDefault ||
    previous.labelPreCutoffContent !== next.labelPreCutoffContent;

  let reassessed = 0;
  if (policyChanged) {
    reassessed = await reassessStored(shopDomain, admin);
  }

  return { ok: true, reassessed, policyChanged };
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const containerRef = useRef<HTMLDivElement>(null);
  const busy = fetcher.state !== "idle";

  // Without this the selects show their first option and the switches read as
  // off, regardless of what is stored — see applyFieldValues().
  useFieldValues(containerRef, {
    badgeVariant: settings.badgeVariant,
    badgePlacement: settings.badgePlacement,
    badgeSize: settings.badgeSize,
    noticeText: settings.noticeText,
    showTextNotice: settings.showTextNotice,
    conservativeDefault: settings.conservativeDefault,
    labelPreCutoffContent: settings.labelPreCutoffContent,
    euOnlyRendering: settings.euOnlyRendering,
  });

  function save() {
    if (!containerRef.current) return;
    const data = collectFields(containerRef.current, [
      { name: "badgeVariant" },
      { name: "badgePlacement" },
      { name: "badgeSize" },
      { name: "noticeText" },
      { name: "showTextNotice", kind: "checked" },
      { name: "conservativeDefault", kind: "checked" },
      { name: "labelPreCutoffContent", kind: "checked" },
      { name: "euOnlyRendering", kind: "checked" },
    ]);
    fetcher.submit(data, { method: "post" });
  }

  return (
    <s-page heading="Settings">
      <div ref={containerRef}>
        <s-section heading="Compliance posture">
          <s-stack direction="block" gap="base">
            <s-switch
              name="conservativeDefault"
              label="Label unresolved images provisionally"
              details="Shows the generic 'AI' label on images whose origin has not been established, until you declare them. Over-labelling carries no penalty; under-labelling can cost up to €15 million or 3% of worldwide turnover."
            />
            <s-switch
              name="labelPreCutoffContent"
              label="Label AI content created before 2 August 2026"
              details="The Commission does not require retroactive labelling of content generated before Article 50 applied, but encourages it. Off by default."
            />
            <s-switch
              name="euOnlyRendering"
              label="Show labels to EU and EEA visitors only"
              details="The obligation is territorial. Leaving this off shows labels to everyone, which is simpler and cannot under-disclose."
            />
          </s-stack>
        </s-section>

        <s-section heading="Storefront appearance">
          <s-stack direction="block" gap="base">
            <s-select
              name="badgeVariant"
              label="Badge style"
              details="The official EU label artwork. The translucent variants draw the pill at 50% opacity, which reads faintly on light photography — solid is recommended."
              value={settings.badgeVariant}
            >
              <s-option value="black">Black — solid (recommended)</s-option>
              <s-option value="white">White — solid</s-option>
              <s-option value="black_transparent">Black — translucent</s-option>
              <s-option value="white_transparent">White — translucent</s-option>
            </s-select>

            <s-select
              name="badgePlacement"
              label="Badge position"
              value={settings.badgePlacement}
            >
              <s-option value="bottom_left">Bottom left</s-option>
              <s-option value="bottom_right">Bottom right</s-option>
              <s-option value="top_left">Top left</s-option>
              <s-option value="top_right">Top right</s-option>
            </s-select>

            <s-select name="badgeSize" label="Badge size" value={settings.badgeSize}>
              <s-option value="small">Small</s-option>
              <s-option value="medium">Medium</s-option>
              <s-option value="large">Large</s-option>
            </s-select>

            <s-switch
              name="showTextNotice"
              label="Also show a text notice"
              details="A visible caption alongside the badge. The AI Act requires disclosure to be perceivable without special tools, and text is the most robust way to meet that."
            />

            <s-text-field
              name="noticeText"
              label="Notice text"
              value={settings.noticeText}
            />
          </s-stack>
        </s-section>

        <s-section>
          <s-button variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save settings"}
          </s-button>

          {fetcher.data?.ok && (
            <s-banner tone="success">
              <s-paragraph>
                Settings saved.
                {fetcher.data.policyChanged
                  ? ` ${fetcher.data.reassessed} image assessment${fetcher.data.reassessed === 1 ? "" : "s"} recomputed under the new policy.`
                  : ""}
              </s-paragraph>
            </s-banner>
          )}
        </s-section>
      </div>
    </s-page>
  );
}
