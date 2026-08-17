import { redirect } from "@remix-run/node";

/**
 * Redirecting inside an embedded Shopify app, without losing the shop.
 *
 * `authenticate.admin()` identifies an embedded request from the `shop` and
 * `host` query params. A request missing either is answered with a redirect to
 * the configured login path — see validate-shop-and-host-params in
 * @shopify/shopify-app-remix, which is the only place the library sends a
 * merchant there.
 *
 * That makes a bare `redirect("/app/terms")` from a loader quietly fatal. The
 * redirect drops the whole query string, the next request arrives with no shop,
 * and the merchant lands on the shop-domain login form *inside the admin
 * iframe* — where it cannot be completed either, because submitting it starts
 * OAuth and accounts.shopify.com sets X-Frame-Options: DENY. The terms gate
 * turned that into a closed loop: the gate redirected to a page that bounced to
 * a login that could not finish, so the terms could never be accepted and the
 * app never opened at all.
 *
 * Always route internal redirects through here rather than calling redirect()
 * with a bare app path.
 */

// The params authenticate.admin() needs to recognise the request. `id_token` is
// deliberately not among them: it is single-use and expires in about a minute,
// so the redirected request re-bounces through /auth/session-token for a fresh
// one rather than presenting a stale token.
const CARRIED_PARAMS = ["shop", "host", "embedded"] as const;

/**
 * Resolve `to` against the current request, carrying the Shopify context.
 * Params already present on `to` win, so a caller can override deliberately.
 */
export function embeddedPath(requestUrl: string, to: string): string {
  const from = new URL(requestUrl);
  const target = new URL(to, from.origin);

  for (const key of CARRIED_PARAMS) {
    const value = from.searchParams.get(key);
    if (value !== null && !target.searchParams.has(key)) {
      target.searchParams.set(key, value);
    }
  }

  return `${target.pathname}${target.search}`;
}

/** `throw redirectEmbedded(request, "/app")` from a loader or action. */
export function redirectEmbedded(request: Request, to: string): Response {
  return redirect(embeddedPath(request.url, to));
}
