# Deploying and publishing

`shopify app deploy` pushes your **app configuration and theme extension** to
Shopify. It does **not** deploy the Remix server. That has to be hosted
separately and reachable over HTTPS before anyone can install the app.

Order matters: host first, point Shopify at it second, submit third.

---

## Why not Vercel

Two reasons, both hard stops:

1. **The Hobby plan is non-commercial only.** This app charges through Shopify
   Billing, which is revenue. Running it on Hobby breaches Vercel's terms. Pro
   is $20/month, more than the alternatives below.
2. **Serverless functions cap at 60 seconds.** The catalog scan runs inline in
   the request and already struggles past a few hundred products. On Vercel it
   would hard-fail mid-scan with no way to resume.

Netlify has the same shape of problem. This app wants a long-running Node
server, not serverless functions.

## 1. Create the database (Neon, free)

Sign up at neon.tech, create a project, and copy the **pooled** connection
string. It looks like:

```
postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Take the pooled one (`-pooler` in the host). The app opens a connection per
instance and the pooler is what stops that exhausting the free connection
limit.

Neon's free tier does not expire. Render's own free Postgres does, after 90
days — a poor home for an audit chain merchants may need years later.

## 2. Regenerate the migrations for Postgres

`prisma/schema.prisma` is already switched to `postgresql`. The six existing
migrations were written for SQLite and will not replay on Postgres, so rebuild
them once against the Neon database:

```bash
rm -rf prisma/migrations && DATABASE_URL="postgresql://...your-neon-url..." npx prisma migrate dev --name init
```

Nothing is live yet, so there is no data to lose. Do it before launch, not
after.

## 3. Host the app (Render, free)

Push the repo to GitHub, then in the Render dashboard: **New → Blueprint**,
point it at the repo. `render.yaml` configures the service; the `Dockerfile`
installs, builds, prunes dev dependencies, and runs `prisma migrate deploy` on
boot so the schema is current before the first request.

Set the four secret variables in the dashboard: `SHOPIFY_API_KEY`,
`SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `DATABASE_URL`.

**Know what free costs you.** A Render free service sleeps after 15 minutes idle
and takes around a minute to wake. That means:

- A merchant opening the app after a quiet period waits through a cold start.
- Webhooks hit a sleeping service. Shopify retries, so they usually arrive
  eventually, but a `products/update` can be delayed by minutes — and if
  retries exhaust, the image is never re-assessed and the storefront keeps
  showing a stale label.

That is acceptable while you are testing and going through review. Before real
merchants install, move to Render's Starter tier (~$7/month, no sleeping). The
webhook delay is the reason, not the cold start: silently missing a product
update is exactly the failure this app exists to prevent.

Environment variables the server needs:

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` | Client ID from `shopify.app.toml` |
| `SHOPIFY_API_SECRET` | Client secret from the Partner Dashboard |
| `SHOPIFY_APP_URL` | Your public HTTPS URL, no trailing slash |
| `SCOPES` | `read_products,write_products` |
| `DATABASE_URL` | Postgres connection string |
| `NODE_ENV` | `production` |
| `SHOPIFY_BILLING_TEST` | `0` in production — anything else keeps charges in test mode |

`SHOPIFY_BILLING_TEST` is the one that silently costs money if wrong: leave it
at `1` and every subscription is a test charge that never bills.

## 4. Point Shopify at it

In `shopify.app.toml`, replace both placeholder URLs:

```toml
application_url = "https://eu-ai-labels.onrender.com"

[auth]
redirect_urls = [ "https://eu-ai-labels.onrender.com/auth/callback" ]
```

Use whatever hostname Render assigned. Then push the configuration and the
theme extension:

```bash
npm run deploy
```

Re-check afterwards that the five `[[webhooks.subscriptions]]` blocks are still
present. The CLI has rewritten this file before.

## 5. Verify on a fresh store

Install on a development store that has **never** had the app, so you exercise
the real first-run path:

- [ ] OAuth completes and the app opens
- [ ] Terms gate blocks everything until accepted
- [ ] Setup wizard scans the catalog
- [ ] Tick an image, drag the badge, apply
- [ ] Enable both theme blocks
- [ ] **Badge renders on a live product page**
- [ ] Uninstall, reinstall — no crash, terms not re-prompted unless the version changed

The badge check is the one that cannot be skipped. The overlay has to find and
anchor to the theme's own markup, and that has already broken twice in testing.

## 6. Submit for review

Submission happens in the **Partner Dashboard**, not the CLI. You need:

- App icon at **1200×1200**
- Feature image at 1600×900
- Screenshots of the **actual app UI** — requirement 4.4.4/4.4.5 rejects images
  that are only a logo, and each must show a different feature
- Listing copy (see `brand/LISTING.md`)
- A privacy policy URL
- Support contact

## Known gaps to close first

- **Catalog scans run inline in the request.** Fine to a few hundred products,
  times out beyond that. A merchant with a large catalog fails on their first
  action. This is the first thing to fix after launch, and arguably before.
- **Terms are engineer-drafted.** The app gates on them. See
  `docs/LEGAL-POSTURE.md` for the review checklist.
- **Pricing is a single $6.99/mo plan** with a 7-day trial, deliberately below
  the $9.99–15 field. It only works if the app stays self-service — see the
  pricing decision in `docs/MARKET.md` for what that trades away.
