import assert from "node:assert/strict";
import test from "node:test";
import { receiptVerb } from "./receiptVerb.js";
import type { ActivityRecord } from "../projections/runReducer.js";

function record(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a1",
    invocationId: "i1",
    name: "read_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: null,
    output: null,
    error: null,
    diff: null,
    path: null,
    policy: {},
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    ...overrides,
  };
}

test("read: name matching /read/ maps to Read with the path as what", () => {
  const r = receiptVerb(record({ name: "read_file", path: "src/App.tsx" }));
  assert.equal(r.verb, "Read");
  assert.equal(r.what, "src/App.tsx");
  assert.equal(r.tone, "ok");
  assert.equal(r.tail, "");
});

test("list: name matching /list|ls|dir/ maps to Listed", () => {
  const r = receiptVerb(record({ name: "list_dir", path: "src/components" }));
  assert.equal(r.verb, "Listed");
  assert.equal(r.what, "src/components");
  assert.equal(r.tone, "ok");
});

test("grep: name matching /grep|search|find/ maps to Searched, what from input", () => {
  const r = receiptVerb(
    record({ name: "grep", input: { pattern: "TODO" }, path: null }),
  );
  assert.equal(r.verb, "Searched");
  assert.equal(r.what, "TODO");
  assert.equal(r.tone, "ok");
});

test("shell command with exit code: Ran, tail carries the real exit code", () => {
  const r = receiptVerb(
    record({
      name: "run_shell",
      command: "npx tsc -p tsconfig.json --noEmit",
      status: "failed",
      output: JSON.stringify({ exit_code: 2, stdout: "", stderr: "2 errors" }),
    }),
  );
  assert.equal(r.verb, "Ran");
  assert.equal(r.what, "npx tsc -p tsconfig.json --noEmit");
  assert.equal(r.tone, "fail");
  assert.equal(r.tail, "exit 2");
});

test("shell command clean: Ran, tail says clean without inventing a duration", () => {
  const r = receiptVerb(
    record({
      name: "run_shell",
      command: "npx tsc -p tsconfig.json --noEmit",
      status: "succeeded",
      output: JSON.stringify({ exit_code: 0, stdout: "", stderr: "" }),
    }),
  );
  assert.equal(r.verb, "Ran");
  assert.equal(r.tone, "ok");
  assert.equal(r.tail, "clean");
});

test("shell command succeeded with a non-zero exit code on record: tail reports the real code, not clean", () => {
  const r = receiptVerb(
    record({
      name: "run_shell",
      command: "npx eslint . --max-warnings 0",
      status: "succeeded",
      output: JSON.stringify({ exit_code: 1, stdout: "", stderr: "" }),
    }),
  );
  assert.equal(r.tone, "ok");
  assert.equal(r.tail, "exit 1");
});

test("W3-10: shell command succeeded with no exit code captured: tail is omitted, never guessed as clean", () => {
  const r = receiptVerb(
    record({
      name: "run_shell",
      command: "npx tsc -p tsconfig.json --noEmit",
      status: "succeeded",
      output: null,
    }),
  );
  assert.equal(r.tone, "ok");
  assert.equal(r.tail, "");
});

test("write with +/-: Edited, tail carries real added/removed counts from the diff", () => {
  const r = receiptVerb(
    record({
      name: "write_file",
      path: "src/OverviewStrip.tsx",
      diff: [
        "--- a/src/OverviewStrip.tsx",
        "+++ b/src/OverviewStrip.tsx",
        "@@ -1,3 +1,4 @@",
        "+line a",
        "+line b",
        "-old line",
        " context",
      ].join("\n"),
    }),
  );
  assert.equal(r.verb, "Edited");
  assert.equal(r.what, "src/OverviewStrip.tsx");
  assert.equal(r.tail, "+2 −1");
  assert.equal(r.tone, "ok");
});

test("write with no diff carried: tail is omitted rather than inventing counts", () => {
  const r = receiptVerb(record({ name: "write_file", path: "a.txt", diff: null }));
  assert.equal(r.verb, "Edited");
  assert.equal(r.tail, "");
});

test("vendor-unavailable: isForgeUnavailableVendorTool wins, Skipped with the exact tail", () => {
  const r = receiptVerb(
    record({ name: "get_command_or_subagent_output", status: "failed", execution: "executed" }),
  );
  assert.equal(r.verb, "Skipped");
  assert.equal(r.tail, "not available in Forge");
  assert.equal(r.tone, "muted");
});

test("pending decision: not-eligible + unresolved execution waits on you", () => {
  const r = receiptVerb(
    record({
      name: "run_shell",
      command: "npm test -- OverviewStrip",
      execution: null,
      status: "running",
      automaticEligibility: "not_eligible",
      autoApplied: false,
    }),
  );
  assert.equal(r.verb, "Waiting for you");
  assert.equal(r.what, "npm test -- OverviewStrip");
  assert.equal(r.tail, "needs approval");
  assert.equal(r.tone, "waiting");
});

test("generic: a name matching no pattern falls back to Did", () => {
  const r = receiptVerb(record({ name: "mystery_action", path: null, input: null, command: null }));
  assert.equal(r.verb, "Did");
  assert.equal(r.what, "mystery action");
  assert.equal(r.tone, "ok");
});

test("trusted class: automatic execution overrides the tail regardless of verb", () => {
  const r = receiptVerb(
    record({
      name: "run_shell",
      command: "npm test",
      execution: "executed",
      status: "succeeded",
      automaticEligibility: "trusted_command_class",
      autoApplied: true,
      output: JSON.stringify({ exit_code: 0 }),
    }),
  );
  assert.equal(r.verb, "Ran");
  assert.equal(r.tail, "trusted class · no prompt");
});

test("a raw command caption (generic tool name + real command) still reads as Ran", () => {
  const r = receiptVerb(
    record({
      name: "run_terminal_command",
      title: "Execute `node --test src/x.test.ts`",
      command: "Set-Location apps/shell; node --test src/x.test.ts",
    }),
  );
  assert.equal(r.verb, "Ran");
  assert.equal(r.what, "Set-Location apps/shell; node --test src/x.test.ts");
});

test("denied write is not Edited — not_executed write is muted with the real error", () => {
  // Live G6: Deny on fold.js still listed Activity as Edited even though disk
  // was unchanged and the turn said Write proposed (user denied).
  const r = receiptVerb(
    record({
      name: "write_file",
      path: "docs/dogfood/acp-code/g1-fold/fold.js",
      execution: "not_executed",
      status: "rejected",
      error: "User denied write permission",
      diff: "--- a/fold.js\n+++ b/fold.js\n+// G6-DENY\n",
    }),
  );
  assert.notEqual(r.verb, "Edited");
  assert.equal(r.verb, "Skipped");
  assert.equal(r.tone, "muted");
  assert.equal(r.tail, "User denied write permission");
});

test("rejected/not-run tool carries the real error as its tail, muted tone", () => {
  const r = receiptVerb(
    record({
      name: "read_file",
      path: "../../windows/win.ini",
      execution: "not_executed",
      status: "rejected",
      error: "Path escapes workspace",
    }),
  );
  assert.equal(r.verb, "Read");
  assert.equal(r.tone, "muted");
  assert.equal(r.tail, "Path escapes workspace");
});

test("still running (no result yet) is pending tone, not waiting", () => {
  const r = receiptVerb(
    record({
      name: "read_file",
      path: "notes.txt",
      lifecycle: "pending",
      execution: null,
      status: "running",
      automaticEligibility: "read",
    }),
  );
  assert.equal(r.verb, "Read");
  assert.equal(r.tone, "pending");
});
