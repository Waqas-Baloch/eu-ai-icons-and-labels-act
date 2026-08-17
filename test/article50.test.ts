import { describe, expect, it } from "vitest";
import {
  ARTICLE_50_APPLICATION_DATE,
  assessImage,
  rollUpProduct,
  type AssessmentInput,
} from "../app/lib/compliance/article50";
import type {
  CompliancePolicy,
  MerchantDeclaration,
  ProvenanceFinding,
} from "../app/lib/compliance/types";

const conservative: CompliancePolicy = {
  conservativeDefault: true,
  labelPreCutoffContent: false,
};
const permissive: CompliancePolicy = {
  conservativeDefault: false,
  labelPreCutoffContent: false,
};

const noMetadata: ProvenanceFinding = { source: "none", origin: "unknown" };

function declare(overrides: Partial<MerchantDeclaration> = {}): MerchantDeclaration {
  return {
    origin: "ai_generated",
    declaredBy: "merchant@example.com",
    declaredAt: new Date("2026-08-10T12:00:00Z"),
    ...overrides,
  };
}

function assess(input: Partial<AssessmentInput> = {}) {
  return assessImage({
    detected: noMetadata,
    policy: conservative,
    ...input,
  });
}

const codes = (r: { reasoning: { code: string }[] }) => r.reasoning.map((s) => s.code);

describe("origin resolution", () => {
  it("treats non-AI content as outside Article 50 entirely", () => {
    const result = assess({ declaration: declare({ origin: "not_ai" }) });
    expect(result.disclosureState).toBe("not_required");
    expect(result.labelVariant).toBe("none");
    expect(result.needsMerchantReview).toBe(false);
    expect(codes(result)).toContain("scope.not_ai");
  });

  it("lets a merchant declaration override contrary metadata", () => {
    const result = assess({
      detected: { source: "c2pa", origin: "ai_generated", generatorName: "Midjourney" },
      declaration: declare({ origin: "not_ai" }),
    });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).toContain("origin.declared");
  });

  it("notes that missing metadata is not evidence of absence", () => {
    const result = assess();
    expect(codes(result)).toContain("origin.no_metadata");
  });
});

describe("unresolved images", () => {
  it("labels provisionally with the generic AI badge under conservative policy", () => {
    const result = assess();
    expect(result.disclosureState).toBe("unknown");
    // The generic label discloses the possibility without asserting how the
    // image was made — we genuinely do not know yet.
    expect(result.labelVariant).toBe("ai");
    expect(result.provisional).toBe(true);
    expect(result.needsMerchantReview).toBe(true);
  });

  it("leaves them unlabelled when the shop opts out of provisional labelling", () => {
    const result = assess({ policy: permissive });
    expect(result.disclosureState).toBe("unknown");
    expect(result.labelVariant).toBe("none");
    expect(result.provisional).toBe(false);
    expect(result.needsMerchantReview).toBe(true);
  });
});

describe("temporal scope (2 August 2026)", () => {
  it("exempts content created before the application date", () => {
    const result = assess({
      declaration: declare({
        realism: "realistic",
        contentCreatedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).toContain("temporal.pre_cutoff");
  });

  it("still assesses pre-cutoff content when the shop opts into voluntary labelling", () => {
    const result = assess({
      policy: { conservativeDefault: true, labelPreCutoffContent: true },
      declaration: declare({
        realism: "realistic",
        contentCreatedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    });
    expect(result.disclosureState).toBe("required");
    expect(codes(result)).toContain("temporal.pre_cutoff_voluntary");
  });

  it("treats content created on the application date itself as in scope", () => {
    const result = assess({
      declaration: declare({
        realism: "realistic",
        contentCreatedAt: ARTICLE_50_APPLICATION_DATE,
      }),
    });
    expect(result.disclosureState).toBe("required");
  });

  it("does not rely on the exemption when the date is unknown", () => {
    const result = assess({ declaration: declare({ realism: "realistic" }) });
    expect(result.disclosureState).toBe("required");
    expect(codes(result)).toContain("temporal.unknown_date");
  });

  it("prefers the merchant's creation date over the metadata date", () => {
    const result = assess({
      detected: {
        source: "exif",
        origin: "ai_generated",
        contentCreatedAt: new Date("2026-09-01T00:00:00Z"),
      },
      declaration: declare({
        realism: "realistic",
        contentCreatedAt: new Date("2026-05-01T00:00:00Z"),
      }),
    });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).toContain("temporal.pre_cutoff");
  });
});

describe("assistive editing carve-out", () => {
  it("exempts assistive edits to a real photograph", () => {
    const result = assess({
      declaration: declare({
        origin: "ai_modified",
        editScope: "assistive",
        realism: "realistic",
      }),
    });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).toContain("scope.assistive_editing");
  });

  it("does not exempt substantial generative edits", () => {
    const result = assess({
      declaration: declare({
        origin: "ai_modified",
        editScope: "substantial",
        realism: "realistic",
      }),
    });
    expect(result.disclosureState).toBe("required");
    expect(result.labelVariant).toBe("ai_modified");
  });

  it("ignores edit scope for fully generated images", () => {
    const result = assess({
      declaration: declare({
        origin: "ai_generated",
        editScope: "assistive",
        realism: "realistic",
      }),
    });
    expect(result.disclosureState).toBe("required");
    expect(codes(result)).not.toContain("scope.assistive_editing");
  });
});

describe("Article 3(60) deep fake test", () => {
  it("requires disclosure for realistic AI-generated product imagery", () => {
    const result = assess({ declaration: declare({ realism: "realistic" }) });
    expect(result.disclosureState).toBe("required");
    expect(result.labelVariant).toBe("ai_generated");
    expect(result.provisional).toBe(false);
    expect(codes(result)).toContain("deepfake.criteria_met");
    expect(codes(result)).toContain("obligation.disclosure_required");
  });

  it("selects the AI MODIFIED label for realistic composited edits", () => {
    const result = assess({
      declaration: declare({ origin: "ai_modified", realism: "realistic" }),
    });
    expect(result.disclosureState).toBe("required");
    expect(result.labelVariant).toBe("ai_modified");
  });

  it("exempts fantastical imagery on the resemblance criterion", () => {
    const result = assess({ declaration: declare({ realism: "fantastical" }) });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).toContain("deepfake.not_resembling");
  });

  it("exempts evidently stylised imagery but flags it as a judgement call", () => {
    const result = assess({ declaration: declare({ realism: "stylised" }) });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).toContain("deepfake.not_authentic_appearing");
    expect(codes(result)).toContain("advisory.borderline_stylised");
  });

  it("labels provisionally when origin is known but realism is not", () => {
    const result = assess({
      detected: { source: "c2pa", origin: "ai_generated", generatorName: "DALL·E" },
    });
    expect(result.disclosureState).toBe("unknown");
    expect(result.labelVariant).toBe("ai_generated");
    expect(result.provisional).toBe(true);
    expect(result.needsMerchantReview).toBe(true);
  });

  it("withholds the label when realism is undeclared and policy is permissive", () => {
    const result = assess({
      policy: permissive,
      detected: { source: "c2pa", origin: "ai_generated" },
    });
    expect(result.labelVariant).toBe("none");
    expect(result.needsMerchantReview).toBe(true);
  });
});

describe("creative works carve-out", () => {
  it("reduces the obligation for evidently artistic work", () => {
    const result = assess({
      declaration: declare({ realism: "realistic", context: "artistic" }),
    });
    expect(result.disclosureState).toBe("reduced");
    expect(result.labelVariant).toBe("ai_generated");
    expect(codes(result)).toContain("carveout.creative_work");
  });

  it("does not reduce it for commercial imagery", () => {
    const result = assess({
      declaration: declare({ realism: "realistic", context: "commercial" }),
    });
    expect(result.disclosureState).toBe("required");
  });

  it("does not reach the carve-out when the deep fake test already failed", () => {
    const result = assess({
      declaration: declare({ realism: "fantastical", context: "artistic" }),
    });
    expect(result.disclosureState).toBe("not_required");
    expect(codes(result)).not.toContain("carveout.creative_work");
  });
});

describe("audit quality", () => {
  it("always explains itself in at least two steps", () => {
    const inputs: Partial<AssessmentInput>[] = [
      {},
      { declaration: declare({ origin: "not_ai" }) },
      { declaration: declare({ realism: "realistic" }) },
      { declaration: declare({ realism: "fantastical" }) },
      { declaration: declare({ realism: "stylised" }) },
      { declaration: declare({ realism: "realistic", context: "artistic" }) },
      { declaration: declare({ origin: "ai_modified", editScope: "assistive" }) },
      { policy: permissive },
    ];
    for (const input of inputs) {
      const result = assess(input);
      expect(result.reasoning.length).toBeGreaterThanOrEqual(2);
      expect(result.engineVersion).toBe("1.0.0");
    }
  });

  it("cites a legal basis on every dispositive step", () => {
    const result = assess({ declaration: declare({ realism: "realistic" }) });
    const dispositive = result.reasoning.filter((s) =>
      s.code.startsWith("deepfake.") || s.code.startsWith("obligation."),
    );
    expect(dispositive.length).toBeGreaterThan(0);
    for (const step of dispositive) {
      expect(step.legalBasis).toBeTruthy();
    }
  });
});

describe("product roll-up", () => {
  it("returns not_required for a product with no images", () => {
    expect(rollUpProduct([])).toEqual({
      disclosureState: "not_required",
      labelVariant: "none",
      needsReview: false,
    });
  });

  it("takes the strictest state across the images", () => {
    const clean = assess({ declaration: declare({ origin: "not_ai" }) });
    const flagged = assess({ declaration: declare({ realism: "realistic" }) });
    const rolled = rollUpProduct([clean, flagged, clean]);
    expect(rolled.disclosureState).toBe("required");
    expect(rolled.labelVariant).toBe("ai_generated");
  });

  it("ranks an unresolved image above a reduced-obligation one", () => {
    const unresolved = assess();
    const reduced = assess({
      declaration: declare({ realism: "realistic", context: "artistic" }),
    });
    expect(rollUpProduct([reduced, unresolved]).disclosureState).toBe("unknown");
  });

  it("surfaces review need from any image", () => {
    const clean = assess({ declaration: declare({ origin: "not_ai" }) });
    const unresolved = assess();
    expect(rollUpProduct([clean, unresolved]).needsReview).toBe(true);
    expect(rollUpProduct([clean, clean]).needsReview).toBe(false);
  });
});
