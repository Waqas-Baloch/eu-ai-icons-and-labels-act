import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { login } from "~/shopify.server";

/**
 * Entry point for a merchant arriving outside the embedded admin. If we know
 * the shop we send them straight into OAuth; otherwise the Shopify-hosted
 * login form collects the domain.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function Index() {
  return (
    <s-page heading="AI Disclosure for the EU AI Act">
      <s-section heading="Install on your store">
        <s-paragraph>
          Open this app from your Shopify admin to get started. It assesses your
          product imagery against the Article 50(4) transparency obligation and
          keeps a tamper-evident record of every decision.
        </s-paragraph>
        <s-paragraph>
          <s-text color="subdued">
            This app is compliance tooling, not legal advice.
          </s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
