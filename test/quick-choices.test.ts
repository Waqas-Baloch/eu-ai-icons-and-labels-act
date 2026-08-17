import { describe, expect, it } from "vitest";

import {
  matchChoice,
  quickChoice,
  QUICK_CHOICES,
  type QuickChoiceId,
} from "../app/lib/quick-choices";
import { assessImage } from "../app/lib/compliance/article50";
import type {
  CompliancePolicy,
  MerchantDeclaration,
  ProvenanceFinding,
} from "../app/lib/compliance/types";

/**
 * These four buttons are the primary path for every decision a merchant makes.
 * A wrong mapping would mis-label an entire catalog without anyone noticing, so
 * each choice is run through the real rule engine and its outcome asserted.
 */

const policy: CompliancePolicy = {
  conservativeDefault: true,
  labelPreCutoffContent: false,
};
const noMetadata: ProvenanceFinding = { source: "none", origin: "unknown" };

/** Mimics what parseDeclaration() builds from the submitted fields. */
function declarationFromChoice(id: QuickChoiceId): MerchantDeclaration {
  const fields = quickChoice(id)!.fields;
  return {
    origin: fields.origin as MerchantDeclaration["origin"],
    realism: fields.realism as MerchantDeclaration["realism"],
    context: fields.context as MerchantDeclaration["context"],
    editScope: fields.editScope as MerchantDeclaration["editScope"],
    declaredBy: "merchant@example.com",
    declaredAt: new Date("2026-08-16T10:00:00Z"),
  };
}

function outcomeOf(id: QuickChoiceId) {
  return assessImage({
    detected: noMetadata,
    declaration: declarationFromChoice(id),
    policy,
  });
}

describe("quick choice definitions", () => {
  it("offers exactly four options with unique ids", () => {
    expect(QUICK_CHOICES).toHaveLength(4);
    expect(new Set(QUICK_CHOICES.map((c) => c.id)).size).toBe(4);
  });

  it("gives every choice a label and a plain-language hint", () => {
    for (const choice of QUICK_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.hint.length).toBeGreaterThan(0);
      // The hint should describe the picture, not recite the statute.
      expect(choice.hint).not.toMatch(/Article|3\(60\)|deep ?fake/i);
    }
  });

  it("always supplies a realism answer whenever AI is involved", () => {
    // Without it the engine cannot settle Article 3(60) and would return
    // "unknown" — leaving the image in the queue the merchant just cleared.
    for (const choice of QUICK_CHOICES) {
      if (choice.fields.origin === "not_ai") continue;
      expect(choice.fields.realism).toBeTruthy();
    }
  });
});

describe("each choice resolves the image", () => {
  it.each(QUICK_CHOICES.map((c) => c.id))(
    "%s produces a settled state, never 'unknown'",
    (id) => {
      const result = outcomeOf(id);
      expect(result.disclosureState).not.toBe("unknown");
      expect(result.needsMerchantReview).toBe(false);
      expect(result.provisional).toBe(false);
    },
  );
});

describe("choice outcomes", () => {
  it("'Real photo' needs no label", () => {
    const result = outcomeOf("real");
    expect(result.disclosureState).toBe("not_required");
    expect(result.labelVariant).toBe("none");
  });

  it("'Real photo, AI-edited' requires the AI MODIFIED label", () => {
    const result = outcomeOf("edited");
    expect(result.disclosureState).toBe("required");
    expect(result.labelVariant).toBe("ai_modified");
  });

  it("'AI-generated, looks real' requires the AI GENERATED label", () => {
    const result = outcomeOf("generated");
    expect(result.disclosureState).toBe("required");
    expect(result.labelVariant).toBe("ai_generated");
  });

  it("'AI-generated, clearly not real' needs no label", () => {
    const result = outcomeOf("illustration");
    expect(result.disclosureState).toBe("not_required");
    expect(result.labelVariant).toBe("none");
  });

  it("does not mark an AI-edited photo as assistive-only", () => {
    // The quick path must not silently claim the edit was trivial — that would
    // exempt a substantially manipulated photo from disclosure.
    expect(quickChoice("edited")!.fields.editScope).toBe("substantial");
  });

  it("never routes a quick choice into the creative-works carve-out", () => {
    // "reduced" is a real outcome, but it needs a deliberate declaration that
    // the image is an artistic work — not something a one-click path assumes.
    for (const choice of QUICK_CHOICES) {
      expect(outcomeOf(choice.id).disclosureState).not.toBe("reduced");
    }
  });
});

describe("matchChoice round trip", () => {
  it.each(QUICK_CHOICES.map((c) => c.id))(
    "recognises a stored %s declaration",
    (id) => {
      const fields = quickChoice(id)!.fields;
      expect(
        matchChoice({
          declaredOrigin: fields.origin,
          declaredRealism: fields.realism ?? null,
        }),
      ).toBe(id);
    },
  );

  it("returns null when nothing has been declared", () => {
    expect(matchChoice({ declaredOrigin: null, declaredRealism: null })).toBeNull();
  });

  it("maps a stylised declaration onto the illustration choice", () => {
    // Declared via the advanced path rather than a button; the card still has
    // to show something sensible rather than falling back to "unanswered".
    expect(
      matchChoice({ declaredOrigin: "ai_generated", declaredRealism: "stylised" }),
    ).toBe("illustration");
  });
});
