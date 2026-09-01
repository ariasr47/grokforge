import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileChangesDiffLines, splitUnifiedDiff } from "./diffUtil.js";

describe("splitUnifiedDiff", () => {
  it("splits before/after lines from a unified hunk", () => {
    const diff = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-old",
      "+new",
      " line3",
    ].join("\n");
    const { before, after, header } = splitUnifiedDiff(diff);
    assert.ok(header.some((h) => h.startsWith("@@")));
    assert.deepEqual(before, ["line1", "old", "line3"]);
    assert.deepEqual(after, ["line1", "new", "line3"]);
  });

  it("fileChangesDiffLines drops --- / +++ file headers", () => {
    const lines = fileChangesDiffLines(
      "--- a/foo.ts\n+++ b/foo.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n",
    );
    assert.deepEqual(lines, ["-old", "+new", ""]);
    assert.equal(lines.some((l) => l.startsWith("---") || l.startsWith("+++")), false);
  });

  it("fileChangesDiffLines drops @@ on tiny one-hunk writes", () => {
    const tiny = fileChangesDiffLines(
      "--- /dev/null\n+++ b/docs/dogfood/HUNK.md\n@@ -0,0 +1,1 @@\n+HUNK-OK\n",
    );
    assert.deepEqual(tiny, ["+HUNK-OK", ""]);
    assert.equal(tiny.some((l) => l.startsWith("@@")), false);
  });

  it("fileChangesDiffLines keeps @@ on larger diffs", () => {
    const plus = Array.from({ length: 13 }, (_, i) => `+line${i}`).join("\n");
    const lines = fileChangesDiffLines(
      `--- a/big.ts\n+++ b/big.ts\n@@ -1,13 +1,13 @@\n${plus}\n`,
    );
    assert.ok(lines.some((l) => l.startsWith("@@")));
    assert.ok(lines.includes("+line0"));
  });

  it("normalizes CRLF", () => {
    const { after } = splitUnifiedDiff(
      "--- a\r\n+++ b\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n",
    );
    assert.deepEqual(after, ["new"]);
  });
});
