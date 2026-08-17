/**
 * The four answers that cover essentially every product photo.
 *
 * Each maps to a complete declaration, so one click fully resolves an image.
 * The wording deliberately describes the picture rather than the legal test —
 * a merchant knows whether their photo is a real photo; they do not know what
 * "resembles an existing object and would falsely appear authentic" means.
 * The engine still applies the Article 3(60) test to whatever they tell us.
 *
 * Kept free of React so the mapping can be tested against the rule engine
 * directly. These four options are now the primary path for every decision in
 * the app, so a wrong mapping would mis-label a whole catalog silently.
 */

export interface QuickChoice {
  id: QuickChoiceId;
  label: string;
  hint: string;
  /** Form fields submitted for this choice, matching parseDeclaration(). */
  fields: Record<string, string>;
}

export type QuickChoiceId = "real" | "edited" | "generated" | "illustration";

export const QUICK_CHOICES: QuickChoice[] = [
  {
    id: "real",
    label: "Real photo",
    hint: "An ordinary photograph. No generative AI involved.",
    fields: { origin: "not_ai" },
  },
  {
    id: "edited",
    label: "Real photo, AI-edited",
    hint: "A real photograph with generative edits — background replaced, objects added or removed.",
    fields: {
      origin: "ai_modified",
      realism: "realistic",
      editScope: "substantial",
      context: "commercial",
    },
  },
  {
    id: "generated",
    label: "AI-generated, looks real",
    hint: "Made by AI, and a customer could take it for a photograph.",
    fields: { origin: "ai_generated", realism: "realistic", context: "commercial" },
  },
  {
    id: "illustration",
    label: "AI-generated, clearly not real",
    hint: "Made by AI, and obviously not a photograph — an illustration, render or fantasy scene.",
    fields: {
      origin: "ai_generated",
      realism: "fantastical",
      context: "commercial",
    },
  },
];

export function quickChoice(id: QuickChoiceId): QuickChoice | undefined {
  return QUICK_CHOICES.find((choice) => choice.id === id);
}

/** Which quick choice a stored declaration corresponds to, if any. */
export function matchChoice(image: {
  declaredOrigin: string | null;
  declaredRealism: string | null;
}): QuickChoiceId | null {
  if (!image.declaredOrigin) return null;
  if (image.declaredOrigin === "not_ai") return "real";
  if (image.declaredOrigin === "ai_modified") return "edited";
  if (image.declaredOrigin === "ai_generated") {
    return image.declaredRealism === "realistic" ? "generated" : "illustration";
  }
  return null;
}
