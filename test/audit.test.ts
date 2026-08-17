import { describe, expect, it } from "vitest";
import {
  buildEntry,
  canonicalize,
  chainHead,
  exportCsv,
  GENESIS_HASH,
  hashEntry,
  verifyChain,
  type AuditInput,
  type AuditRecord,
} from "../app/lib/compliance/audit";

const at = (iso: string) => new Date(iso);

/** Minimal RFC 4180 single-row reader, used to round-trip the CSV export. */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (inQuotes) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Builds a valid chain from a list of inputs. */
function chain(inputs: AuditInput[]): AuditRecord[] {
  const records: AuditRecord[] = [];
  for (const input of inputs) {
    records.push(buildEntry(records.at(-1) ?? null, input));
  }
  return records;
}

const sample: AuditInput[] = [
  {
    action: "app.installed",
    actor: "system",
    payload: { shop: "demo.myshopify.com" },
    createdAt: at("2026-08-10T10:00:00Z"),
  },
  {
    action: "image.assessed",
    actor: "system",
    subject: "gid://shopify/MediaImage/1",
    payload: { disclosureState: "unknown" },
    createdAt: at("2026-08-10T10:01:00Z"),
  },
  {
    action: "image.declared",
    actor: "merchant@example.com",
    subject: "gid://shopify/MediaImage/1",
    payload: { origin: "ai_generated", realism: "realistic" },
    createdAt: at("2026-08-10T10:02:00Z"),
  },
];

describe("canonicalize", () => {
  it("is independent of key insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("sorts keys in nested objects too", () => {
    const one = canonicalize({ outer: { z: 1, a: { y: 2, b: 3 } } });
    const two = canonicalize({ outer: { a: { b: 3, y: 2 }, z: 1 } });
    expect(one).toBe(two);
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("renders dates as ISO strings", () => {
    expect(canonicalize({ at: at("2026-08-02T00:00:00Z") })).toBe(
      '{"at":"2026-08-02T00:00:00.000Z"}',
    );
  });

  it("drops undefined properties but keeps explicit nulls", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("does not emit invalid JSON for non-finite numbers", () => {
    const out = canonicalize({ n: Number.NaN, i: Number.POSITIVE_INFINITY });
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe("hashEntry", () => {
  const base = {
    prevHash: GENESIS_HASH,
    seq: 0,
    action: "image.assessed",
    actor: "system",
    subject: "gid://shopify/MediaImage/1",
    payload: '{"a":1}',
    createdAt: at("2026-08-10T10:00:00Z"),
  };

  it("is deterministic", () => {
    expect(hashEntry(base)).toBe(hashEntry({ ...base }));
  });

  it("produces a sha256 hex digest", () => {
    expect(hashEntry(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["prevHash", { prevHash: "f".repeat(64) }],
    ["seq", { seq: 1 }],
    ["action", { action: "image.declared" }],
    ["actor", { actor: "someone.else@example.com" }],
    ["subject", { subject: "gid://shopify/MediaImage/2" }],
    ["payload", { payload: '{"a":2}' }],
    ["createdAt", { createdAt: at("2026-08-10T10:00:01Z") }],
  ])("changes when %s changes", (_field, override) => {
    expect(hashEntry({ ...base, ...override })).not.toBe(hashEntry(base));
  });

  it("treats a null subject and an absent subject alike", () => {
    const withNull = hashEntry({ ...base, subject: null });
    const withUndefined = hashEntry({ ...base, subject: undefined });
    expect(withNull).toBe(withUndefined);
  });
});

describe("buildEntry", () => {
  it("starts a chain at seq 0 from the genesis hash", () => {
    const entry = buildEntry(null, sample[0]);
    expect(entry.seq).toBe(0);
    expect(entry.prevHash).toBe(GENESIS_HASH);
  });

  it("links each entry to its predecessor", () => {
    const entries = chain(sample);
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("stores the payload canonicalised", () => {
    const entry = buildEntry(null, {
      action: "settings.changed",
      actor: "system",
      payload: { z: 1, a: 2 },
    });
    expect(entry.payload).toBe('{"a":2,"z":1}');
  });
});

describe("verifyChain", () => {
  it("accepts an empty chain", () => {
    const result = verifyChain([]);
    expect(result).toEqual({ valid: true, length: 0, head: GENESIS_HASH });
  });

  it("accepts an intact chain and reports its head", () => {
    const entries = chain(sample);
    const result = verifyChain(entries);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.length).toBe(3);
      expect(result.head).toBe(entries[2].hash);
    }
  });

  it("detects an edited payload", () => {
    // The scenario that matters: someone backdates a declaration to look as
    // though an image was reviewed before an enforcement request arrived.
    const entries = chain(sample);
    entries[1] = { ...entries[1], payload: '{"disclosureState":"not_required"}' };
    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toMatch(/altered/i);
    }
  });

  it("detects an edited actor", () => {
    const entries = chain(sample);
    entries[2] = { ...entries[2], actor: "someone.else@example.com" };
    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.brokenAt).toBe(2);
  });

  it("detects a backdated timestamp", () => {
    const entries = chain(sample);
    entries[2] = { ...entries[2], createdAt: at("2026-07-01T00:00:00Z") };
    expect(verifyChain(entries).valid).toBe(false);
  });

  it("detects a deleted entry", () => {
    const entries = chain(sample);
    const withHole = [entries[0], entries[2]];
    const result = verifyChain(withHole);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toMatch(/sequence gap/i);
    }
  });

  it("detects reordering", () => {
    const entries = chain(sample);
    const swapped = [entries[0], entries[2], entries[1]];
    expect(verifyChain(swapped).valid).toBe(false);
  });

  it("detects a broken link even when each entry hashes correctly on its own", () => {
    // Re-mint entry 2 against the genesis hash instead of entry 1. Its own
    // hash is self-consistent, so only the link check catches it.
    const entries = chain(sample);
    entries[2] = buildEntry(null, { ...sample[2] });
    entries[2] = { ...entries[2], seq: 2 };
    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/broken link|altered/i);
  });

  it("detects a truncated tail via the head hash", () => {
    const entries = chain(sample);
    const truncated = entries.slice(0, 2);
    // Truncation alone still verifies — which is exactly why the head hash has
    // to be retained or published externally to detect it.
    expect(verifyChain(truncated).valid).toBe(true);
    expect(chainHead(truncated)).not.toBe(chainHead(entries));
  });
});

describe("chainHead", () => {
  it("is the genesis hash for an empty chain", () => {
    expect(chainHead([])).toBe(GENESIS_HASH);
  });

  it("changes whenever anything in the history changes", () => {
    const original = chain(sample);
    const modified = chain([
      sample[0],
      { ...sample[1], payload: { disclosureState: "required" } },
      sample[2],
    ]);
    expect(chainHead(modified)).not.toBe(chainHead(original));
  });
});

describe("exportCsv", () => {
  it("emits a header and one row per entry", () => {
    const csv = exportCsv(chain(sample));
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "seq,created_at,action,actor,subject,payload,prev_hash,hash",
    );
  });

  it("survives a round trip through a CSV reader", () => {
    // The payload is canonicalised to JSON first, so by the time it reaches the
    // CSV writer it already contains backslash-escaped quotes as well as a
    // comma. Parsing the row back is the only assertion that actually proves
    // the columns did not shift and nothing was mangled.
    const entries = chain([
      {
        action: "image.declared",
        actor: "merchant@example.com",
        subject: "gid://shopify/MediaImage/1",
        payload: { note: 'Studio shot, "reshot" in April' },
        createdAt: at("2026-08-10T10:00:00Z"),
      },
    ]);
    const fields = parseCsvRow(exportCsv(entries).split("\r\n")[1]);

    expect(fields).toHaveLength(8);
    expect(fields[5]).toBe(entries[0].payload);
    expect(JSON.parse(fields[5]).note).toBe('Studio shot, "reshot" in April');
    expect(fields[7]).toBe(entries[0].hash);
  });

  it("quotes only the fields that need it", () => {
    const row = exportCsv(chain([sample[1]])).split("\r\n")[1];
    // seq and action carry no delimiters, so they stay bare.
    expect(row.startsWith("0,")).toBe(true);
    expect(row).toContain(",image.assessed,");
  });

  it("includes the hash columns so the export can be re-verified", () => {
    const entries = chain(sample);
    const csv = exportCsv(entries);
    expect(csv).toContain(entries[2].hash);
    expect(csv).toContain(GENESIS_HASH);
  });
});
