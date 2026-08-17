import { describe, expect, it } from "vitest";

import {
  embeddedPath,
  redirectEmbedded,
} from "~/lib/embedded-redirect.server";

const HOST = "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvbmFub2FwcHMtdWh1NHNrMHU";
const SHOP = "nanoapps-uhu4sk0u.myshopify.com";

// A representative first load from the admin: Shopify sends shop, host and
// embedded, plus the session token the bounce page obtained.
const ADMIN_LOAD =
  `https://eu-ai-labels.onrender.com/app` +
  `?shop=${SHOP}&host=${HOST}&embedded=1&id_token=eyJhbGc.payload.sig&locale=en`;

describe("embeddedPath", () => {
  it("carries shop, host and embedded onto the target", () => {
    const path = embeddedPath(ADMIN_LOAD, "/app/terms");
    const params = new URL(path, "https://x.test").searchParams;

    expect(path.startsWith("/app/terms?")).toBe(true);
    expect(params.get("shop")).toBe(SHOP);
    expect(params.get("host")).toBe(HOST);
    expect(params.get("embedded")).toBe("1");
  });

  // The regression this module exists for. A target without shop is answered by
  // authenticate.admin() with a redirect to the login form, which inside the
  // admin iframe cannot be completed.
  it("never produces a path without shop when the request had one", () => {
    for (const to of ["/app", "/app/terms", "/app?filter=review"]) {
      const params = new URL(embeddedPath(ADMIN_LOAD, to), "https://x.test")
        .searchParams;
      expect(params.get("shop"), `carried onto ${to}`).toBe(SHOP);
    }
  });

  it("keeps query params the target already carries", () => {
    const params = new URL(
      embeddedPath(ADMIN_LOAD, "/app?filter=review"),
      "https://x.test",
    ).searchParams;

    expect(params.get("filter")).toBe("review");
    expect(params.get("shop")).toBe(SHOP);
  });

  it("lets the target override a carried param deliberately", () => {
    const other = "other-shop.myshopify.com";
    const params = new URL(
      embeddedPath(ADMIN_LOAD, `/app?shop=${other}`),
      "https://x.test",
    ).searchParams;

    expect(params.get("shop")).toBe(other);
    expect(params.getAll("shop")).toHaveLength(1);
  });

  // id_token is single-use and lives about a minute. Forwarding it would send a
  // spent token; omitting it costs one bounce through /auth/session-token.
  it("does not forward id_token or other incidental params", () => {
    const params = new URL(embeddedPath(ADMIN_LOAD, "/app/terms"), "https://x.test")
      .searchParams;

    expect(params.get("id_token")).toBeNull();
    expect(params.get("locale")).toBeNull();
  });

  it("omits params the request did not have", () => {
    const path = embeddedPath(
      `https://eu-ai-labels.onrender.com/app?shop=${SHOP}`,
      "/app/terms",
    );

    expect(path).toBe(`/app/terms?shop=${SHOP}`);
  });

  it("returns a bare path when there is no context to carry", () => {
    expect(embeddedPath("https://eu-ai-labels.onrender.com/app", "/app/terms")).toBe(
      "/app/terms",
    );
  });

  it("stays same-origin even if handed an absolute URL", () => {
    const path = embeddedPath(ADMIN_LOAD, "https://evil.test/app/terms");
    expect(path.startsWith("/app/terms")).toBe(true);
    expect(path).not.toContain("evil.test");
  });
});

describe("redirectEmbedded", () => {
  it("is a 302 to the resolved path", () => {
    const response = redirectEmbedded(new Request(ADMIN_LOAD), "/app/terms");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      embeddedPath(ADMIN_LOAD, "/app/terms"),
    );
    expect(response.headers.get("Location")).toContain(`shop=${SHOP}`);
  });
});
