import test from "node:test";
import assert from "node:assert/strict";
import { compileFixedInspection } from "./inspection-grammar.js";

test("fixed inspection grammar rejects rg follow links and accepts the closed forms", () => {
 assert.deepEqual(compileFixedInspection("git status --short", "win32"), { executable:"git", args:["status","--short"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("git status --short -- packages/grok-acp/src/xai.no-reread.test.ts", "win32"), { executable:"git", args:["status","--short","--","packages/grok-acp/src/xai.no-reread.test.ts"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("git diff --stat -- src/index.ts", "win32"), { executable:"git", args:["diff","--stat","--","src/index.ts"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("git log -n 100 --oneline", "win32"), { executable:"git", args:["log","-n","100","--oneline"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("rg -n literal src", "win32"), { executable:"rg", args:["-n","literal","src"], label:"fixed_inspection" });
 for (const input of ["rg --files anything", "rg --files --follow", "rg --files -L", "git diff --name-only", "git log -n 101", "git status --porcelain=v2", "rg -n literal --follow"]) assert.equal(compileFixedInspection(input,"win32"), null, input);
});

test("git status --short -- two relative paths is fixed inspection (live 2026-09-10)", () => {
  const cmd =
    "git status --short -- packages/grok-acp/src/xai.ts packages/grok-acp/src/xai.no-reread.test.ts";
  assert.deepEqual(compileFixedInspection(cmd, "win32"), {
    executable: "git",
    args: [
      "status",
      "--short",
      "--",
      "packages/grok-acp/src/xai.ts",
      "packages/grok-acp/src/xai.no-reread.test.ts",
    ],
    label: "fixed_inspection",
  });
  assert.equal(
    compileFixedInspection("git status --short -- packages/a.ts ../escape.ts", "win32"),
    null,
  );
});

test("git status --short -- three relative paths is fixed inspection", () => {
  assert.deepEqual(
    compileFixedInspection("git status --short -- src/a.ts src/b.ts src/c.ts", "win32"),
    {
      executable: "git",
      args: ["status", "--short", "--", "src/a.ts", "src/b.ts", "src/c.ts"],
      label: "fixed_inspection",
    },
  );
});

test("git diff --stat -- two relative paths is fixed inspection", () => {
  assert.deepEqual(compileFixedInspection("git diff --stat -- src/a.ts src/b.ts", "win32"), {
    executable: "git",
    args: ["diff", "--stat", "--", "src/a.ts", "src/b.ts"],
    label: "fixed_inspection",
  });
});

test("git diff --stat -- three relative paths is fixed inspection", () => {
  assert.deepEqual(
    compileFixedInspection("git diff --stat -- src/a.ts src/b.ts src/c.ts", "win32"),
    {
      executable: "git",
      args: ["diff", "--stat", "--", "src/a.ts", "src/b.ts", "src/c.ts"],
      label: "fixed_inspection",
    },
  );
});
