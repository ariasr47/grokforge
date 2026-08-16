import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");
test("App does not infer completion by scanning transcript", () => {
  assert.equal(appSource.includes("hasAssistantText"), false);
  assert.equal(appSource.includes("Model returned reasoning only"), false);
});
test("App does not promote reasoning into answer content", () => {
  assert.equal(/thinking[\s\S]{0,200}Model returned reasoning only/.test(appSource), false);
  assert.equal(/content:\s*[`\"]\*\(Model returned reasoning only/.test(appSource), false);
});
