import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyUnifiedDiff, prepareWriteEdit } from "./tools.js";

function numberedFile(n: number): string {
  return Array.from({ length: n }, (_, i) => `line-${i}`).join("\n") + "\n";
}

test("a two-hunk patch on a 400-line file applies both edits (not write_file fallback)", async () => {
  const before = numberedFile(400);
  const patch = [
    "--- a/big.ts",
    "+++ b/big.ts",
    "@@ -10,3 +10,3 @@",
    " line-9",
    "-line-10",
    "+LINE-TEN",
    " line-11",
    "@@ -351,3 +351,4 @@",
    " line-350",
    " line-351",
    "+inserted-near-end",
    " line-352",
  ].join("\n");
  const next = applyUnifiedDiff(before, patch);
  assert.match(next, /^line-0\n/);
  assert.match(next, /\nLINE-TEN\n/);
  assert.doesNotMatch(next, /\nline-10\n/);
  assert.match(next, /\nline-351\ninserted-near-end\nline-352\n/);
  assert.match(next, /\nline-399\n$/);
});

test("apply_patch tool of a mid-file insert does not throw the write_file steer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-apply-patch-"));
  try {
    const rel = "apps/shell/src/dock/ChangesDock.tsx";
    const abs = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, numberedFile(480));
    const patch = [
      "--- a/apps/shell/src/dock/ChangesDock.tsx",
      "+++ b/apps/shell/src/dock/ChangesDock.tsx",
      "@@ -424,3 +424,4 @@",
      " line-423",
      " line-424",
      "+function GitTab-marker",
      " line-425",
    ].join("\n");
    const edit = await prepareWriteEdit(root, "apply_patch", { path: rel, patch }, "p1");
    assert.match(edit.next, /\nfunction GitTab-marker\n/);
    assert.equal(edit.next.split("\n").filter((l) => l.startsWith("line-")).length, 480);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a hunk whose blank context line has no leading space still applies (live @@ -1,3)", () => {
  const before = [
    'import type { PlanEngagementView, ProductMode } from "../lib/api";',
    "",
    "export type PlanArmProjection =",
    "  | { state: \"absent_chat\" }",
  ].join("\n") + "\n";
  const patch = [
    "--- a/apps/shell/src/projections/planArm.ts",
    "+++ b/apps/shell/src/projections/planArm.ts",
    "@@ -1,3 +1,4 @@",
    ' import type { PlanEngagementView, ProductMode } from "../lib/api";',
    "",
    " export type PlanArmProjection =",
    "+// ever-goal-patch-hunk-1",
  ].join("\n");
  const next = applyUnifiedDiff(before, patch);
  assert.match(next, /export type PlanArmProjection =\n\/\/ ever-goal-patch-hunk-1\n/);
});

test("a hunk whose context lines omit the leading space still applies (live model @@ -1,3)", () => {
  const before = [
    'import type { PlanEngagementView, ProductMode } from "../lib/api";',
    "",
    "export type PlanArmProjection =",
    "  | { state: \"absent_chat\" }",
  ].join("\n") + "\n";
  const patch = [
    "--- a/apps/shell/src/projections/planArm.ts",
    "+++ b/apps/shell/src/projections/planArm.ts",
    "@@ -1,3 +1,4 @@",
    'import type { PlanEngagementView, ProductMode } from "../lib/api";',
    "",
    "export type PlanArmProjection =",
    "+// ever-goal-blank-context",
  ].join("\n");
  const next = applyUnifiedDiff(before, patch);
  assert.match(next, /export type PlanArmProjection =\n\/\/ ever-goal-blank-context\n/);
});

test("a trailing newline on a valid insert-at-top hunk is not a phantom blank context line (live Deny-one api.ts)", () => {
  const before = [
    'import { callDesktop } from "./desktopBridge";',
    "export const X = 1;",
  ].join("\n") + "\n";
  const patch = [
    "--- a/apps/shell/src/lib/api.ts",
    "+++ b/apps/shell/src/lib/api.ts",
    "@@ -1,1 +1,2 @@",
    '-import { callDesktop } from "./desktopBridge";',
    "+// deny-one-recapture",
    '+import { callDesktop } from "./desktopBridge";',
    "",
  ].join("\n");
  const next = applyUnifiedDiff(before, patch);
  assert.match(next, /^\/\/ deny-one-recapture\nimport \{ callDesktop \}/);
});

test("@@ -0,0 +1,1 insert at start applies when the patch ends with a newline (live Deny-one)", () => {
  const before = 'import { callDesktop } from "./desktopBridge";\n';
  const patch = "@@ -0,0 +1,1 @@\n+// deny-one-recapture\n";
  const next = applyUnifiedDiff(before, patch);
  assert.equal(next, "// deny-one-recapture\nimport { callDesktop } from \"./desktopBridge\";\n");
});

test("V4A *** End Patch after a hunk is not treated as file context (live model envelope)", () => {
  const before = 'import { callDesktop } from "./desktopBridge";\n';
  const patch = [
    "*** Begin Patch",
    "*** Update File: apps/shell/src/lib/api.ts",
    "@@ -0,0 +1,1 @@",
    "+// deny-one-recapture",
    "*** End Patch",
    "",
  ].join("\n");
  const next = applyUnifiedDiff(before, patch);
  assert.match(next, /^\/\/ deny-one-recapture\nimport \{ callDesktop \}/);
});

test("an unparseable patch error names missing @@ and quotes the first body line", () => {
  assert.throws(
    () => applyUnifiedDiff("alpha\n", "not a unified diff\n"),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /no @@ hunk/i);
      assert.match(msg, /not a unified diff/);
      assert.doesNotMatch(msg, /write_file/);
      return true;
    },
  );
});

test("a failing patch does not tell the model to write_file the whole file", () => {
  assert.throws(
    () => applyUnifiedDiff("alpha\n", "--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-nope\n+yes\n"),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.doesNotMatch(msg, /write_file/);
      assert.match(msg, /hunk/i);
      return true;
    },
  );
});

test("a failing hunk error quotes the first mismatched file line (live @@ -21,6 class)", () => {
  assert.throws(
    () => applyUnifiedDiff("alpha\nbeta\n", "@@ -1,1 +1,1 @@\n-nope\n+yes\n"),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /file line 1: "alpha"/);
      assert.match(msg, /patch expected: "nope"/);
      assert.doesNotMatch(msg, /write_file/);
      return true;
    },
  );
});

test("a failing multi-line hunk quotes the first differing line not the matching first line", () => {
  const file = "alpha\nbeta\ngamma\n";
  const patch = ["@@ -1,3 +1,3 @@", " alpha", "-nope", " gamma", "+yes"].join("\n");
  assert.throws(
    () => applyUnifiedDiff(file, patch),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /file line 2: "beta"/);
      assert.match(msg, /patch expected: "nope"/);
      assert.doesNotMatch(msg, /file line 1: "alpha"/);
      assert.doesNotMatch(msg, /write_file/);
      return true;
    },
  );
});

test("a failing hunk error still shows a later mismatch when the first 120 chars match", () => {
  const prefix = "x".repeat(120);
  const file = `${prefix}FILE_TAIL\n`;
  const patch = ["@@ -1,1 +1,1 @@", `-${prefix}PATCH_TAIL`, `+${prefix}NEW`].join("\n");
  assert.throws(
    () => applyUnifiedDiff(file, patch),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /FILE_TAIL/);
      assert.match(msg, /PATCH_TAIL/);
      assert.doesNotMatch(msg, /write_file/);
      return true;
    },
  );
});

test("a hunk-fail with an empty patch line says blank line not empty JSON", () => {
  assert.throws(
    () => applyUnifiedDiff("}\n", ["@@ -1,1 +1,1 @@", "-", "+x"].join("\n")),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /file line 1: "\}"/);
      assert.match(msg, /blank line/i);
      assert.doesNotMatch(msg, /patch expected: ""/);
      assert.doesNotMatch(msg, /write_file/);
      return true;
    },
  );
});

test("a hunk-fail whose first expected line exists elsewhere quotes that file line not the @@ position", () => {
  const file = [
    "- Writes and shell commands require user approval; they are staged until the user accepts.",
    "- Never invent file paths outside the workspace. Paths are relative to the workspace root.",
    "- Be concise. Show code in fenced blocks when helpful.",
  ].join("\n") + "\n";
  const patch = [
    "@@ -3,4 +3,4 @@",
    " - Writes and shell commands require user approval; they are staged until the user accepts.",
    " - Never invent file paths outside the workspace. Paths are relative to the workspace root.",
    " - Be concise. Show code in fenced blocks when helpful.",
    "-invented-context-not-in-file",
    "+- Never re-read the same whole file more than once",
  ].join("\n");
  assert.throws(
    () => applyUnifiedDiff(file, patch),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /first expected line at file line 1/);
      assert.match(msg, /invented-context-not-in-file/);
      assert.doesNotMatch(msg, /file line 3: "- Be concise/);
      assert.doesNotMatch(msg, /write_file/);
      return true;
    },
  );
});
