import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingPermissionsFromRun,
  mergePendingPermissions,
  permissionChromeFromTitle,
  railEvidenceFromRun,
  hasDockOwnedPending,
  isStaleRailChip,
  settledRailIdentities,
} from "./runChangeList.js";
import type { RunProjectionRun } from "./runReducer.js";

function runWith(decisions: RunProjectionRun["decisions"], activities: RunProjectionRun["activities"] = {}): RunProjectionRun {
  return {
    sessionId: "s", runId: "r", connectionGeneration: 1, state: "waiting_for_decision",
    acceptedPrompt: "p", admittedAt: "", updatedAt: "", lastEventSeq: 1,
    policy: {}, model: {}, terminalKind: null, finalAnswer: null, answerVouched: false, failure: null,
    reasoning: {}, answer: {}, message: {}, activities, decisions, seenEventSeq: new Set([1]), terminalEventSeq: null,
  };
}

test("pendingPermissionsFromRun maps Run shell / Write file with detail pass-through", () => {
  const queue = pendingPermissionsFromRun(runWith({
    a: { requestId: "a", invocationId: "a", kind: "permission", status: "pending", title: "Run shell", detail: "echo hi", expiresAt: null, policy: {} },
    b: { requestId: "b", invocationId: "b", kind: "permission", status: "pending", title: "Write file", detail: "notes.md", expiresAt: null, policy: {} },
    c: { requestId: "c", invocationId: "c", kind: "permission", status: "accepted", title: "Run shell", detail: "gone", expiresAt: null, policy: {} },
    d: { requestId: "d", invocationId: "d", kind: "permission", status: "pending", title: "Approval needed", detail: "x", expiresAt: null, policy: {} },
  }));
  assert.deepEqual(queue.map((p) => ({ id: p.id, kind: p.kind, detail: p.detail })), [
    { id: "a", kind: "shell", detail: "echo hi" },
    { id: "b", kind: "write", detail: "notes.md" },
  ]);
  assert.equal(permissionChromeFromTitle("Run shell")?.rail, "Permission requested: shell");
  assert.equal(permissionChromeFromTitle("Write file")?.rail, "Permission requested: write");
  assert.equal(permissionChromeFromTitle("Approval needed"), null);
});

test("railEvidenceFromRun rebuilds permission + Diff proposed path from journal", () => {
  const evidence = railEvidenceFromRun(runWith(
    {
      p: { requestId: "p", invocationId: "inv-p", kind: "permission", status: "pending", title: "Run shell", detail: "cmd", expiresAt: null, policy: {} },
      d: { requestId: "d", invocationId: "inv-d", kind: "diff", status: "pending", title: "Edit file", detail: "a.txt", expiresAt: null, policy: {} },
    },
    {
      act: {
        activityId: "act", invocationId: "inv-d", name: "write_file", lifecycle: "pending",
        execution: null, status: "running", input: {}, output: null, error: null,
        diff: "@@", path: "a.txt", policy: {}, automaticEligibility: "text_edit",
        autoApplied: false, command: null, editId: "d", recovery: null,
      },
    },
  ));
  assert.ok(evidence.some((e) => e.content === "Permission requested: shell"));
  assert.ok(evidence.some((e) => e.content === "Diff proposed: a.txt"));
});

test("settled permission/diff rail chips drop after accept or terminal", () => {
  const pending = runWith({
    p: { requestId: "p", invocationId: "inv-p", kind: "permission", status: "pending", title: "Write file", detail: "x", expiresAt: null, policy: {} },
  });
  assert.equal(settledRailIdentities(pending).size, 0);
  const accepted = runWith({
    p: { requestId: "p", invocationId: "inv-p", kind: "permission", status: "accepted", title: "Write file", detail: "x", expiresAt: null, policy: {} },
  });
  const settled = settledRailIdentities(accepted);
  assert.ok(settled.has("permission:p"));
  assert.ok(settled.has("permission:inv-p"));
  const chip = { role: "system", content: "Permission requested: write", id: "perm-sys-p", activityIdentity: "permission:p" };
  assert.equal(isStaleRailChip(chip, settled), true);
  assert.equal(isStaleRailChip(chip, settledRailIdentities(pending)), false);
  const terminal = { ...pending, state: "terminal" as const, terminalKind: "answered" as const };
  assert.equal(isStaleRailChip(chip, settledRailIdentities(terminal)), true);
});

test("hasDockOwnedPending includes permission|diff|plan|recovery pending", () => {
  assert.equal(hasDockOwnedPending(runWith({
    x: { requestId: "x", invocationId: "x", kind: "plan", status: "pending", title: "Plan", detail: "", expiresAt: null, policy: {} },
  })), true);
});

test("mergePendingPermissions drops leftover cards once the run is terminal", () => {
  const live = runWith({
    a: { requestId: "a", invocationId: "a", kind: "permission", status: "pending", title: "Run shell", detail: "echo", expiresAt: null, policy: {} },
  });
  const prev = pendingPermissionsFromRun(live);
  assert.equal(prev.length, 1);
  const terminal = { ...live, state: "terminal" as const, terminalKind: "cancelled" as const };
  assert.deepEqual(mergePendingPermissions(prev, terminal).map((p) => p.id), []);
});

test("mergePendingPermissions does not wipe another run's pending cards", () => {
  const other = {
    id: "b",
    kind: "write" as const,
    detail: "notes.md",
    sessionId: "s",
    runId: "execute",
    invocationId: "b",
  };
  const plan = runWith({
    a: { requestId: "a", invocationId: "a", kind: "permission", status: "pending", title: "Run shell", detail: "echo", expiresAt: null, policy: {} },
  });
  const terminal = { ...plan, state: "terminal" as const, terminalKind: "answered" as const };
  const merged = mergePendingPermissions([other], terminal);
  assert.equal(merged.some((p) => p.id === "b" && p.runId === "execute"), true);
});

test("mergePendingPermissions drops settled and keeps durable pending", () => {
  const run = runWith({
    a: { requestId: "a", invocationId: "a", kind: "permission", status: "pending", title: "Run shell", detail: "echo", expiresAt: null, policy: {} },
  });
  const merged = mergePendingPermissions(
    [{ id: "stale", kind: "shell", detail: "old", sessionId: "s", runId: "r", invocationId: "stale" }],
    run,
  );
  assert.deepEqual(merged.map((p) => p.id), ["a"]);
  assert.equal(merged[0]!.detail, "echo");
});

test("unknown permission title is excluded from the card queue but still trips hasDockOwnedPending", () => {
  const run = runWith({
    d: { requestId: "d", invocationId: "d", kind: "permission", status: "pending", title: "Approval needed", detail: "x", expiresAt: null, policy: {} },
  });
  assert.deepEqual(pendingPermissionsFromRun(run), []);
  assert.equal(hasDockOwnedPending(run), true);
});

test("terminal leftover permission/diff does not block Send or keep a card", () => {
  const run = {
    ...runWith({
      p: { requestId: "p", invocationId: "p", kind: "permission", status: "pending", title: "Run shell", detail: "echo", expiresAt: null, policy: {} },
      d: { requestId: "d", invocationId: "d", kind: "diff", status: "pending", title: "Edit file", detail: "a.txt", expiresAt: null, policy: {} },
    }),
    state: "terminal" as const,
    terminalKind: "cancelled" as const,
  };
  assert.equal(hasDockOwnedPending(run), false);
  assert.deepEqual(pendingPermissionsFromRun(run), []);
});

test("terminal leftover plan still trips hasDockOwnedPending", () => {
  const run = {
    ...runWith({
      x: { requestId: "x", invocationId: "x", kind: "plan", status: "pending", title: "Plan", detail: "", expiresAt: null, policy: {} },
    }),
    state: "terminal" as const,
    terminalKind: "answered" as const,
  };
  assert.equal(hasDockOwnedPending(run), true);
});
