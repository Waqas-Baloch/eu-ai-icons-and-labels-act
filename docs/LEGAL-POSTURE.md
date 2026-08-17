# Legal posture

This document records the liability stance the product is built around, and what
still needs a lawyer before launch.

**Nothing here is legal advice.** It is an engineering record of design
decisions taken for liability reasons, written so that a lawyer reviewing the
product can see the reasoning quickly.

---

## 1. What the app claims, and what it refuses to claim

The single most important product decision is the difference between these two
sentences:

- ❌ "Your store is compliant with the EU AI Act."
- ✅ "You assessed 412 images, declared 38 as AI-generated, disclosed all 38, and
  here is the timestamped record."

The app only ever makes the second kind of statement. This runs through the
implementation, not just the marketing:

| Surface | How it is worded |
|---|---|
| Dashboard | "Catalog posture", never "compliance status" |
| Per-image outcome | "Disclosure required" — a conclusion about the obligation, not a warranty |
| Engine output | A `reasoning` chain citing the provision relied on |
| Unresolved images | "Needs review", never silently cleared |
| Onboarding | An explicit acknowledgement, recorded in the audit chain |

`app/lib/compliance/article50.ts` opens with a comment stating the same thing, so
the constraint survives future edits by someone who has not read this document.

## 2. Why merchant declaration, not automated classification

The legal trigger in Article 3(60) is not "was this made by AI". It is a
cumulative test:

1. the content **resembles** existing persons, objects, places, entities or events;
2. it would **falsely appear** to a person to be authentic or truthful.

Both prongs are judgements about the relationship between an image and the real
world. A classifier can guess; it cannot know whether the watch in a photograph
is a watch the merchant actually sells.

Building an auto-classifier that answers this would mean the app makes the legal
determination — and therefore owns being wrong. Instead:

- The parser reports only what the image's own metadata asserts.
- The merchant answers the Article 3(60) question.
- The answer is recorded with attribution and a timestamp.

This inverts the liability exposure. When a classifier is wrong, the vendor made
a bad call. When a merchant declares and the app records it faithfully, the app
did its job — and the merchant has contemporaneous evidence of a good-faith
assessment, which is materially better than having no record at all.

## 3. Conservative defaults

Where the app must choose without enough information, it over-discloses:

- No metadata → **unresolved**, never "not AI".
- Unresolved → generic "AI" label shown by default (a setting, not a lock-in).
- AI origin known but realism undeclared → labelled provisionally.
- Creation date unknown → the pre-2-August-2026 exemption is **not** relied on.

The asymmetry justifying this: over-labelling carries no penalty under the AI
Act. Under-labelling carries up to €15 million or 3% of worldwide turnover.

One deliberate exception: an image the merchant declares as *evidently stylised*
resolves to "no disclosure needed", because it fails the "falsely appear
authentic" prong. The engine emits an `advisory.borderline_stylised` reasoning
step flagging it as a judgement call, so the record shows the merchant was warned.

## 4. The audit trail as the actual product

Fines land on the merchant, not the app vendor. But a merchant fined because the
app missed something will churn instantly and may pursue damages. The mitigation
is not a promise of perfect detection — no such promise is credible — it is
making the merchant's own diligence provable.

Hence the hash chain. Its honest limits are documented in
`app/lib/compliance/audit.ts` and surfaced in the UI:

- It proves internal consistency, not third-party attestation.
- Someone with database write access could recompute the chain wholesale.
- Truncation of the tail still verifies — which is why the **head hash** is
  displayed with instructions to record it externally.

Overstating what the chain proves would be its own liability. It is described
accurately in the interface.

## 5. Data handling

- No customer personal data is processed. The privacy webhooks are implemented
  and answer honestly: nothing to disclose, nothing to erase.
- Staff email addresses are stored as the `actor` on audit entries. That is
  personal data, and it is retained because attribution is the point of the
  record.
- `shop/redact` deletes everything, audit chain included. Merchants are told in
  the billing page to export before uninstalling if they need to retain evidence.
- Only the first 256 KB of each image is fetched, and image bytes are never
  stored — only a hash of the prefix, for deduplication.

## 6. Before launch — get these reviewed

This is the list to hand a lawyer. It is not exhaustive.

1. **Terms of service** with an explicit "advisory tool, not legal counsel"
   clause, a limitation-of-liability cap, and a disclaimer of warranty as to
   compliance outcomes. Standard practice among GDPR/consent app vendors.
2. **The onboarding acknowledgement wording** in `app/routes/app._index.tsx`.
   It is currently drafted by an engineer, and it is the app's primary
   contractual notice to the merchant. It needs a lawyer's pass.
3. **Professional indemnity / E&O insurance** sized to the plan pricing.
4. **The reasoning strings** in `app/lib/compliance/article50.ts`. These are the
   app's substantive statements about what the law requires, they are quoted
   into the audit export, and a merchant may show them to a regulator. Have them
   checked against the Commission's final guidelines.
5. **Marketing copy review.** The App Store listing must not imply guaranteed
   compliance. The word "compliant" as a claim about the merchant's store should
   not appear.
6. **Whether the app itself is in scope.** The app does not deploy an AI system
   generating synthetic content, so Article 50 should not bind it directly — but
   confirm this rather than assume it.

## 7. Open legal questions the engine takes a position on

Documented so a reviewer can find and challenge them.

| Question | Position taken | Where |
|---|---|---|
| Does a realistic AI photo of a *real product you sell* meet Art. 3(60)? | Yes — it resembles an existing object and appears authentic | `deepfake.criteria_met` |
| Is an assistively-edited real photo a deep fake? | No — it remains an authentic photograph | `scope.assistive_editing` |
| Does a stylised AI illustration of a real product need disclosure? | No, but flagged as borderline | `deepfake.not_authentic_appearing` |
| Is commercial product imagery ever an "artistic work"? | Only if the merchant declares it so | `carveout.creative_work` |
| Does the 2 Dec 2026 deferral apply to deployers? | No — it covers Art. 50(2) provider marking | README, engine header comment |

Each position is a reasoning code, so if legal review changes one, the code, the
tests and the merchant-facing explanation all move together.
