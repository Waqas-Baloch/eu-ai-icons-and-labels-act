# AI Disclosure — EU AI Act Article 50(4) for Shopify

A Shopify app that helps merchants assess, disclose and **document** AI-generated
product imagery under the EU AI Act's transparency obligation.

> **This is compliance tooling, not legal advice.** It produces risk assessments
> and an audit record. It does not make a store compliant, and it is not a
> substitute for professional legal advice. Under the AI Act the merchant is the
> *deployer* — the obligation, and any penalty for missing it, remains theirs.
> See [docs/LEGAL-POSTURE.md](docs/LEGAL-POSTURE.md).

---

## Why this exists

Article 50(4) of the EU AI Act became applicable on **2 August 2026**. Deployers
of AI systems that generate or manipulate image content constituting a *deep
fake* must disclose that the content is artificially generated or manipulated.
Penalties reach **€15 million or 3% of worldwide annual turnover**.

A common misreading is that the deadline moved to 2 December 2026. It did not.
That four-month grace period applies to the **Article 50(2)** machine-readable
marking duty owed by model *providers*. The deployer disclosure duty in 50(4)
applied on schedule, without a grace period. A Shopify merchant selling into the
EU with AI-generated product photography is in scope today.

Shopify does not take on this liability for merchants, exactly as it does not for
GDPR. That gap is what this app fills.

## What it does

1. **Reads provenance** from every product image — C2PA Content Credentials,
   IPTC `DigitalSourceType`, XMP and EXIF, plus generator fingerprints for
   Midjourney, DALL·E, Firefly, Stable Diffusion and others.
2. **Applies the legal test** in a rule engine that encodes Article 50(4),
   the Article 3(60) deep fake definition, the creative-works carve-out, the
   assistive-editing carve-out and the pre-2-August-2026 exemption.
3. **Asks the merchant** to resolve what metadata cannot establish, through a
   review queue built for speed.
4. **Renders the official EU labels** on the storefront through a theme app
   extension, positioned per image.
5. **Records everything** in a hash-chained, tamper-evident audit trail that
   exports to CSV.

### Per-image badge control

Opening a product opens an editing dashboard: the product's images along the
top, the image being edited on the left, and the toolbox on the right.

- **Tick an image** to tag it. The tag appears on the canvas immediately and the
  declaration is written straight away; unticking removes both. The checkbox is
  the declaration, so it acts on the click rather than waiting for a save.
- **Click the tag** to select it — a hairline bounding box with square corner
  handles, the standard direct-manipulation affordance. Clicking the picture
  deselects; Escape does too.
- **Drag the badge** anywhere on the image, or nudge it with arrow keys, or snap
  it to a corner. It always keeps **20&nbsp;px** clear of every edge.
- **Resize** by dragging any corner handle, or with the size slider.
- **Label type** — `AI GENERATED`, `AI MODIFIED` or the compact `AI` mark.
- **Label** — black or white, transparent or solid, from the official EU pack.
- **Apply to selected** writes the whole setup to every ticked image at once.

### How a setup reaches an image

Three layers, checked in order:

1. **a draft** — an edit made to that image during this session
2. **its saved setup** — written by a previous apply
3. **the template** — the *first* image's setup

So configuring the first image once sets the pattern for the whole product,
while adjusting any other image is a local exception that changes nothing else.

The template is pinned to the first image rather than being "whatever the
toolbox last held". An earlier version did the latter and the template drifted:
nudging image 2 silently became the pattern for images 3 and 4, and revisiting
image 1 discarded the change to image 2. Pinning the template and keeping a
draft per image fixes both.

Switching between images never writes anything — inheriting is only what the
toolbox displays until the merchant ticks the image or presses apply, so
browsing around cannot overwrite a setup somebody made deliberately.

The shipped badge artwork is generated from the official EU icon pack by
`scripts/prepare-badges.py` (needs Pillow). That script trims each PNG to its
ink bounds before resizing, and the trim is not cosmetic: the supplied files
carry a large transparent margin — the "AI GENERATED" artwork is a 7459×2363
canvas holding roughly 5800×1120 of actual mark, so over half the height is
empty. Untrimmed, every measurement in the app is wrong in the same invisible
way. The 20px storefront keep-out gets measured from the empty canvas edge
rather than the visible label, the height percentage sizes the padding along
with the mark, and the editor's selection box floats a long way off the artwork.

The badge is drawn as the official PNG and nothing else — no plate, padding,
border, rounding or blur behind it. These are published EU marks, and drawing a
container around one changes how an official label appears on the page. Contrast
is handled by choosing the black or white artwork, which is what the four
variants are for.

One exception to pure percentage sizing: the overlay enforces a 14px minimum
height. Six percent of an 86px gallery thumbnail is a five-pixel label, and a
label nobody can read does not satisfy a requirement that the disclosure be
perceivable by a person.

Unticked images keep their provisional label until the merchant explicitly
clears it. That is deliberate — declaring an image not-AI is a statement of fact
that lands in the audit trail, so it is a button the merchant presses, never
something inferred from an untouched checkbox.

Position is stored as a fraction of the *safe area* rather than a pixel offset,
and the badge is anchored proportionally to its own width. That means one stored
placement renders identically on a 2000px hero and an 86px thumbnail, with the
20px margin exact on both, and neither the stylesheet nor the overlay script
needs to know how wide the badge artwork is. The arithmetic and its edge cases
live in [app/lib/badge-layout.ts](app/lib/badge-layout.ts) with 26 tests.

Selection and placement are deliberately separate concerns. Ticking an image
says something about the world — this photo was made with AI — and that is what
reaches the audit trail. Where the badge sits is only presentation. Mixing them
would let a merchant change a legal declaration by dragging a graphic.

Corner and artwork are cosmetic. The **label is not**: it states how the image
was made, so selecting one that differs from the assessment is recorded in the
audit trail as a manual override and warned about in the interface. Choosing a
label for an image the engine cleared is treated as voluntary disclosure and
published so the storefront renders it.

**Apply to all images** copies a declaration and its badge settings across every
image on a product. It writes a separate declaration and a separate audit entry
per image rather than one bulk record — the merchant is attesting something
about each image individually, and an enforcement conversation is about a
specific image, so a single "applied to 12 images" row would be much weaker
evidence.

## The design decision that matters

**Absence of metadata is never treated as absence of AI.**

Shopify's image pipeline, most CDNs and nearly every "export for web" path strip
metadata. An image with no provenance is therefore *unresolved*, not *clean*. It
goes to the merchant for a declaration, and — by default — carries the generic
"AI" label on the storefront in the meantime.

That default is deliberate: over-labelling carries no penalty, under-labelling
can cost €15 million. It is a setting, not a lock-in.

The second half of the same decision: the parser never guesses at realism. The
Article 3(60) test asks whether an image *resembles something that exists* and
*would falsely appear authentic*. Only a person who knows what the image depicts
can answer that. Capturing that answer — attributed, timestamped, hash-chained —
is what converts an imperfect classifier into a defensible record.

## Reviewing the UI without a store

Polaris web components are framework-agnostic custom elements served from
Shopify's CDN, so the admin screens render in an ordinary browser tab. There is
a clickable preview of every screen:

```bash
npm run preview
```

It opens the products list; the top bar switches between products, a product's
images, setup, settings and a storefront demo.

The **product images** page is live, not a mockup — click a choice and watch the
state resolve, or use "Apply to all". The **storefront** page loads the real
`eu-ai-disclosure.css` and `eu-ai-disclosure.js` from the theme extension,
driven by the same metafield payload the app publishes, so it exercises the
shipped overlay logic rather than a copy of it. Two real bugs were caught that
way — see the git history for `anchorFor` and the badge sizing rules.

Run `npm run preview:sync` after editing extension assets to refresh the copies.

## Setup

```bash
npm install
```

Link to an app in your Shopify Partner account:

```bash
npm run config:link
```

Set up the database:

```bash
npm run setup
```

Run it against a development store:

```bash
npm run dev
```

Then, in the store's theme editor:

1. Turn on the **AI disclosure overlay** app embed.
2. Add the **AI content disclosure** block to the product template.

Both matter — see "Storefront rendering" below.

## How a merchant uses it

One screen, one mental model: **pick a product, answer its images.**

1. **Products** is the home screen — every product in the shop, with its listing
   image, how many photos it has, how many still need an answer, and a filter
   for the ones that do.
2. **Open a product** to see every image on its product page, in the order a
   customer sees them, with the **listing image marked** — that is the photo
   shown in collections and search, so it is usually the first exposure a
   customer has to the product at all.
3. **Answer each image with one click.** Four options cover essentially every
   product photo:

   | Choice | Outcome |
   |---|---|
   | Real photo | No label |
   | Real photo, AI-edited | `AI MODIFIED` |
   | AI-generated, looks real | `AI GENERATED` |
   | AI-generated, clearly not real | No label |

   The wording describes the picture, not the statute — a merchant knows whether
   their photo is a real photo; they do not know what "resembles an existing
   object and would falsely appear authentic" means. The engine still applies
   the Article 3(60) test to what they tell us, and `test/quick-choices.test.ts`
   asserts each button's outcome against the real rule engine.

4. **Apply to all** copies an answer across the product's images, writing a
   separate declaration and audit entry per image.

Anything subtler — creative-work carve-out, assistive-only edits, pre-cutoff
content, per-image badge corner and artwork — lives behind **More options**, so
the common path stays one click and the uncommon path is still reachable.

## Architecture

```
app/
  lib/compliance/
    types.ts         Shared vocabulary; the source of truth for the String columns
    article50.ts     The rule engine. Pure, no I/O, fully unit-tested
    provenance.ts    C2PA / IPTC / XMP / EXIF parsing. Pure, dependency-free
    audit.ts         Hash chain: canonicalisation, hashing, verification, CSV
  lib/
    scan.server.ts       Catalog walk, assessment, publication
    declare.server.ts    Merchant declarations
    audit.server.ts      Persistence for the chain
    metafields.server.ts Publishes decisions for the storefront
    plans.ts             Billing plans (client-safe)
  routes/            Embedded admin + webhooks
extensions/
  ai-disclosure/     Theme app extension: official EU label artwork
```

The compliance core is pure and I/O-free, which is why it can be tested
exhaustively — 115 tests cover every branch of the decision tree, the metadata
vocabulary, and the tamper-evidence properties of the audit chain.

### Storefront rendering

Two blocks, and they are not redundant:

- **`ai_disclosure_notice`** (app block) renders server-side in Liquid, so the
  disclosure is in the HTML at first paint with no JavaScript. This is the
  reliable path, and the one that answers the requirement that disclosure be
  perceivable on first exposure without special tools.
- **`ai_disclosure_overlay`** (app embed) overlays the badge directly on product
  images. It is a convenience layer: it runs client-side and matches the theme's
  rendered `<img>` elements by filename.

The overlay's filename normalisation is duplicated between
`app/lib/metafields.server.ts` and `extensions/.../eu-ai-disclosure.js` because
the theme has no bundler. A test asserts the two regexes are identical — if they
drifted, badges would silently stop rendering, which is precisely the failure
this product exists to prevent.

### Audit chain

Each entry hashes the previous entry's hash together with its own contents, so
any edit, deletion or reordering downstream of a tampered row is detectable.

The chain proves *internal consistency*, not third-party attestation: anyone with
database write access could recompute it wholesale. Countering that needs
external anchoring, which is why the app surfaces the **head hash** — a single
value that fixes the entire history — and tells merchants to record it
somewhere outside the app.

## Testing

```bash
npm test
```

```bash
npm run typecheck
```

## Known limitations

These are real and worth reading before launch.

- **Catalog scans run inline in the request.** Fine to a few hundred products;
  beyond that it needs a job queue. There is no background worker yet.
- **The overlay matches images by filename.** A theme that rewrites image URLs
  beyond Shopify's standard CDN transforms will not match. The server-rendered
  app block does not have this weakness, which is why merchants are told to add
  both.
- **The overlay wraps images it cannot otherwise anchor to.** When no ancestor
  bounds the image on both axes — which is the common case, since a main image
  usually shares its wrapper with the thumbnail strip — the script wraps the
  image in a positioned `<span>`. That is more DOM interference than an app
  embed ideally does, but the alternative, found in testing, was rendering no
  badge at all. Themes with selectors like `.gallery > img` may need checking.
- **Badge sizing is enforced with `!important`.** Themes style gallery images
  with descendant selectors that outrank a single class, and in testing a theme
  rule sized a 14px badge at 94px. Locking the sizing is deliberate.
- **`fetchImageHead` reads the first 256 KB of each image.** Metadata lives in
  the header, so this is sound in practice, but a C2PA manifest placed unusually
  late in a very large file could be missed.
- **Generator fingerprinting is weak evidence** and is marked
  `confidence: "low"`. A filename or prompt mentioning a tool is not proof the
  image came from it. Those images still go to the merchant for declaration.
- **The embedded download flow for CSV export needs verification on a live
  store.** It opens in a new top-level tab because an embedded app cannot hand
  the browser a download from inside the Shopify frame.
- **Framework choice.** Built on Remix v2 with `@shopify/shopify-app-remix@5`.
  Shopify now scaffolds new apps with React Router 7 instead; both packages are
  published in lockstep and share an identical API surface, so migration is
  mechanical if desired.
- **Polaris React is deprecated.** This app uses Polaris **web components**
  loaded from Shopify's CDN, with `@shopify/polaris-types` for TypeScript.

## Legal sources

- Article 50 and Article 3(60), Regulation (EU) 2024/1689 (AI Act)
- European Commission, *Guidelines on transparency obligations under Article 50*
  (final version adopted 20 July 2026)
- European Commission, *Code of Practice on Transparency of AI-generated Content*
- IPTC `DigitalSourceType` vocabulary — `http://cv.iptc.org/newscodes/digitalsourcetype/`
- C2PA Content Credentials specification

Every dispositive step in the rule engine cites its basis, and those citations
are carried into the audit record.
