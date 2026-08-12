import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveUnderWorkspace } from "./paths.js";
import { applyUnifiedDiff } from "./tools.js";

describe("resolveUnderWorkspace", () => {
  const root = path.resolve("C:\\tmp\\workspace-test");

  it("allows relative paths inside root", () => {
    const resolved = resolveUnderWorkspace(root, "src/index.ts");
    assert.equal(resolved, path.join(root, "src", "index.ts"));
  });

  it("rejects parent escapes", () => {
    assert.throws(() => resolveUnderWorkspace(root, "../secret"), /escapes/);
  });
});

describe("applyUnifiedDiff", () => {
  it("replaces full file content from simple diff", () => {
    const before = "a\nb\n";
    const patch = [
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,2 @@",
      "-a",
      "-b",
      "-",
      "+a",
      "+c",
      "+",
    ].join("\n");
    // our generator style
    const gen = [
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,2 @@",
      "-a",
      "-b",
      "+a",
      "+c",
    ].join("\n");
    const next = applyUnifiedDiff("a\nb", gen);
    assert.equal(next, "a\nc");
    void before;
    void patch;
  });
});
