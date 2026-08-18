# Market position

Researched 16 August 2026. Recheck before any pricing or launch decision — this
category moved fast around the 2 August deadline and will keep moving.

## The premise that changed

The original thesis assumed "almost no dedicated Shopify-native tooling yet."
That was already false by the time the app was built — and not marginally so.
A Shopify App Store search for "EU AI Act" returns **at least eight dedicated
competitors**, all shipped in 2026.

| App | Developer | Launched | Pricing | Reviews |
|---|---|---|---|---|
| **Compliant AI — EU AI Act — FTC** | Quoter | 11 May 2026 | Free · $29 one-time report · $19/mo monitoring | **0** |
| **Lifetime: EU AI Act Icons** | EU by Final Apps | 20 Jul 2026 | $1 first month · $9.99/mo · **$199 lifetime** | **0** |
| **Uhlenbusch: EU AI Act Icons** | UhlenbuschAgency (DE) | 22 Jul 2026 | $14.90/mo manual · $24.90/mo automatic | **0** |
| **EU AI Label** | Damian Klimarczyk (PL) | ~Aug 2026 | Free (10) · $7/mo (100) · $15/mo (500) | **0** |
| **Candor — EU AI Act** | — | — | $9.99/mo | **0** |
| **ComplyGuard AI** | — | — | Free plan available | **0** |
| **LabelAI — EU AI Act** | — | — | Free plan available | **0** |
| **Aclara: AI Act Disclosures** | — | — | Free trial | **0** |

Plus [euaiicon.com](https://euaiicon.com/), a free browser-based tool from the
EU AI Label developer that burns labels into image files client-side.

Shopify has **no native Article 50 feature**, so the platform gap is real. That
is the one piece of the original thesis that held up.

## The comparison that settles it

In the *same* search results, Shopify's EU withdrawal-button apps — a comparable
EU compliance obligation (Regulation 2023/2673, mandatory 19 June 2026) — show:

- EU Withdrawal Button & Form — **2,192 reviews**
- Revoq — **495 reviews**
- EU Withdrawal Button Pro — **299 reviews**
- …and four more with 24–91 reviews each

So Shopify merchants demonstrably *do* buy EU compliance apps, at scale, when
they know the obligation exists. The AI Act category has eight apps and zero
reviews between them.

The strongest single data point: **Compliant AI launched 11 May 2026** — nearly
three months before the deadline — and still had zero reviews three months
after it. That is not a supply problem.

## What the competitors do that we do not

Worth knowing before positioning:

- **Uhlenbusch prints the label into the image pixels**, with a backup and
  one-click undo, and auto-hides the storefront overlay when a printed label is
  present. A burned-in label survives download, scraping and re-upload — which
  is a genuinely stronger disclosure than any overlay, ours included.
- **Compliant AI scans pages and policies, not just images**, and adds an FTC
  checker for unsubstantiated health/green/product claims, PDF compliance
  reports and weekly re-scans. That is a compliance *platform*, not a badge
  tool, and it is the closest competitor to the direction our audit trail points
  in.
- Several ship **multi-language storefront badges** (7 languages). We ship
  English only.

## What the numbers actually say

- **Eight apps, zero reviews between them.** Supply arrived; demand has not.
  Merchant *awareness* is the bottleneck, and awareness is bought with education
  and marketing over months, not shipped.
- **Pricing has already cleared at free–$25/mo**, clustering at $9.99–15. The
  original $19/$49/$149 scaffold sat above almost the entire field; pricing was
  moved to a single $6.99/mo plan on 17 August 2026 (see below).
- **Someone is selling a $199 lifetime licence** for a recurring regulatory
  obligation. Read that as a seller who does not believe in the recurring
  revenue, or is optimising for cash before the window closes. Either way it
  caps what the long tail will pay.
- **The category is crowded at the bottom and empty at the top.** Every
  competitor is a badge tool or a scanner priced for the long tail. Nobody is
  selling to agencies or mid-market at agency prices.

## Where this app is genuinely differentiated

Not on detection — the first competitor also reads C2PA and also asks for
one-click confirmation. The difference is evidentiary:

- A **hash-chained, tamper-evident** audit trail, versus "activity log with
  export" and "signed-at timestamps." Ours detects edits, deletions and
  reordering; theirs record events.
- **Per-step legal citations** carried into the export, so the record explains
  *why* each decision was reached, not just that it was.
- A **published head hash** the merchant can anchor externally.

Be honest about who values this. A merchant paying $9/mo wants the badge on the
page in five minutes and will never read an audit trail. Tamper-evident evidence
matters to mid-market brands and to agencies managing many storefronts — buyers
who would pay $99–299/mo and who will never find the app through App Store
search.

## Strategic risks

1. **Platform absorption.** Shopify has no native feature today. This is exactly
   the kind of capability a platform eventually ships, and it would end the
   category overnight.
2. **Price floor.** You cannot out-cheap a $199 lifetime offer. Competing on
   price in the long tail is a losing position.
3. **Awareness dependency.** Revenue is gated on merchants learning they have an
   obligation. That is an education cost with a long payback, not a product
   cost.
4. **Commoditisation of the easy half.** Badge rendering is not defensible. The
   audit trail is, but only for buyers who care.

## Pricing decision — 17 August 2026

**One plan: $6.99/mo per store, unlimited products and images, 7-day trial.**

The trial is a no-card trial: seven days of the full app from install, with no
subscription to approve. That was chosen over Shopify's own `trialDays` — which
requires approving a charge up front — to keep install friction as low as
possible while merchants are still discovering the obligation exists. The cost
is that the App Store listing shows no "free trial" badge, since Shopify does
not know about a trial it is not managing.

This undercuts the whole observed field ($9.99–15) rather than competing inside
it. The reasoning it rests on:

- **The obligation does not scale with catalog size.** Article 50(4) applies the
  same to 10 products and 10,000, so metering by product count prices the
  obligation rather than the work. Tiers also create the worst failure mode a
  compliance tool can have: a merchant who hits a ceiling mid-catalog and ships
  a partly-labelled storefront.
- **Nothing here is defensible on features.** Badge rendering is commodity. A
  low, single, obvious price is a cheaper way to be chosen than a feature
  argument against seven competitors.
- **Zero reviews across the field means the bottleneck is awareness, not
  price.** A low price removes deliberation from the install decision, which is
  what matters while merchants are still discovering the duty exists.

What this gives up, stated plainly:

- **$6.99 will not fund support at volume.** At Shopify's 0% revenue share under
  $1M it is ~$6.99 net, so ten support emails can cost more than a store's
  annual revenue. This works only if the app stays genuinely self-service.
- **It forecloses the agency route for now.** Multi-store management, saved
  presets and per-collection rules were the case for pricing high. That path is
  not closed — the bulk-apply path is already generalised to
  `applyDeclarationToImages(imageIds[])` — but it would need a second plan, and
  adding one after launch is harder than starting with it.
- **Raising the price later is harder than lowering it.** Existing subscribers
  must approve a new charge, and some will simply churn instead.

**Neither option is quick money.** This is a slow trust business with a real and
permanent legal driver behind it.
