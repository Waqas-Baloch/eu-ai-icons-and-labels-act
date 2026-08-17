import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import { appendAudit } from "~/lib/audit.server";
import { scanCatalog } from "~/lib/scan.server";
import { boolAttr, collectFields } from "~/lib/polaris-form";
import { useFieldValues } from "~/hooks/useFieldValues";
import { redirectEmbedded } from "~/lib/embedded-redirect.server";

/**
 * Guided setup.
 *
 * Five steps, resumable: the merchant's position is stored on the shop so
 * closing the tab does not lose progress. The order matters — the
 * acknowledgement comes first because everything after it is the merchant
 * acting on the app's assessments, and the scan comes before the settings so
 * the posture choice is made with real numbers on screen.
 */

export const STEPS = [
  { id: "acknowledge", title: "How this app works" },
  { id: "scan", title: "Scan your catalog" },
  { id: "posture", title: "Choose your posture" },
  { id: "appearance", title: "Pick the badge look" },
  { id: "activate", title: "Turn on the storefront label" },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const [shop, settings, productCount, flaggedCount] = await Promise.all([
    prisma.shop.findUnique({ where: { domain: shopDomain } }),
    prisma.settings.findUnique({ where: { shopDomain } }),
    prisma.productAssessment.count({ where: { shopDomain } }),
    prisma.imageAssessment.count({
      where: { shopDomain, disclosureState: { not: "not_required" } },
    }),
  ]);

  if (shop?.onboardingCompletedAt) throw redirectEmbedded(request, "/app");

  return {
    step: Math.min(shop?.onboardingStep ?? 0, STEPS.length - 1),
    shopDomain,
    productCount,
    flaggedCount,
    settings: {
      conservativeDefault: settings?.conservativeDefault ?? true,
      labelPreCutoffContent: settings?.labelPreCutoffContent ?? false,
      badgeVariant: settings?.badgeVariant ?? "black",
      badgePlacement: settings?.badgePlacement ?? "bottom_left",
      badgeSize: settings?.badgeSize ?? "medium",
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const actor =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ??
    shopDomain;

  switch (intent) {
    case "acknowledge": {
      // The terms gate already captured acceptance before the wizard was
      // reachable; this step is a recap, so it only advances progress.
      await prisma.shop.update({
        where: { domain: shopDomain },
        data: { onboardingStep: 1 },
      });
      return { ok: true };
    }

    case "scan": {
      try {
        const result = await scanCatalog(admin, shopDomain, "install");
        await prisma.shop.update({
          where: { domain: shopDomain },
          data: { onboardingStep: 2 },
        });
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Scan failed",
        };
      }
    }

    case "posture": {
      await prisma.settings.upsert({
        where: { shopDomain },
        create: {
          shopDomain,
          conservativeDefault: form.get("conservativeDefault") === "on",
          labelPreCutoffContent: form.get("labelPreCutoffContent") === "on",
        },
        update: {
          conservativeDefault: form.get("conservativeDefault") === "on",
          labelPreCutoffContent: form.get("labelPreCutoffContent") === "on",
        },
      });
      await prisma.shop.update({
        where: { domain: shopDomain },
        data: { onboardingStep: 3 },
      });
      return { ok: true };
    }

    case "appearance": {
      await prisma.settings.upsert({
        where: { shopDomain },
        create: {
          shopDomain,
          badgeVariant: String(form.get("badgeVariant") ?? "black"),
          badgePlacement: String(form.get("badgePlacement") ?? "bottom_left"),
          badgeSize: String(form.get("badgeSize") ?? "medium"),
        },
        update: {
          badgeVariant: String(form.get("badgeVariant") ?? "black"),
          badgePlacement: String(form.get("badgePlacement") ?? "bottom_left"),
          badgeSize: String(form.get("badgeSize") ?? "medium"),
        },
      });
      await prisma.shop.update({
        where: { domain: shopDomain },
        data: { onboardingStep: 4 },
      });
      return { ok: true };
    }

    case "finish": {
      await prisma.shop.update({
        where: { domain: shopDomain },
        data: {
          onboardingCompletedAt: new Date(),
          themeActivatedAt: new Date(),
          onboardingStep: STEPS.length,
        },
      });
      // Land on the products list filtered to what still needs answering —
      // the merchant finishes setup already looking at their next task.
      throw redirectEmbedded(request, "/app?filter=review");
    }

    case "back": {
      const to = Math.max(0, Number(form.get("to") ?? 0));
      await prisma.shop.update({
        where: { domain: shopDomain },
        data: { onboardingStep: to },
      });
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unknown step" };
  }
};

export default function Setup() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; error?: string; result?: unknown }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const busy = fetcher.state !== "idle";
  const step = data.step;

  useFieldValues(containerRef, {
    conservativeDefault: data.settings.conservativeDefault,
    labelPreCutoffContent: data.settings.labelPreCutoffContent,
    badgeVariant: data.settings.badgeVariant,
    badgePlacement: data.settings.badgePlacement,
    badgeSize: data.settings.badgeSize,
  });

  function send(intent: string, fields: Array<{ name: string; kind?: "checked" }> = []) {
    const data = containerRef.current
      ? collectFields(containerRef.current, fields)
      : new FormData();
    data.set("intent", intent);
    fetcher.submit(data, { method: "post" });
  }

  return (
    <s-page heading="Set up AI disclosure">
      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          {STEPS.map((entry, index) => (
            <s-badge
              key={entry.id}
              tone={index < step ? "success" : index === step ? "info" : "neutral"}
              icon={index < step ? "check" : undefined}
            >
              {index + 1}. {entry.title}
            </s-badge>
          ))}
        </s-stack>
        <s-paragraph>
          <s-text color="subdued">
            Step {step + 1} of {STEPS.length}
          </s-text>
        </s-paragraph>
      </s-section>

      <div ref={containerRef}>
        {step === 0 && (
          <s-section heading="How this app works">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                From 2 August 2026, Article 50(4) of the EU AI Act requires you to
                disclose AI-generated or AI-manipulated images that could pass for
                real photographs. Penalties reach €15 million or 3% of worldwide
                turnover, and they fall on you as the deployer — not on Shopify,
                and not on this app.
              </s-paragraph>
              <s-paragraph>
                This app reads the provenance metadata on your product images,
                applies the legal test, asks you to resolve what metadata cannot
                answer, renders the official EU labels on your storefront, and
                keeps a tamper-evident record of every decision.
              </s-paragraph>
              <s-banner tone="warning" heading="What it is not">
                <s-paragraph>
                  It is <s-text type="strong">not legal advice</s-text> and it does
                  not guarantee compliance. Whether an image resembles something
                  real and would pass as authentic is a judgement only you can
                  make. The app records your judgement; it does not replace it.
                </s-paragraph>
              </s-banner>
              <s-button
                variant="primary"
                disabled={boolAttr(busy)}
                onClick={() => send("acknowledge")}
              >
                I understand — continue
              </s-button>
            </s-stack>
          </s-section>
        )}

        {step === 1 && (
          <s-section heading="Scan your catalog">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                We will read the first part of each product image to look for C2PA
                Content Credentials, IPTC and EXIF provenance. Nothing is stored
                except the findings and a hash.
              </s-paragraph>
              <s-paragraph>
                <s-text color="subdued">
                  Most images will come back unresolved. That is expected —
                  Shopify strips metadata on upload, so an absent signature is not
                  evidence an image is not AI-generated. You will confirm those in
                  the next stage.
                </s-text>
              </s-paragraph>
              {busy && (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-spinner size="base" accessibilityLabel="Scanning" />
                  <s-text>Scanning your catalog…</s-text>
                </s-stack>
              )}
              {fetcher.data?.ok === false && (
                <s-banner tone="critical">
                  <s-paragraph>{fetcher.data.error}</s-paragraph>
                </s-banner>
              )}
              <s-button variant="primary" disabled={boolAttr(busy)} onClick={() => send("scan")}>
                {busy ? "Scanning…" : "Start scan"}
              </s-button>
            </s-stack>
          </s-section>
        )}

        {step === 2 && (
          <s-section heading="Choose your posture">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Found {data.productCount} products, {data.flaggedCount} images that
                may need a label.
              </s-paragraph>
              <s-switch
                name="conservativeDefault"
                label="Label unresolved images provisionally"
                details="Shows the generic 'AI' mark on images whose origin is not yet established. Over-labelling carries no penalty; under-labelling can cost up to €15 million or 3% of worldwide turnover. Recommended."
              />
              <s-switch
                name="labelPreCutoffContent"
                label="Also label AI content created before 2 August 2026"
                details="The Commission does not require retroactive labelling but encourages it. Off by default."
              />
              <s-stack direction="inline" gap="base">
                <s-button
                  variant="primary"
                  disabled={boolAttr(busy)}
                  onClick={() =>
                    send("posture", [
                      { name: "conservativeDefault", kind: "checked" },
                      { name: "labelPreCutoffContent", kind: "checked" },
                    ])
                  }
                >
                  Continue
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        )}

        {step === 3 && (
          <s-section heading="Pick the badge look">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                This is the default for every image. You can override the corner
                and artwork per image later.
              </s-paragraph>
              <s-select name="badgeVariant" label="Artwork">
                <s-option value="black">Black — solid (recommended)</s-option>
                <s-option value="white">White — solid</s-option>
                <s-option value="black_transparent">Black — translucent</s-option>
                <s-option value="white_transparent">White — translucent</s-option>
              </s-select>
              <s-select name="badgePlacement" label="Position on the image">
                <s-option value="bottom_left">Bottom left</s-option>
                <s-option value="bottom_right">Bottom right</s-option>
                <s-option value="top_left">Top left</s-option>
                <s-option value="top_right">Top right</s-option>
              </s-select>
              <s-select name="badgeSize" label="Size">
                <s-option value="small">Small</s-option>
                <s-option value="medium">Medium</s-option>
                <s-option value="large">Large</s-option>
              </s-select>
              <s-button
                variant="primary"
                disabled={boolAttr(busy)}
                onClick={() =>
                  send("appearance", [
                    { name: "badgeVariant" },
                    { name: "badgePlacement" },
                    { name: "badgeSize" },
                  ])
                }
              >
                Continue
              </s-button>
            </s-stack>
          </s-section>
        )}

        {step === 4 && (
          <s-section heading="Turn on the storefront label">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Two blocks need enabling in your theme. Both matter, and they do
                different jobs.
              </s-paragraph>
              <s-unordered-list>
                <s-list-item>
                  <s-text type="strong">AI content disclosure</s-text> — add this
                  block to your product template. It renders server-side, so the
                  notice is in the page from the first paint with no JavaScript.
                  This is the one that carries the obligation.
                </s-list-item>
                <s-list-item>
                  <s-text type="strong">AI disclosure overlay</s-text> — turn this
                  app embed on. It places the badge directly on product images.
                </s-list-item>
              </s-unordered-list>
              <s-banner tone="info">
                <s-paragraph>
                  Open your theme editor, then use Add block on the product
                  template and App embeds in the sidebar. We cannot detect this
                  automatically, so confirm below once done.
                </s-paragraph>
              </s-banner>
              <s-button variant="primary" disabled={boolAttr(busy)} onClick={() => send("finish")}>
                I&rsquo;ve enabled them — finish setup
              </s-button>
              <Link to="/app">
                <s-button variant="tertiary">Skip for now</s-button>
              </Link>
            </s-stack>
          </s-section>
        )}
      </div>
    </s-page>
  );
}
