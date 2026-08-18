import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";

export const loader = async (_args: LoaderFunctionArgs) => {
  return { apiKey: process.env.SHOPIFY_API_KEY ?? "" };
};

/** The document shell, shared by the app and by the error boundary. */
function Document({
  apiKey,
  children,
}: {
  apiKey: string;
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/*
          App Bridge must be the first script and must not be deferred —
          Shopify requires it to initialise before anything else runs in the
          embedded frame. Polaris web components register the <s-*> elements.
        */}
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={apiKey}
        />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <Document apiKey={apiKey}>
      <Outlet />
    </Document>
  );
}

/**
 * The last line of defence, and the reason it exists.
 *
 * Without a root boundary, anything that escapes a route — including errors
 * that boundary.error() deliberately rethrows because they are not Shopify's
 * to handle — leaves the embedded frame completely blank. No message, nothing
 * in the console the parent frame can read, and no way for a merchant to tell
 * a broken page from a slow one. That is precisely how a blank product editor
 * reached production unnoticed.
 *
 * The message is shown rather than hidden. This is an admin surface whose only
 * audience is the shop owner and whoever they ask for help, and "something went
 * wrong" wastes the one piece of information worth having. The stack is not
 * shown — that stays in the server logs.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  const status = isRouteErrorResponse(error) ? error.status : null;
  const detail = isRouteErrorResponse(error)
    ? error.data || error.statusText
    : error instanceof Error
      ? error.message
      : String(error ?? "Unknown error");

  return (
    // The API key is unavailable here: the root loader may be what failed. App
    // Bridge simply does not initialise, which is acceptable on an error page.
    <Document apiKey="">
      <div
        style={{
          font: "15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          maxWidth: "42rem",
          margin: "3rem auto",
          padding: "0 1.5rem",
          color: "#303030",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
          {status === 404 ? "Not found" : "This page could not be loaded"}
        </h1>
        <p style={{ margin: "0 0 1rem", color: "#616161" }}>
          {status === 404
            ? "The page you asked for does not exist in this app."
            : "Something failed while rendering this page. The detail below is what went wrong."}
        </p>
        <pre
          style={{
            background: "#f1f1f1",
            border: "1px solid #e3e3e3",
            borderRadius: "8px",
            padding: "0.75rem 1rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: "13px",
            margin: "0 0 1.25rem",
          }}
        >
          {status ? `${status} — ` : ""}
          {detail}
        </pre>
        <a href="/app" style={{ color: "#005bd3" }}>
          Back to products
        </a>
      </div>
    </Document>
  );
}
