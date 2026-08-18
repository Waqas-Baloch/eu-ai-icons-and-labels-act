/**
 * Tamper-evident audit chain.
 *
 * Every assessment and every merchant decision becomes an entry whose hash
 * covers the previous entry's hash. Editing or deleting any row invalidates
 * every hash after it, so a merchant can demonstrate to a market surveillance
 * authority that the record was not reconstructed after the fact.
 *
 * This is the product's core defensive asset. Article 50(4) allocates the
 * obligation to the deployer, and no classifier is perfect — so what protects
 * the merchant is not a claim of perfect detection but a contemporaneous,
 * unforgeable record of what was known and decided, and when.
 *
 * The chain proves internal consistency, not third-party attestation: someone
 * with database write access could recompute the whole chain from a chosen
 * point. Countering that needs external anchoring (periodically publishing the
 * head hash somewhere append-only), which `chainHead` is designed to feed.
 */

import { createHash } from "node:crypto";

/** The prevHash of the first entry in a shop's chain. */
export const GENESIS_HASH = "0".repeat(64);

export type AuditAction =
  | "app.installed"
  | "app.uninstalled"
  | "disclaimer.accepted"
  | "scan.started"
  | "scan.completed"
  // Stopped on its time budget with the catalog unfinished. Recorded distinctly
  // from completed so the trail cannot imply the whole catalog was assessed.
  | "scan.partial"
  | "scan.failed"
  | "image.assessed"
  | "image.declared"
  | "image.overridden"
  | "product.published"
  | "settings.changed"
  | "plan.changed"
  | "export.generated";

export interface AuditInput {
  action: AuditAction;
  /** "system", a webhook topic, or the staff member's email. */
  actor: string;
  /** The gid of the product or image the entry concerns, when applicable. */
  subject?: string;
  payload: unknown;
  /** Defaults to now; injectable so tests are deterministic. */
  createdAt?: Date;
}

export interface AuditRecord {
  seq: number;
  prevHash: string;
  hash: string;
  action: string;
  actor: string;
  subject: string | null;
  payload: string;
  createdAt: Date;
}

/**
 * Deterministic JSON serialisation.
 *
 * Object keys are sorted so that two structurally equal payloads always
 * produce identical bytes — without this the hashes would depend on property
 * insertion order and verification would fail spuriously. Dates become ISO
 * strings and undefined values are dropped, matching what survives a round
 * trip through the database.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = normalise(source[key]);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/**
 * Computes the hash for an entry. The digest covers the link to the previous
 * entry and every field that carries meaning, so none can be altered in place.
 */
export function hashEntry(input: {
  prevHash: string;
  seq: number;
  action: string;
  actor: string;
  subject?: string | null;
  payload: string;
  createdAt: Date;
}): string {
  const material = canonicalize({
    prevHash: input.prevHash,
    seq: input.seq,
    action: input.action,
    actor: input.actor,
    subject: input.subject ?? null,
    payload: input.payload,
    createdAt: input.createdAt,
  });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Builds the next entry in a chain. Pure: the caller persists the result.
 */
export function buildEntry(
  previous: Pick<AuditRecord, "seq" | "hash"> | null,
  input: AuditInput,
): AuditRecord {
  const seq = previous ? previous.seq + 1 : 0;
  const prevHash = previous ? previous.hash : GENESIS_HASH;
  const createdAt = input.createdAt ?? new Date();
  const payload = canonicalize(input.payload);

  return {
    seq,
    prevHash,
    hash: hashEntry({
      prevHash,
      seq,
      action: input.action,
      actor: input.actor,
      subject: input.subject ?? null,
      payload,
      createdAt,
    }),
    action: input.action,
    actor: input.actor,
    subject: input.subject ?? null,
    payload,
    createdAt,
  };
}

export type ChainVerification =
  | { valid: true; length: number; head: string }
  | { valid: false; brokenAt: number; reason: string };

/**
 * Recomputes a chain and reports the first inconsistency.
 *
 * Entries must be supplied in ascending `seq` order.
 */
export function verifyChain(entries: AuditRecord[]): ChainVerification {
  if (entries.length === 0) {
    return { valid: true, length: 0, head: GENESIS_HASH };
  }

  let expectedPrev = GENESIS_HASH;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];

    if (entry.seq !== index) {
      return {
        valid: false,
        brokenAt: index,
        reason: `Sequence gap: expected seq ${index}, found ${entry.seq}. An entry was deleted or reordered.`,
      };
    }

    if (entry.prevHash !== expectedPrev) {
      return {
        valid: false,
        brokenAt: entry.seq,
        reason: `Broken link at seq ${entry.seq}: prevHash does not match the previous entry's hash.`,
      };
    }

    const recomputed = hashEntry({
      prevHash: entry.prevHash,
      seq: entry.seq,
      action: entry.action,
      actor: entry.actor,
      subject: entry.subject,
      payload: entry.payload,
      createdAt: entry.createdAt,
    });

    if (recomputed !== entry.hash) {
      return {
        valid: false,
        brokenAt: entry.seq,
        reason: `Content altered at seq ${entry.seq}: the stored hash does not match the entry's contents.`,
      };
    }

    expectedPrev = entry.hash;
  }

  return { valid: true, length: entries.length, head: expectedPrev };
}

/**
 * The current head hash — a single value that fixes the entire history.
 * Publishing it periodically (or handing it to an auditor) is what converts
 * internal consistency into external evidence.
 */
export function chainHead(entries: AuditRecord[]): string {
  return entries.length === 0 ? GENESIS_HASH : entries[entries.length - 1].hash;
}

/** Escapes a value for CSV, quoting when it contains a delimiter or quote. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Renders the chain as CSV for an enforcement request or an internal review.
 * The hash columns are included deliberately — they are what makes the export
 * checkable against the live chain rather than just a printed assertion.
 */
export function exportCsv(entries: AuditRecord[]): string {
  const header = ["seq", "created_at", "action", "actor", "subject", "payload", "prev_hash", "hash"];
  const rows = entries.map((entry) =>
    [
      String(entry.seq),
      entry.createdAt.toISOString(),
      entry.action,
      entry.actor,
      entry.subject ?? "",
      entry.payload,
      entry.prevHash,
      entry.hash,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}
