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
  assert.deepEqual(merged, [{ id: "req-r1", path: "r1.txt", diff: "--- a/r1.txt\n+++ b/r1.txt\n+one" }]);
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
