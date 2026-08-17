import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";

import { login } from "~/shopify.server";

/**
 * Where a merchant arriving outside the Shopify admin types their shop domain.
 *
 * This route must exist separately from the `auth.$` splat. The splat calls
 * authenticate.admin(), and doing that on the configured login path fails with
 * "please make sure to call shopify.login() from that route instead" — the
 * merchant has no session yet, which is the entire point of being here.
 *
 * `login()` throws a redirect into OAuth on success, so reaching the render
 * means either no shop was supplied or the domain was rejected.
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors: LoginErrors = await login(request);
  return { errors, message: errorMessage(errors) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors: LoginErrors = await login(request);
  return { errors, message: errorMessage(errors) };
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
            <s-text-field
              name="shop"
              label="Shop domain"
              placeholder="example.myshopify.com"
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
