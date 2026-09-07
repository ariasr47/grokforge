import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countDiffLines, fileChangesDiffLines, splitDiffHunks, splitUnifiedDiff } from "./diffUtil.js";

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

describe("countDiffLines", () => {
  it("counts + / - lines and ignores file headers", () => {
    const diff = "--- a/f.ts\n+++ b/f.ts\n@@ -1,2 +1,3 @@\n line1\n-old\n+new1\n+new2\n";
    assert.deepEqual(countDiffLines(diff), { added: 2, removed: 1 });
  });

  it("is zero for a diff with no changed lines", () => {
    assert.deepEqual(countDiffLines("--- a\n+++ b\n@@ -1 +1 @@\n line1\n"), { added: 0, removed: 0 });
  });
});

describe("splitDiffHunks", () => {
  it("numbers context/add lines from the new file and del lines from the old file", () => {
    const diff = [
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -12,4 +12,5 @@ buildSummary",
      "  const s = buildSummary({",
      "-   turns: 3,",
      "+   turnCount: 3,",
      "+   // renamed in sessions v2",
      "  branch: \"master\",",
      "  });",
    ].join("\n");
    const hunks = splitDiffHunks(diff);
    assert.equal(hunks.length, 1);
    const hunk = hunks[0]!;
    assert.equal(hunk.range, "@@ -12,4 +12,5 @@");
    assert.equal(hunk.context, "buildSummary");
    assert.deepEqual(
      hunk.lines.map((l) => [l.kind, l.no]),
      [
        ["context", 12],
        ["del", 13],
        ["add", 13],
        ["add", 14],
        ["context", 15],
        ["context", 16],
      ],
    );
  });

  it("splits multiple hunks and reports each independently", () => {
    const diff = [
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      "@@ -10,1 +10,1 @@",
      "-c",
      "+d",
    ].join("\n");
    const hunks = splitDiffHunks(diff);
    assert.equal(hunks.length, 2);
    assert.equal(hunks[0]!.range, "@@ -1,1 +1,1 @@");
    assert.equal(hunks[1]!.range, "@@ -10,1 +10,1 @@");
  });

  it("folds a tiny one-hunk write with no @@ header into one synthetic hunk", () => {
    const hunks = splitDiffHunks("--- /dev/null\n+++ b/docs/HUNK.md\n+HUNK-OK\n");
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0]!.range, "");
    assert.deepEqual(hunks[0]!.lines, [{ kind: "add", no: 1, text: "+HUNK-OK" }]);
  });

  it("returns no hunks for an empty diff", () => {
    assert.deepEqual(splitDiffHunks(""), []);
    assert.deepEqual(splitDiffHunks("--- a\n+++ b\n"), []);
  });
});
