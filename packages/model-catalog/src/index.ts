export const INHERITED_DEFAULT_MODEL = "grok-4.6" as const;
export const KNOWN_MODEL_IDS = [INHERITED_DEFAULT_MODEL, "grok-4-fast-non-reasoning", "grok-4-fast", "grok-4"] as const;
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
