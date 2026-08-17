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
  scaffolded $19/$49/$149 sits above almost the entire field.
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

## Implication for pricing

The scaffolded tiers in `app/lib/plans.ts` were set before this research and are
above market. Two coherent options:

- **Long tail:** roughly $9 / $19 / $39, competing on features and polish.
- **Agency and mid-market:** keep prices high, add multi-store management,
  saved declaration presets, per-collection rules and exportable compliance
  reports, and sell direct rather than through App Store search.

The second fits what has been built. The bulk-apply path was already generalised
to `applyDeclarationToImages(imageIds[])` so a filtered multi-select can reuse
it without a rewrite.

**Neither option is quick money.** This is a slow trust business with a real and
permanent legal driver behind it.
