import test from "node:test";
import assert from "node:assert/strict";
import {
  activityRecordFromProposedEdit,
  activityRecordFromToolRun,
  retainActivityAfterDiff,
  retainActivityAfterRecovery,
} from "./session.js";

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

test("proposed edit reuses the tool-run activityId so Review Activity is one write", () => {
  const proposed = activityRecordFromProposedEdit({
    editId: "edit-dup",
    invocationId: "call-dup",
    path: "docs/dogfood/acp-code/hierarchy-probe.md",
    diff: "--- /dev/null\n+++ b/docs/dogfood/acp-code/hierarchy-probe.md\n+HIERARCHY-OK",
    policy,
  });
  assert.equal(proposed.editId, "edit-dup");
  assert.equal(proposed.invocationId, "call-dup");
  assert.equal(proposed.activityId, "call-dup");
  const terminal = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "call-dup",
      toolCallId: "call-dup",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      name: "write_file",
      input: { path: "docs/dogfood/acp-code/hierarchy-probe.md" },
      summary: null,
      command: null,
      output: JSON.stringify({ ok: true, path: "docs/dogfood/acp-code/hierarchy-probe.md" }),
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      automaticEligibility: "text_edit",
      autoApplied: false,
      editId: "edit-dup",
      diff: proposed.diff,
      path: "docs/dogfood/acp-code/hierarchy-probe.md",
      recovery: { kind: "guarded_revert", available: true, status: "available" },
    } as any,
    policy,
  );
  assert.equal(terminal.activityId, proposed.activityId);
  assert.equal(terminal.editId, proposed.editId);
});

test("retainActivityAfterDiff keeps proposed path, editId, and full diff on reject", () => {
  const prior = activityRecordFromProposedEdit({
    editId: "edit-keep",
    invocationId: "inv-keep",
    path: "keep.txt",
    diff: "--- a/keep.txt\n+++ b/keep.txt\n@@ -0,0 +1 @@\n+kept",
    policy,
  });
  const retained = retainActivityAfterDiff(prior, {
    editId: "edit-keep",
    invocationId: "inv-keep",
    action: "reject",
    policy,
  });
  assert.equal(retained.diff, prior.diff);
  assert.equal(retained.path, "keep.txt");
  assert.equal(retained.editId, "edit-keep");
  assert.equal(retained.status, "rejected");
});

test("retainActivityAfterDiff keeps proposed full diff on accept", () => {
  const prior = activityRecordFromProposedEdit({
    editId: "edit-acc",
    invocationId: "inv-acc",
    path: "acc.txt",
    diff: "--- a/acc.txt\n+++ b/acc.txt\n@@ -0,0 +1 @@\n+accepted",
    policy,
  });
  const retained = retainActivityAfterDiff(prior, {
    editId: "edit-acc",
    invocationId: "inv-acc",
    action: "accept",
    policy,
  });
  assert.equal(retained.diff, prior.diff);
  assert.equal(retained.path, "acc.txt");
  assert.equal(retained.editId, "edit-acc");
  assert.equal(retained.status, "succeeded");
});

test("retainActivityAfterDiff accept stamps guarded revert so Review offers Revert edit", () => {
  const prior = activityRecordFromProposedEdit({
    editId: "edit-rev",
    invocationId: "inv-rev",
    path: "docs/dogfood/acp-code/revert-probe.md",
    diff: "--- /dev/null\n+++ b/docs/dogfood/acp-code/revert-probe.md\n+REVERT-PROBE",
    policy,
  });
  assert.equal(prior.recovery, null);
  const retained = retainActivityAfterDiff(prior, {
    editId: "edit-rev",
    invocationId: "inv-rev",
    action: "accept",
    policy,
  });
  assert.equal(retained.recovery?.kind, "guarded_revert");
  assert.equal(retained.recovery?.available, true);
  assert.equal(retained.recovery?.status, "available");
});

test("retainActivityAfterDiff reject does not stamp revert", () => {
  const prior = activityRecordFromProposedEdit({
    editId: "edit-no",
    invocationId: "inv-no",
    path: "no.txt",
    diff: "+x",
    policy,
  });
  const retained = retainActivityAfterDiff(prior, {
    editId: "edit-no",
    invocationId: "inv-no",
    action: "reject",
    policy,
  });
  assert.equal(retained.recovery, null);
});

test("retainActivityAfterRecovery keeps path and diff when reverted", () => {
  const prior = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "a-rec",
      toolCallId: "inv-rec",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      name: "write_file",
      input: { path: "trusted.txt" },
      summary: null,
      command: null,
      output: "ok",
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      automaticEligibility: "text_edit",
      autoApplied: true,
      editId: "edit-rec",
      diff: "--- a/trusted.txt\n+++ b/trusted.txt\n+trusted",
      path: "trusted.txt",
      recovery: { kind: "guarded_revert", available: true, status: "available" },
    } as any,
    policy,
  );
  const retained = retainActivityAfterRecovery(prior, {
    editId: "edit-rec",
    status: "reverted",
    fallbackDiff: "--- a/trusted.txt\n+++ b/trusted.txt\n+other",
    policy,
  });
  assert.equal(retained.path, "trusted.txt");
  assert.equal(retained.diff, prior.diff);
  assert.equal(retained.recovery?.status, "reverted");
  assert.equal(retained.autoApplied, true);
});

test("retainActivityAfterRecovery keeps stored diff on conflict", () => {
  const prior = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "a-con",
      toolCallId: "inv-con",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      name: "write_file",
      input: { path: "c.txt" },
      summary: null,
      command: null,
      output: "ok",
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      automaticEligibility: "text_edit",
      autoApplied: true,
      editId: "edit-con",
      diff: "--- a/c.txt\n+++ b/c.txt\n+orig",
      path: "c.txt",
      recovery: { kind: "guarded_revert", available: true, status: "available" },
    } as any,
    policy,
  );
  const retained = retainActivityAfterRecovery(prior, {
    editId: "edit-con",
    status: "conflict",
    fallbackDiff: "--- a/c.txt\n+++ b/c.txt\n+orig",
    policy,
  });
  assert.equal(retained.path, "c.txt");
  assert.equal(retained.diff, prior.diff);
  assert.equal(retained.recovery?.status, "conflict");
});
