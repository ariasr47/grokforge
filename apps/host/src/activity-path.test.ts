import test from "node:test";
import assert from "node:assert/strict";
import { activityRecordFromProposedEdit, activityRecordFromToolRun } from "./session.js";

const policy = {
  workspace: "w",
  storedMode: "trusted_workspace" as const,
  effectiveMode: "trusted_workspace" as const,
  source: "saved" as const,
  revision: "r1",
  fallbackReason: null,
  snapshottedAt: new Date().toISOString(),
};

test("activityRecordFromToolRun co-locates path with diff and editId", () => {
  const activity = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "a1",
      toolCallId: "inv-1",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      name: "write_file",
      input: { path: "src/a.ts", content: "x" },
      summary: null,
      command: null,
      output: JSON.stringify({ ok: true, path: "src/a.ts" }),
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      automaticEligibility: "text_edit",
      autoApplied: true,
      editId: "edit-1",
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+x",
      path: "src/a.ts",
      recovery: { kind: "guarded_revert", available: true, status: "available" },
    } as any,
    policy,
  );
  assert.equal(activity.path, "src/a.ts");
  assert.equal(activity.editId, "edit-1");
  assert.ok(activity.diff && activity.diff.includes("+x"));
});

test("non-edit tools keep path null", () => {
  const activity = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "a2",
      toolCallId: "inv-2",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      name: "read_file",
      input: { path: "README.md" },
      summary: null,
      command: null,
      output: "ok",
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      automaticEligibility: "read",
      autoApplied: false,
      editId: null,
      diff: null,
    } as any,
    policy,
  );
  assert.equal(activity.path, null);
  assert.equal(activity.editId, null);
});

test("activityRecordFromProposedEdit journals path, full diff, and editId", () => {
  const activity = activityRecordFromProposedEdit({
    editId: "edit-r1",
    invocationId: "inv-r1",
    path: "r1.txt",
    diff: "--- a/r1.txt\n+++ b/r1.txt\n@@ -0,0 +1 @@\n+one",
    policy,
  });
  assert.equal(activity.path, "r1.txt");
  assert.equal(activity.editId, "edit-r1");
  assert.equal(activity.invocationId, "inv-r1");
  assert.equal(activity.lifecycle, "pending");
  assert.equal(activity.autoApplied, false);
  assert.ok(activity.diff && activity.diff.includes("+one"));
});
