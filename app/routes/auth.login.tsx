import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";

import { login } from "~/shopify.server";

/**
 * Where a merchant arriving *outside* the Shopify admin types their shop domain.
 *
 * Two rules keep this route from breaking the embedded app, both learned the
 * hard way.
 *
 * 1. An embedded request is sent back to the app instead of being shown a login
 *    form. Inside the admin there is nothing to log into — token exchange
 *    already establishes the session — and rendering a form there strands the
 *    merchant on a page that cannot complete.
 *
 * 2. The loader never calls login(). login() redirects straight into OAuth
 *    whenever the request carries a shop, so a plain GET of
 *    /auth/login?shop=example.myshopify.com would navigate the iframe to
 *    accounts.shopify.com, which sets X-Frame-Options: DENY and renders as
 *    "refused to connect". OAuth now only ever starts from a deliberate POST.
 *
 * This route must also stay separate from the auth.$ splat: that calls
 * authenticate.admin(), and doing so on the configured login path fails with
 * "please make sure to call shopify.login() from that route instead".
 */

interface LoginErrors {
  shop?: LoginErrorType;
}

function errorMessage(errors: LoginErrors): string | null {
  if (errors.shop === LoginErrorType.MissingShop) {
    return "Enter your shop domain to log in.";
  }
  if (errors.shop === LoginErrorType.InvalidShop) {
    return "That does not look like a Shopify shop domain.";
  }
  return null;
}

/** Signals the request came from inside the Shopify admin frame. */
function isEmbedded(url: URL): boolean {
  return url.searchParams.get("embedded") === "1" || url.searchParams.has("host");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (isEmbedded(url)) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Render only. See rule 2 above — deliberately not calling login() here.
  return { shop: url.searchParams.get("shop") ?? "", message: null as string | null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // login() throws a redirect into OAuth on success, so reaching the return
  // means no shop was supplied or the domain was rejected.
  const errors: LoginErrors = await login(request);
  return { shop: "", message: errorMessage(errors) };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const message = actionData?.message ?? loaderData.message;

  return (
    <s-page heading="Log in">
      <s-section>
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Enter the shop you want to install this app on. If you reached this
              page from inside the Shopify admin, go back and open the app again.
            </s-paragraph>
            <s-text-field
              name="shop"
              label="Shop domain"
              placeholder="example.myshopify.com"
              defaultValue={loaderData.shop}
              autocomplete="on"
            />
            {message && (
              <s-banner tone="critical">
                <s-paragraph>{message}</s-paragraph>
              </s-banner>
            )}
            <s-button type="submit" variant="primary">
              Log in
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
