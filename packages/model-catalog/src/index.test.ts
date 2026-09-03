import test from "node:test";
import assert from "node:assert/strict";
import { contextWindowForModel, INHERITED_DEFAULT_MODEL, migrateModelSelection } from "./index.js";

test("clean selection inherits grok-4.6", () => {
  assert.equal(INHERITED_DEFAULT_MODEL, "grok-4.6");
  assert.deepEqual(migrateModelSelection({}), { model: "grok-4.6", provenance: "inherited", migrationVersion: 1, migrationRule: null, changed: true });
});
test("legacy grok-4 migrates once", () => {
  assert.deepEqual(migrateModelSelection({ model: "grok-4" }), { model: "grok-4.6", provenance: "inherited", migrationVersion: 1, migrationRule: "legacy_grok_4_to_grok_4_6", changed: true });
  assert.equal(migrateModelSelection({ model: "grok-4.6", modelSelectionProvenance: "inherited", modelMigrationVersion: 1 }).changed, false);
});
test("explicit selection is preserved", () => {
  const result = migrateModelSelection({ model: "grok-3", modelSelectionProvenance: "explicit", modelMigrationVersion: 0 });
  assert.equal(result.model, "grok-3");
  assert.equal(result.provenance, "explicit");
});
test("other legacy values remain unchanged", () => assert.equal(migrateModelSelection({ model: "grok-4-fast" }).model, "grok-4-fast"));
test("context window is sourced only for the models we have a real published number for", () => {
  assert.equal(contextWindowForModel("grok-4.6"), 500_000);
  assert.equal(contextWindowForModel("grok-4"), null);
  assert.equal(contextWindowForModel("grok-4-fast"), null);
  assert.equal(contextWindowForModel("grok-4-fast-non-reasoning"), null);
  assert.equal(contextWindowForModel("unknown-model-id"), null);
});
