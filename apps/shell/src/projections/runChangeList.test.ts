import test from "node:test";
import assert from "node:assert/strict";
import {
  initialRunProjection,
  mergeRunSnapshot,
  reduceRunEvent,
  type ActivityRecord,
  type DecisionRequest,
  type RunEventEnvelope,
  type RunProjectionRun,
  type RunSnapshot,
} from "./runReducer";
import {
  CATCHUP_LOAD_FAILURE,
  mergePendingDiffs,
  pendingDiffsFromRun,
  projectRunChangeList,
} from "./runChangeList";

const snap = (sessionId = "s1", runId = "r1"): RunSnapshot => ({
  sessionId,
  runId,
  connectionGeneration: 1,
  state: "admitted",
  acceptedPrompt: "prompt",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 0,
  policy: { mode: "review" },
  model: { model: "grok-4.6" },
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  failure: null,
});

const started = (s = snap(), seq = 1): RunEventEnvelope => ({
  schemaVersion: 1,
  type: "run_started",
  sessionId: s.sessionId,
  runId: s.runId,
  eventSeq: seq,
  connectionGeneration: s.connectionGeneration,
  occurredAt: "",
  payload: { kind: "run_started", run: s },
});

function event(
  payload: RunEventEnvelope["payload"],
  seq: number,
  sessionId = "s1",
  runId = "r1",
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId,
    runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

function activity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a1",
    invocationId: "i1",
    name: "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: "--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+hi",
    path: "x.ts",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e1",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function decision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "req-1",
    invocationId: "i1",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "x.ts",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

function runFrom(events: RunEventEnvelope[]): RunProjectionRun {
  let state = reduceRunEvent(initialRunProjection(), started());
  for (const ev of events) state = reduceRunEvent(state, ev);
  return state.runsById.r1;
}

function trustedThree(): RunProjectionRun {
  return runFrom([
    event({ kind: "activity_update", activity: activity({ activityId: "a1", invocationId: "i1", path: "a.txt", editId: "e1", diff: "--- a/a.txt\n+++ b/a.txt\n+A" }) }, 2),
    event({ kind: "activity_update", activity: activity({ activityId: "a2", invocationId: "i2", path: "b.txt", editId: "e2", diff: "--- a/b.txt\n+++ b/b.txt\n+B" }) }, 3),
    event({ kind: "activity_update", activity: activity({ activityId: "a3", invocationId: "i3", path: "c.txt", editId: "e3", diff: "--- a/c.txt\n+++ b/c.txt\n+C" }) }, 4),
  ]);
}

test("Trusted three-file → ready, three paths, all applied, none pending", () => {
  const projection = projectRunChangeList(trustedThree(), { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.deepEqual(projection.members.map((m) => m.path), ["a.txt", "b.txt", "c.txt"]);
  assert.ok(projection.members.every((m) => m.settlement === "applied"));
  assert.ok(projection.members.every((m) => m.requestId === null));
  assert.ok(projection.members.every((m) => m.recoveryAvailable === true));
});

test("Review two pending → ready, both pending, requestIds set", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1", detail: "r1.txt" }),
    }, 3),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a2",
        invocationId: "inv-r2",
        path: "r2.txt",
        editId: "edit-r2",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: "--- a/r2.txt\n+++ b/r2.txt\n+two",
      }),
    }, 4),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r2", invocationId: "inv-r2", detail: "r2.txt" }),
    }, 5),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.deepEqual(projection.members.map((m) => m.path), ["r1.txt", "r2.txt"]);
  assert.ok(projection.members.every((m) => m.settlement === "pending"));
  assert.deepEqual(projection.members.map((m) => m.requestId), ["req-r1", "req-r2"]);
  assert.ok(projection.members.every((m) => m.recoveryAvailable === false));
});

test("after reject decision + retained diff → member stays, settlement rejected, diff present", () => {
  const proposed = "--- a/r1.txt\n+++ b/r1.txt\n+one";
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: proposed,
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1", status: "declined" }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members.length, 1);
  assert.equal(projection.members[0].settlement, "rejected");
  assert.equal(projection.members[0].diff, proposed);
  assert.equal(projection.members[0].diffUnavailable, false);
  assert.equal(projection.members[0].editId, "edit-r1");
});

test("after accept → settlement accepted, diff present when body stored", () => {
  const proposed = "--- a/r1.txt\n+++ b/r1.txt\n+one";
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: proposed,
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1", status: "accepted" }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].settlement, "accepted");
  assert.equal(projection.members[0].diff, proposed);
});

test("accepted Review write still offers recovery when the activity says available", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1", status: "accepted" }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].settlement, "accepted");
  assert.equal(projection.members[0].recoveryAvailable, true);
});

test("recovery.status reverted wins over an accepted diff decision", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: { kind: "guarded_revert", available: true, status: "reverted" },
        diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1", status: "accepted" }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].settlement, "reverted");
  assert.equal(projection.members[0].recoveryAvailable, false);
});

test("missing diff on one of two members → ready mixed list, one diffUnavailable, not error", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "i1",
        path: "kept.ts",
        editId: "e1",
        diff: "--- a/kept.ts\n+++ b/kept.ts\n+ok",
      }),
    }, 2),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a2",
        invocationId: "i2",
        path: "missing.ts",
        editId: "e2",
        diff: null,
      }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members.length, 2);
  const kept = projection.members.find((m) => m.path === "kept.ts");
  const missing = projection.members.find((m) => m.path === "missing.ts");
  assert.equal(kept?.diffUnavailable, false);
  assert.equal(missing?.diffUnavailable, true);
  assert.equal(missing?.diff, null);
});

test("catch-up open → loading even if activities empty", () => {
  const run = runFrom([]);
  const projection = projectRunChangeList(run, { phase: "open" });
  assert.deepEqual(projection, { state: "loading" });
});

test("catch-up failed → error with load-failure message; not absent", () => {
  const run = runFrom([]);
  const projection = projectRunChangeList(run, { phase: "failed" });
  assert.equal(projection.state, "error");
  if (projection.state !== "error") return;
  assert.equal(projection.message, CATCHUP_LOAD_FAILURE);
});

test("catch-up closed + zero members → absent", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "read",
        invocationId: "read-1",
        name: "read_file",
        path: null,
        editId: null,
        diff: null,
        autoApplied: false,
        automaticEligibility: "read",
        recovery: null,
      }),
    }, 2),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("Bypass eligibility activity excluded", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "bypass",
        invocationId: "b1",
        path: "bypass.txt",
        editId: "e-bypass",
        automaticEligibility: "bypass",
        autoApplied: true,
      }),
    }, 2),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("read and shell activities excluded", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "read",
        invocationId: "read-1",
        name: "read_file",
        path: "README.md",
        editId: null,
        diff: null,
        autoApplied: false,
        automaticEligibility: "read",
        recovery: null,
      }),
    }, 2),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "shell",
        invocationId: "sh-1",
        name: "run_shell",
        path: null,
        editId: null,
        diff: null,
        autoApplied: true,
        automaticEligibility: "trusted_command_class",
        command: "npm test",
        recovery: null,
      }),
    }, 3),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("recovery.status reverted wins over autoApplied and recovery.available", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        recovery: { kind: "guarded_revert", available: true, status: "reverted" },
        autoApplied: true,
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].settlement, "reverted");
  assert.equal(projection.members[0].recoveryAvailable, false);
});

test("recovery.status conflict → conflict, no recoveryAvailable", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        recovery: { kind: "guarded_revert", available: true, status: "conflict" },
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].settlement, "conflict");
  assert.equal(projection.members[0].recoveryAvailable, false);
});

test("in-flight recovery.status pending → applied, recoveryAvailable false", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        recovery: { kind: "guarded_revert", available: true, status: "pending" },
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].settlement, "applied");
  assert.equal(projection.members[0].recoveryAvailable, false);
});

test("dedupe same editId updates settlement in place (one row)", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        editId: "e1",
        path: "x.ts",
        recovery: { kind: "guarded_revert", available: true, status: "available" },
      }),
    }, 2),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        editId: "e1",
        path: "x.ts",
        recovery: { kind: "guarded_revert", available: true, status: "reverted" },
      }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members.length, 1);
  assert.equal(projection.members[0].settlement, "reverted");
});

test("two runs’ activities never cross when fold is per-run", () => {
  let state = reduceRunEvent(initialRunProjection(), started(snap("s1", "r1")));
  state = reduceRunEvent(state, started(snap("s1", "r2"), 1));
  state = reduceRunEvent(
    state,
    event({
      kind: "activity_update",
      activity: activity({ activityId: "early", path: "early.ts", editId: "e-early" }),
    }, 2, "s1", "r1"),
  );
  state = reduceRunEvent(
    state,
    event({
      kind: "activity_update",
      activity: activity({ activityId: "late", path: "late.ts", editId: "e-late" }),
    }, 2, "s1", "r2"),
  );
  const early = projectRunChangeList(state.runsById.r1, { phase: "closed" });
  const late = projectRunChangeList(state.runsById.r2, { phase: "closed" });
  assert.equal(early.state, "ready");
  assert.equal(late.state, "ready");
  if (early.state !== "ready" || late.state !== "ready") return;
  assert.deepEqual(early.members.map((m) => m.path), ["early.ts"]);
  assert.deepEqual(late.members.map((m) => m.path), ["late.ts"]);
});

test("singleton Trusted edit is ready with one member, not absent", () => {
  const run = runFrom([
    event({ kind: "activity_update", activity: activity() }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members.length, 1);
  assert.equal(projection.members[0].path, "x.ts");
});

test("list open diff is the same string as the activity body for that editId", () => {
  const body = "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n line\n+added\n more";
  const run = runFrom([
    event({ kind: "activity_update", activity: activity({ diff: body, editId: "e1" }) }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].diff, run.activities.a1.diff);
  assert.equal(projection.members[0].diff, body);
});

test("pendingDiffsFromRun rebuilds dock queue from durable decision + activity, no live file_edit", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1" }),
    }, 3),
  ]);
  const queue = pendingDiffsFromRun(run);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, "req-r1");
  assert.equal(queue[0].path, "r1.txt");
  assert.equal(queue[0].diff, "--- a/r1.txt\n+++ b/r1.txt\n+one");
});

test("Trusted auto-applied never manufactures pending dock items", () => {
  assert.deepEqual(pendingDiffsFromRun(trustedThree()), []);
});

test("mergePendingDiffs prefers durable pending and drops settled live items", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "a1",
        invocationId: "inv-r1",
        path: "r1.txt",
        editId: "edit-r1",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-r1", invocationId: "inv-r1" }),
    }, 3),
  ]);
  const merged = mergePendingDiffs(
    [
      { id: "req-r1", path: "stale.txt", diff: "stale" },
      { id: "settled-old", path: "gone.ts", diff: "gone" },
    ],
    run,
  );
  assert.deepEqual(merged, [{ id: "req-r1", path: "r1.txt", diff: "--- a/r1.txt\n+++ b/r1.txt\n+one", runId: "r1" }]);
});

test("mergePendingDiffs does not wipe another run's pending diffs", () => {
  const executeDiff = { id: "exec-1", path: "ACP-A3.md", diff: "+comment", runId: "execute" };
  const plan = runFrom([]);
  assert.equal(plan.state === "terminal" || plan.runId === "r1", true);
  const merged = mergePendingDiffs([executeDiff], { ...plan, state: "terminal", terminalKind: "answered" });
  assert.equal(merged.some((d) => d.id === "exec-1" && d.runId === "execute"), true);
});

test("membership is identity not Boolean(diff) — empty-string body stays listed", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        path: "empty.ts",
        editId: "e-empty",
        diff: "",
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].diffUnavailable, true);
  assert.equal(projection.members[0].path, "empty.ts");
});

test("catch-up failed keeps error even when members exist (not mixed-list collapse)", () => {
  const projection = projectRunChangeList(trustedThree(), { phase: "failed", message: CATCHUP_LOAD_FAILURE });
  assert.equal(projection.state, "error");
});

test("mergeRunSnapshot lastEventSeq does not invent completeness for the fold", () => {
  const admitted = mergeRunSnapshot(initialRunProjection(), { ...snap(), lastEventSeq: 9 });
  const projection = projectRunChangeList(admitted.runsById.r1, { phase: "open" });
  assert.equal(projection.state, "loading");
});

test("Trusted delete with null diff is a Deleted member", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "delete_file",
        path: "gone.txt",
        editId: "e-del",
        kind: "delete",
        fromPath: null,
        toPath: null,
        diff: null,
        autoApplied: true,
        automaticEligibility: "text_edit",
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].kind, "delete");
  assert.equal(projection.members[0].diffUnavailable, true);
  assert.equal(projection.members[0].path, "gone.txt");
  assert.equal(projection.members[0].fromPath, null);
  assert.equal(projection.members[0].toPath, null);
  assert.equal(projection.members[0].diff, null);
  assert.equal(projection.members[0].settlement, "applied");
});

test("rename pending binds path to fromPath; applied uses toPath with pair", () => {
  const pendingRun = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "rename_file",
        path: "to.txt",
        editId: "e-ren",
        kind: "rename",
        fromPath: "from.txt",
        toPath: "to.txt",
        diff: null,
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-ren", invocationId: "i1", detail: "from.txt" }),
    }, 3),
  ]);
  const pending = projectRunChangeList(pendingRun, { phase: "closed" });
  assert.equal(pending.state, "ready");
  if (pending.state !== "ready") return;
  assert.equal(pending.members[0].kind, "rename");
  assert.equal(pending.members[0].path, "from.txt");
  assert.equal(pending.members[0].fromPath, "from.txt");
  assert.equal(pending.members[0].toPath, "to.txt");
  assert.equal(pending.members[0].settlement, "pending");
  assert.equal(pending.members[0].diffUnavailable, true);

  const appliedRun = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "rename_file",
        path: "to.txt",
        editId: "e-ren",
        kind: "rename",
        fromPath: "from.txt",
        toPath: "to.txt",
        diff: null,
        autoApplied: true,
        automaticEligibility: "text_edit",
      }),
    }, 2),
  ]);
  const applied = projectRunChangeList(appliedRun, { phase: "closed" });
  assert.equal(applied.state, "ready");
  if (applied.state !== "ready") return;
  assert.equal(applied.members[0].kind, "rename");
  assert.equal(applied.members[0].path, "to.txt");
  assert.equal(applied.members[0].fromPath, "from.txt");
  assert.equal(applied.members[0].toPath, "to.txt");
  assert.equal(applied.members[0].settlement, "applied");
});

test("rename without both path identities is not a member", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "rename_file",
        path: "from.txt",
        editId: "e-ren-partial",
        kind: "rename",
        fromPath: "from.txt",
        toPath: null,
        diff: null,
        autoApplied: true,
        automaticEligibility: "text_edit",
      }),
    }, 2),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("null kind shell-like activity is not a member even with path-ish fields", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "run_shell",
        path: "gone.txt",
        editId: "e-shell",
        kind: null,
        fromPath: null,
        toPath: null,
        diff: null,
        autoApplied: true,
        automaticEligibility: "trusted_command_class",
        command: "del gone.txt",
        recovery: null,
      }),
    }, 2),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("content without kind still members as content (legacy)", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        path: "legacy.ts",
        editId: "e-legacy",
        kind: undefined,
        fromPath: null,
        toPath: null,
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].kind, "content");
  assert.equal(projection.members[0].path, "legacy.ts");
});

test("delete_file tool name without vouched kind is not a Deleted member", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "delete_file",
        path: "gone.txt",
        editId: "e-name",
        kind: undefined,
        fromPath: null,
        toPath: null,
        autoApplied: true,
        automaticEligibility: "text_edit",
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].kind, "content");
  assert.notEqual(projection.members[0].kind, "delete");
});

test("Review deny/cancel without a staged diff decision mints no File changes member", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "delete_file",
        path: "gone.txt",
        editId: null,
        kind: null,
        diff: null,
        autoApplied: false,
        automaticEligibility: "not_eligible",
        execution: "not_executed",
        status: "rejected",
        recovery: null,
      }),
    }, 2),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("dock Reject of a staged pending rename keeps Rejected on fromPath", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "rename_file",
        path: "from.txt",
        editId: "e-ren",
        kind: "rename",
        fromPath: "from.txt",
        toPath: "to.txt",
        diff: null,
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-ren", invocationId: "i1", status: "declined" }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].kind, "rename");
  assert.equal(projection.members[0].settlement, "rejected");
  assert.equal(projection.members[0].path, "from.txt");
  assert.equal(projection.members[0].fromPath, "from.txt");
  assert.equal(projection.members[0].toPath, "to.txt");
});

test("recovery.status failed keeps applied without recoveryAvailable", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "delete_file",
        path: "gone.txt",
        editId: "e-del",
        kind: "delete",
        diff: null,
        recovery: { kind: "guarded_revert", available: false, status: "failed" },
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members[0].kind, "delete");
  assert.equal(projection.members[0].settlement, "applied");
  assert.equal(projection.members[0].recoveryAvailable, false);
});

test("pendingDiffsFromRun rename uses fromPath", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "rename_file",
        path: null,
        editId: "e-ren",
        kind: "rename",
        fromPath: "from.txt",
        toPath: "to.txt",
        diff: null,
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({ requestId: "req-ren", invocationId: "i1", detail: "from.txt" }),
    }, 3),
  ]);
  const diffs = pendingDiffsFromRun(run);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, "from.txt");
  assert.equal(diffs[0].id, "req-ren");
});

test("delete-only run with null diff is ready, not absent", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "delete_file",
        path: "only-del.txt",
        editId: "e-only",
        kind: "delete",
        diff: null,
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members.length, 1);
  assert.equal(projection.members[0].kind, "delete");
  assert.equal(projection.members[0].diffUnavailable, true);
});

test("Review Allow-for-this-session later write still appears in Changes (G1 fold.test.js)", () => {
  // Live dogfood: tokenize.js had Write-file Allow + Changes Accept; fold.js
  // had Allow for this session (permission exists); fold.test.js was
  // session-granted — no permission, no diff decision, autoApplied false —
  // and vanished from the inspector while landing on disk.
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "tok",
        invocationId: "inv-tok",
        path: "docs/dogfood/acp-code/g1-fold/tokenize.js",
        editId: "edit-tok",
        kind: "content",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- /dev/null\n+++ b/tokenize.js\n+export",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({
        requestId: "diff-tok",
        invocationId: "inv-tok",
        kind: "diff",
        status: "accepted",
        detail: "docs/dogfood/acp-code/g1-fold/tokenize.js",
      }),
    }, 3),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "fold",
        invocationId: "inv-fold",
        path: "docs/dogfood/acp-code/g1-fold/fold.js",
        editId: "edit-fold",
        kind: "content",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- /dev/null\n+++ b/fold.js\n+export",
      }),
    }, 4),
    event({
      kind: "decision_request",
      request: decision({
        requestId: "perm-fold",
        invocationId: "inv-fold",
        kind: "permission",
        status: "accepted",
        title: "Write file",
        detail: "Write: docs/dogfood/acp-code/g1-fold/fold.js",
      }),
    }, 5),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "test",
        invocationId: "inv-test",
        path: "docs/dogfood/acp-code/g1-fold/fold.test.js",
        editId: "edit-test",
        kind: "content",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- /dev/null\n+++ b/fold.test.js\n+test",
      }),
    }, 6),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.deepEqual(
    projection.members.map((m) => m.path),
    [
      "docs/dogfood/acp-code/g1-fold/tokenize.js",
      "docs/dogfood/acp-code/g1-fold/fold.js",
      "docs/dogfood/acp-code/g1-fold/fold.test.js",
    ],
  );
});

test("vendor session plan.md write is still not a Changes member", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        name: "write",
        path: "C:\\Users\\rodri\\.grok\\sessions\\sid\\plan.md",
        editId: "e-plan",
        kind: "content",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        recovery: null,
        diff: "--- /dev/null\n+++ b/plan.md\n+# Plan\n",
      }),
    }, 2),
  ]);
  assert.deepEqual(projectRunChangeList(run, { phase: "closed" }), { state: "absent" });
});

test("Review Allow once on vendor Write file becomes a File changes member", () => {
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "w1",
        invocationId: "tc-write",
        name: "Write file",
        path: "C:\\\\Dev\\\\grokforge\\\\docs\\\\dogfood\\\\LOOP.md",
        editId: "tc-write",
        kind: "content",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        diff: null,
        recovery: null,
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({
        requestId: "perm-w",
        invocationId: "tc-write",
        kind: "permission",
        status: "accepted",
        title: "Write file",
        detail: "docs/dogfood/LOOP.md",
      }),
    }, 3),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(projection.members.length, 1);
  assert.equal(projection.members[0].settlement, "accepted");
  assert.match(projection.members[0].path, /LOOP\.md$/);
});

test("Review session-grant later write shares the Accepted chip with the Allow-for-this-session row (G12)", () => {
  // Live G12: first write clicked Allow for this session (Write file accepted);
  // g12-span.test.js auto-landed with no per-file decision and painted Applied.
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "span",
        invocationId: "inv-span",
        path: "docs/dogfood/acp-code/g1-fold/g12-span.js",
        editId: "edit-span",
        kind: "content",
        autoApplied: false,
        automaticEligibility: "not_eligible",
        policy: { effectiveMode: "review" },
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- /dev/null\n+++ b/g12-span.js\n+export",
      }),
    }, 2),
    event({
      kind: "decision_request",
      request: decision({
        requestId: "perm-span",
        invocationId: "inv-span",
        kind: "permission",
        status: "accepted",
        title: "Write file",
        detail: "Write: docs/dogfood/acp-code/g1-fold/g12-span.js",
      }),
    }, 3),
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "span-test",
        invocationId: "inv-span-test",
        path: "docs/dogfood/acp-code/g1-fold/g12-span.test.js",
        editId: "edit-span-test",
        kind: "content",
        autoApplied: true,
        automaticEligibility: "text_edit",
        policy: { effectiveMode: "review" },
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- /dev/null\n+++ b/g12-span.test.js\n+test",
      }),
    }, 4),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.deepEqual(
    projection.members.map((m) => [m.path.split("/").pop(), m.settlement]),
    [
      ["g12-span.js", "accepted"],
      ["g12-span.test.js", "accepted"],
    ],
    "live Changes mixed Accepted + Applied after Allow for this session",
  );
});

test("follow-up session-grant write on a later run is Accepted not Applied", () => {
  // Live G12 follow-up: ACP sessionWrite auto-landed g12-span.test.js on a
  // new run with no Write-file decision, so session Changes mixed Accepted
  // (prior run) + Applied (this run) after collapse-by-path.
  const run = runFrom([
    event({
      kind: "activity_update",
      activity: activity({
        activityId: "fu",
        invocationId: "inv-fu",
        path: "docs/dogfood/acp-code/g1-fold/g12-span.test.js",
        editId: "edit-fu",
        kind: "content",
        autoApplied: true,
        automaticEligibility: "text_edit",
        policy: { effectiveMode: "review" },
        recovery: { kind: "guarded_revert", available: true, status: "available" },
        diff: "--- a/g12-span.test.js\n+++ b/g12-span.test.js\n+assert.equal(span(10, 0), -10)",
      }),
    }, 2),
  ]);
  const projection = projectRunChangeList(run, { phase: "closed" });
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.equal(
    projection.members[0]!.settlement,
    "accepted",
    "follow-up session-grant row painted Applied beside the prior Accepted path",
  );
});
