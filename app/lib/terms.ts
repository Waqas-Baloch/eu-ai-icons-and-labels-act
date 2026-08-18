/**
 * The merchant agreement, held as data so the same text can be rendered in the
 * app, written into the audit chain on acceptance, and exported later.
 *
 * DRAFT — written by an engineer, not a lawyer. It must be reviewed by counsel
 * before the app is listed. See docs/LEGAL-POSTURE.md for the full pre-launch
 * checklist.
 */

/**
 * Bumped whenever the substance changes. A merchant who accepted an older
 * version is re-prompted, because an acceptance recorded against different
 * wording is not an acceptance of these terms.
 */
export const TERMS_VERSION = "2026-08-18";

export interface TermsClause {
  heading: string;
  body: string[];
}

export const TERMS: TermsClause[] = [
  {
    heading: "We are not an official compliance partner",
    body: [
      "NanoApp Disclosa: EU AI Icons is an independent product. It is not affiliated with, authorised by, endorsed by, or certified by the European Union, the European Commission, any national market surveillance authority, or Shopify.",
      "The icon artwork it displays is published by the European Union for public use. Shipping that artwork does not make this app an official channel, and no part of this app should be read as an official statement of what the law requires of you.",
    ],
  },
  {
    heading: "What this app does",
    body: [
      "It reads the provenance metadata attached to your product images, applies a documented interpretation of Article 50(4) of Regulation (EU) 2024/1689 (the AI Act), asks you to confirm what a machine cannot determine, renders the official EU labels on your storefront, and keeps a tamper-evident record of every assessment and every decision you make.",
      "That is the whole of it. It is a tool for applying AI disclosure labels to images and for documenting why.",
    ],
  },
  {
    heading: "What this app does not do",
    body: [
      "It does not provide legal advice. It is not a substitute for a lawyer, and no output of this app is a legal opinion.",
      "It does not certify, guarantee, or warrant that your store complies with the AI Act or with any other law.",
      "It does not determine whether an image is AI-generated. Detection from metadata is best-effort and frequently impossible, because Shopify and most export tools strip that metadata. The app relies on you to tell it what your images are.",
    ],
  },
  {
    heading: "You are responsible",
    body: [
      "Under the AI Act you are the deployer of the AI systems that produced your imagery. The transparency obligation in Article 50(4) is yours, and so is any penalty for failing to meet it — up to €15,000,000 or 3% of worldwide annual turnover.",
      "You are responsible for the accuracy of every declaration you make in this app, for reviewing every image the app flags, for confirming the labels actually render on your storefront, and for any irregularity, omission, or error in the disclosure of your content — including where it arises from an incorrect declaration, a missed image, a theme that does not display the label, or a limitation of this app.",
      "You are responsible for determining your own obligations, and for taking your own legal advice on them.",
    ],
  },
  {
    heading: "Limits of the assessment",
    body: [
      "Whether an image constitutes a deep fake under Article 3(60) depends on whether it resembles something that exists and would pass as authentic. That is a judgement about the world which only you can make. The app records your judgement; it does not replace it.",
      "The app labels unresolved images as a precaution by default. That is a conservative setting, not a determination that a label is legally required.",
      "Guidance on the AI Act continues to develop. The interpretation encoded in this app is one reasonable reading and may change.",
    ],
  },
  {
    heading: "The audit record",
    body: [
      "The app maintains a hash-chained record so that later edits or deletions are detectable. This demonstrates internal consistency; it is not third-party attestation, and it does not prove that any declaration you made was correct.",
      "Export your record before uninstalling. Shopify sends a shop redaction request 48 hours after uninstall, at which point the record is deleted.",
    ],
  },
  {
    heading: "No warranty and limitation of liability",
    body: [
      "The app is provided on an “as is” and “as available” basis, without warranties of any kind, express or implied, including fitness for a particular purpose and non-infringement.",
      "To the fullest extent permitted by law, the developer is not liable for any fine, penalty, enforcement action, loss of profit, loss of goodwill, or indirect or consequential loss arising from your use of the app or from any disclosure or non-disclosure of AI-generated content in your store.",
      "Nothing in these terms excludes liability that cannot lawfully be excluded.",
    ],
  },
];

/**
 * The single sentence recorded in the audit chain on acceptance. Kept short
 * and specific enough to be meaningful when read back years later.
 */
export const TERMS_ACKNOWLEDGEMENT =
  "Merchant accepted the terms of use: the app is an independent tool for applying AI disclosure labels and keeping records, is not affiliated with or endorsed by the European Union, does not provide legal advice, and does not guarantee compliance. The merchant remains the deployer under Article 50(4) and is responsible for the accuracy of declarations and for any irregularities in disclosure.";
