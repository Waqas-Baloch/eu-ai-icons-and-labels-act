import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // No billing config. Plans live in the Partner Dashboard under Shopify App
  // Pricing, and Shopify runs the checkout; an app with App Pricing enabled is
  // forbidden from calling appSubscriptionCreate. billing.check() still works
  // without this block because managed pricing support is always on in the
  // library — see app/lib/entitlement.server.ts.
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    // Not optional. Shopify no longer accepts non-expiring offline tokens on
    // the Admin API — every call is rejected with "Non-expiring access tokens
    // are no longer accepted", which surfaces as a thrown Response and killed
    // the catalog scan outright. With this on, the library mints expiring
    // tokens and refreshes them before they lapse, storing the refresh token in
    // the Session columns of the same name.
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
