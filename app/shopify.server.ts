import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

import prisma from "./db.server";
import { PLANS, PLAN_PRICE_USD } from "./lib/plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // Amount comes from lib/plans.ts so the price the merchant is shown and the
  // price they are charged cannot drift apart.
  //
  // trialDays is 0 on purpose. The free week is ours — granted at install, with
  // no card and no subscription (see lib/entitlement.ts) — and the billing
  // route passes whatever is left of it to billing.request() per merchant. A
  // standing trial here would stack on top of that and give away fourteen days.
  billing: {
    [PLANS.UNLIMITED]: {
      lineItems: [
        {
          amount: PLAN_PRICE_USD,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 0,
    },
  },
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
