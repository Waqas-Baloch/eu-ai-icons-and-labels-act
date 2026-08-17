import { describe, expect, it } from "vitest";

import { TERMS, TERMS_ACKNOWLEDGEMENT, TERMS_VERSION } from "../app/lib/terms";

/**
 * The terms are the app's primary contractual notice to the merchant and the
 * thing the audit chain records on acceptance. These assert the substance the
 * product's liability posture depends on, so a future edit cannot quietly drop
 * a disclaimer that was the reason the clause existed.
 */

const allText = TERMS.flatMap((clause) => [clause.heading, ...clause.body])
  .join(" ")
  .toLowerCase();

describe("terms structure", () => {
  it("is versioned with a sortable date", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has a heading and body for every clause", () => {
    expect(TERMS.length).toBeGreaterThanOrEqual(5);
    for (const clause of TERMS) {
      expect(clause.heading.trim().length).toBeGreaterThan(0);
      expect(clause.body.length).toBeGreaterThan(0);
      for (const paragraph of clause.body) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("required disclaimers", () => {
  it("denies affiliation with or endorsement by the EU", () => {
    expect(allText).toContain("not affiliated");
    expect(allText).toContain("endorsed");
    expect(allText).toContain("european union");
  });

  it("denies being an official compliance partner", () => {
    expect(allText).toMatch(/authorised|certified/);
  });

  it("states it is not legal advice", () => {
    expect(allText).toContain("does not provide legal advice");
  });

  it("refuses to guarantee compliance", () => {
    expect(allText).toMatch(/does not certify, guarantee/);
  });

  it("places responsibility for irregularities on the merchant", () => {
    expect(allText).toContain("you are responsible");
    expect(allText).toContain("irregularity");
  });

  it("names the merchant as the deployer and states the penalty exposure", () => {
    expect(allText).toContain("deployer");
    expect(allText).toContain("15,000,000");
  });

  it("is honest that detection is best-effort", () => {
    expect(allText).toMatch(/best-effort|strip that metadata/);
  });

  it("does not claim the audit chain proves a declaration was correct", () => {
    expect(allText).toContain("not third-party attestation");
  });
});

describe("the recorded acknowledgement", () => {
  it("stands alone as a summary of what was agreed", () => {
    const ack = TERMS_ACKNOWLEDGEMENT.toLowerCase();
    expect(ack).toContain("not affiliated with or endorsed by the european union");
    expect(ack).toContain("does not provide legal advice");
    expect(ack).toContain("does not guarantee compliance");
    expect(ack).toContain("deployer");
    expect(ack).toContain("responsible");
  });

  it("never asserts the merchant is compliant", () => {
    expect(TERMS_ACKNOWLEDGEMENT.toLowerCase()).not.toMatch(/\bis compliant\b/);
  });
});
