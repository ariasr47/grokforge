export const INHERITED_DEFAULT_MODEL = "grok-4.6" as const;
export const KNOWN_MODEL_IDS = [INHERITED_DEFAULT_MODEL, "grok-4-fast-non-reasoning", "grok-4-fast", "grok-4"] as const;

/**
 * Published context-window sizes (tokens), by model id. House/guest rule: a
 * number only lands here when it is sourced from xAI's own current docs
 * (docs.x.ai) — never estimated. grok-4.6 confirmed 500,000 tokens at
 * https://docs.x.ai/developers/grok-4-6 (checked 2026-09-03). The other
 * KNOWN_MODEL_IDS are legacy selections migrateModelSelection() steers
 * sessions away from; xAI's current model docs no longer publish a context
 * window for them, so they stay absent rather than carry a guessed number.
 */
export const MODEL_CONTEXT_WINDOW_TOKENS: Readonly<Record<string, number>> = {
  "grok-4.6": 500_000,
};

/** Real context-window size for `model`, or null when we have no sourced number. */
export function contextWindowForModel(model: string): number | null {
  return MODEL_CONTEXT_WINDOW_TOKENS[model] ?? null;
}
export type ModelSelectionProvenance = "inherited" | "explicit";
export type ModelMigrationRule = "legacy_grok_4_to_grok_4_6" | null;
export const MODEL_MIGRATION_VERSION = 1 as const;

export function migrateModelSelection(input: { model?: unknown; modelSelectionProvenance?: unknown; modelMigrationVersion?: unknown }): {
  model: string; provenance: ModelSelectionProvenance; migrationVersion: number; migrationRule: ModelMigrationRule; changed: boolean;
} {
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : INHERITED_DEFAULT_MODEL;
  const provenance = input.modelSelectionProvenance === "explicit" ? "explicit" : input.modelSelectionProvenance === "inherited" ? "inherited" : null;
  if (provenance === "explicit") return { model, provenance, migrationVersion: MODEL_MIGRATION_VERSION, migrationRule: null, changed: input.modelMigrationVersion !== MODEL_MIGRATION_VERSION };
  if (provenance === null && model === "grok-4") return { model: INHERITED_DEFAULT_MODEL, provenance: "inherited", migrationVersion: MODEL_MIGRATION_VERSION, migrationRule: "legacy_grok_4_to_grok_4_6", changed: true };
  return { model, provenance: "inherited", migrationVersion: MODEL_MIGRATION_VERSION, migrationRule: null, changed: input.model === undefined || input.modelSelectionProvenance !== "inherited" || input.modelMigrationVersion !== MODEL_MIGRATION_VERSION };
}
