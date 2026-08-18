import type { MetaFunction } from "@remix-run/node";

/**
 * The public privacy policy.
 *
 * Deliberately outside /app: the App Store listing requires a URL reachable
 * without installing or authenticating, and reviewers check it.
 *
 * Every claim here is a statement about what the code does — what is read, what
 * is stored, what is not, and when it is deleted. Keep it that way. If the data
 * handling changes, this page changes in the same commit.
 */

export const meta: MetaFunction = () => [
  { title: "Privacy policy — NanoApp Disclosa: EU AI Icons" },
  {
    name: "description",
    content:
      "What the NanoApp Disclosa: EU AI Icons app for Shopify reads, stores, and deletes.",
  },
];

const UPDATED = "18 August 2026";

export default function Privacy() {
  return (
    <main
      style={{
        font: "16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "3rem 1.5rem 5rem",
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>
        Privacy policy
      </h1>
      <p style={{ color: "#616161", marginTop: 0 }}>
        NanoApp Disclosa: EU AI Icons · last updated {UPDATED}
      </p>

      <h2>What this app is</h2>
      <p>
        The app helps a merchant record and display disclosures for
        AI-generated product imagery under Article 50(4) of the EU AI Act. It is
        an independent product. It is not affiliated with, endorsed by, or
        certified by the European Union, and it does not provide legal advice or
        guarantee compliance.
      </p>

      <h2>What is collected</h2>
      <ul>
        <li>
          <strong>Shop identity</strong> — your myshopify.com domain, install
          and uninstall dates, and the access tokens Shopify issues so the app
          can read your catalogue.
        </li>
        <li>
          <strong>Product and image metadata</strong> — product titles, handles,
          image URLs, alt text, dimensions, and their position in the gallery.
        </li>
        <li>
          <strong>Provenance findings</strong> — any C2PA, IPTC, XMP or EXIF
          data embedded in an image that indicates how it was made.
        </li>
        <li>
          <strong>Your decisions</strong> — what you declared about each image,
          the label chosen, where it was placed, and when.
        </li>
        <li>
          <strong>Actor identity</strong> — the email address of the staff
          member who made a decision, where Shopify provides it, so the audit
          trail records who decided what. Otherwise the shop domain is recorded.
        </li>
      </ul>

      <h2>What is not collected</h2>
      <ul>
        <li>
          <strong>No customer personal data.</strong> The app does not request
          or receive access to customers, orders, or checkout.
        </li>
        <li>
          <strong>No copies of your images.</strong> To read provenance, the app
          fetches only the first 256&nbsp;KB of an image, parses it in memory,
          and discards it. What is kept is a SHA-256 hash of that prefix, used
          to recognise the same asset reused across products so you declare it
          once. The hash cannot be turned back into the picture.
        </li>
        <li>
          <strong>No payment details.</strong> Subscriptions are handled
          entirely by Shopify Billing; the app never sees a card.
        </li>
        <li>No advertising, tracking, profiling, or sale of data to anyone.</li>
      </ul>

      <h2>Where it is stored</h2>
      <p>
        Data is held in a PostgreSQL database hosted by Neon, with the
        application hosted by Render. Both are used solely to run this app.
        Traffic is served over HTTPS.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Records are kept while the app is installed. When you uninstall, Shopify
        sends a shop redaction request 48 hours later, and the shop&rsquo;s
        record — including its audit trail — is deleted at that point. Because
        the audit trail is your evidence of what was disclosed while your store
        was live, export it as CSV from the app before uninstalling if you need
        to retain it.
      </p>
      <p>
        The app answers Shopify&rsquo;s mandatory{" "}
        <code>customers/data_request</code> and <code>customers/redact</code>{" "}
        webhooks, which have nothing to return or erase because no customer data
        is held, and <code>shop/redact</code>, which performs the deletion above.
      </p>

      <h2>Your rights</h2>
      <p>
        You can export your full record as CSV from inside the app at any time,
        and you can have everything erased by uninstalling. For any other
        request about data held on your behalf, contact us using the support
        address on the app&rsquo;s App Store listing.
      </p>

      <h2>Changes</h2>
      <p>
        Material changes will be reflected here with a new date above. Continued
        use after a change means the current version applies.
      </p>
    </main>
  );
}
