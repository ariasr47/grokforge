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

test("activityRecordFromToolRun journals delete kind with null diff", () => {
  const activity = activityRecordFromToolRun({
    type: "tool_run",
    schemaVersion: 2,
    activityId: "a-del",
    toolCallId: "inv-del",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    name: "delete_file",
    input: { path: "gone.txt" },
    summary: null,
    command: null,
    output: JSON.stringify({ ok: true, path: "gone.txt" }),
    error: null,
    reasonCode: null,
    reason: null,
    shellDisplayName: null,
    detailAvailable: true,
    automaticEligibility: "text_edit",
    autoApplied: true,
    editId: "e-del",
    path: "gone.txt",
    kind: "delete",
    diff: null,
    recovery: { kind: "guarded_revert", available: true, status: "available" },
  } as any, policy);
  assert.equal(activity.kind, "delete");
  assert.equal(activity.path, "gone.txt");
  assert.equal(activity.diff, null);
  assert.equal(activity.editId, "e-del");
  assert.equal(activity.fromPath, null);
  assert.equal(activity.toPath, null);
});

test("activityRecordFromProposedEdit accepts rename with null diff", () => {
  const activity = activityRecordFromProposedEdit({
    editId: "e-ren",
    invocationId: "inv",
    path: "from.txt",
    diff: null,
    kind: "rename",
    fromPath: "from.txt",
    toPath: "to.txt",
    name: "rename_file",
    policy,
  });
  assert.equal(activity.kind, "rename");
  assert.equal(activity.fromPath, "from.txt");
  assert.equal(activity.toPath, "to.txt");
  assert.equal(activity.path, "from.txt");
  assert.equal(activity.diff, null);
  assert.equal(activity.name, "rename_file");
});

test("retainActivityAfterDiff accept rename rebinds path to toPath", () => {
  const prior = activityRecordFromProposedEdit({
    editId: "e-ren",
    invocationId: "inv",
    path: "from.txt",
    diff: null,
    kind: "rename",
    fromPath: "from.txt",
    toPath: "to.txt",
    name: "rename_file",
    policy,
  });
  const settled = retainActivityAfterDiff(prior, {
    editId: prior.editId!,
    invocationId: prior.invocationId,
    action: "accept",
    policy,
  });
  assert.equal(settled.path, "to.txt");
  assert.equal(settled.kind, "rename");
  assert.equal(settled.fromPath, "from.txt");
  assert.equal(settled.toPath, "to.txt");
});

test("retainActivityAfterRecovery rename revert rebinds path to fromPath", () => {
  const prior = activityRecordFromToolRun({
    type: "tool_run",
    schemaVersion: 2,
    activityId: "a-ren",
    toolCallId: "inv-ren",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    name: "rename_file",
    input: { fromPath: "from.txt", toPath: "to.txt" },
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
    editId: "e-ren",
    path: "to.txt",
    kind: "rename",
    fromPath: "from.txt",
    toPath: "to.txt",
    diff: null,
    recovery: { kind: "guarded_revert", available: true, status: "available" },
  } as any, policy);
  const retained = retainActivityAfterRecovery(prior, {
    editId: "e-ren",
    status: "reverted",
    fallbackDiff: null,
    policy,
  });
  assert.equal(retained.path, "from.txt");
  assert.equal(retained.kind, "rename");
  assert.equal(retained.fromPath, "from.txt");
  assert.equal(retained.toPath, "to.txt");
  assert.equal(retained.recovery?.status, "reverted");
});
