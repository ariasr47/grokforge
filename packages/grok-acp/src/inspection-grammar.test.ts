import test from "node:test";
import assert from "node:assert/strict";
import { compileFixedInspection } from "./inspection-grammar.js";

test("fixed inspection grammar rejects rg follow links and accepts the closed forms", () => {
 assert.deepEqual(compileFixedInspection("git status --short", "win32"), { executable:"git", args:["status","--short"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("git diff --stat -- src/index.ts", "win32"), { executable:"git", args:["diff","--stat","--","src/index.ts"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("git log -n 100 --oneline", "win32"), { executable:"git", args:["log","-n","100","--oneline"], label:"fixed_inspection" });
 assert.deepEqual(compileFixedInspection("rg -n literal src", "win32"), { executable:"rg", args:["-n","literal","src"], label:"fixed_inspection" });
 for (const input of ["rg --files anything", "rg --files --follow", "rg --files -L", "git diff --name-only", "git log -n 101", "git status --porcelain=v2", "rg -n literal --follow"]) assert.equal(compileFixedInspection(input,"win32"), null, input);
});
