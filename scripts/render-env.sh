#!/usr/bin/env bash
# Prints the environment variables to paste into Render.
#
# Run locally and copy from your own terminal — these are live credentials and
# should not be pasted into a chat, a ticket, or a commit.
set -euo pipefail
cd "$(dirname "$0")/.."

get() { grep -E "^$1=" .env | cut -d= -f2- | tr -d '"'; }

echo "Paste these into Render -> your service -> Environment"
echo "Replace APP_URL once Render assigns your hostname."
echo
echo "SHOPIFY_API_KEY=$(npx --no-install shopify app env show 2>/dev/null | grep SHOPIFY_API_KEY | cut -d= -f2)"
echo "SHOPIFY_API_SECRET=$(npx --no-install shopify app env show 2>/dev/null | grep SHOPIFY_API_SECRET | cut -d= -f2)"
echo "SHOPIFY_APP_URL=https://REPLACE-ME.onrender.com"
echo "SCOPES=read_products,write_products"
echo "DATABASE_URL=$(get DATABASE_URL)"
echo "DIRECT_URL=$(get DIRECT_URL)"
echo "NODE_ENV=production"
echo "SHOPIFY_BILLING_TEST=0"
