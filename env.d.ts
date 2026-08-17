/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

// Teaches TSX about the <s-*> Polaris web components. The elements themselves
// come from the App Bridge / Polaris script tags in root.tsx, not from a
// bundled package — this reference is types only.
/// <reference types="@shopify/polaris-types" />

declare module "*.css";
