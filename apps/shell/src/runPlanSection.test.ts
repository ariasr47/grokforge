import test from "node:test";
import assert from "node:assert/strict";
import type {
  DecisionRequest,
  PlanRecord,
  RunProjectionRun,
  RunSnapshot,
} from "./runReducer";
import {
  PLAN_LOAD_FAILURE,
  isLivePlanning,
  projectRunPlanSection,
} from "./runPlanSection";

const snapshot: RunSnapshot = {
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "plan this",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 2,
  policy: { effectiveMode: "review" },
  model: { id: "grok-4.6" },
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  failure: null,
  executionPhase: "plan",
};

function run(overrides: Partial<RunProjectionRun> = {}): RunProjectionRun {
  return {
    ...snapshot,
    reasoning: {},
    answer: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: null,
    plan: null,
    ...overrides,
  };
}

function planRecord(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    runId: "r1",
    sessionId: "s1",
    connectionGeneration: 1,
    status: "exploring",
    body: null,
    proposedMembers: [],
    policy: { effectiveMode: "review" },
    executionPhase: "plan",
    ...overrides,
  };
}

function planDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "plan-req",
    invocationId: "plan-inv",
    kind: "plan",
    status: "pending",
    title: "Review plan",
    detail: "",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

test("catch-up open → loading with Restoring intent (never exploring)", () => {
  const projected = projectRunPlanSection(
    run({ plan: planRecord({ status: "exploring" }) }),
    { phase: "open" },
  );
  assert.equal(projected.state, "loading");
});

test("catch-up failed → error", () => {
  const projected = projectRunPlanSection(run(), { phase: "failed" });
  assert.equal(projected.state, "error");
  if (projected.state === "error") {
    assert.equal(projected.message, PLAN_LOAD_FAILURE);
  }
});

test("exploring plan_record → exploring", () => {
  const projected = projectRunPlanSection(
    run({ plan: planRecord({ status: "exploring" }) }),
    { phase: "closed" },
  );
  assert.equal(projected.state, "exploring");
});

test("ready non-empty / ready empty (empty true iff length 0)", () => {
  const nonEmpty = projectRunPlanSection(
    run({
      plan: planRecord({
        status: "ready",
        body: "Would change two files",
        proposedMembers: [
          { path: "src/a.ts", summary: "Update helper" },
          { path: "src/b.ts", summary: "Create UI" },
        ],
      }),
      decisions: { "plan-req": planDecision() },
    }),
    { phase: "closed" },
  );
  assert.equal(nonEmpty.state, "ready");
  if (nonEmpty.state === "ready") {
    assert.equal(nonEmpty.empty, false);
    assert.equal(nonEmpty.proposedMembers.length, 2);
    assert.equal(nonEmpty.decisionPending, true);
  }

  const empty = projectRunPlanSection(
    run({
      plan: planRecord({ status: "ready", body: "Nothing to change.", proposedMembers: [] }),
    }),
    { phase: "closed" },
  );
  assert.equal(empty.state, "ready");
  if (empty.state === "ready") {
    assert.equal(empty.empty, true);
    assert.equal(empty.proposedMembers.length, 0);
  }
});

test("accepted / kept_planning / cancelled / failed / superseded", () => {
  assert.equal(
    projectRunPlanSection(run({ plan: planRecord({ status: "accepted" }) }), { phase: "closed" }).state,
    "accepted",
  );
  const accepted = projectRunPlanSection(
    run({ plan: planRecord({ status: "accepted", policy: { effectiveMode: "trusted_workspace" } }) }),
    { phase: "closed" },
    { bypassActive: true },
  );
  assert.equal(accepted.state, "accepted");
  if (accepted.state === "accepted") {
    assert.equal(accepted.policyLabel, "Trusted workspace");
    assert.equal(accepted.bypassActive, true);
  }
  assert.equal(
    projectRunPlanSection(run({ plan: planRecord({ status: "kept_planning" }) }), { phase: "closed" }).state,
    "kept_planning",
  );
  assert.equal(
    projectRunPlanSection(run({ plan: planRecord({ status: "cancelled" }) }), { phase: "closed" }).state,
    "cancelled",
  );
  assert.equal(
    projectRunPlanSection(run({ plan: planRecord({ status: "failed" }) }), { phase: "closed" }).state,
    "failed",
  );
  assert.equal(
    projectRunPlanSection(run({ plan: planRecord({ status: "superseded" }) }), { phase: "closed" }).state,
    "superseded",
  );
});

test("absent when no plan_record and not plan-phase live", () => {
  assert.equal(
    projectRunPlanSection(
      run({ executionPhase: "execute", plan: null, state: "running" }),
      { phase: "closed" },
    ).state,
    "absent",
  );
  assert.equal(
    projectRunPlanSection(
      run({ executionPhase: "plan", plan: null, state: "terminal" }),
      { phase: "closed" },
    ).state,
    "absent",
  );
  assert.equal(
    projectRunPlanSection(
      run({ executionPhase: "plan", plan: null, state: "running" }),
      { phase: "closed" },
    ).state,
    "exploring",
  );
});

test("offline with preserved proposal", () => {
  const projected = projectRunPlanSection(
    run({
      plan: planRecord({
        status: "ready",
        proposedMembers: [{ path: "src/a.ts", summary: "Update" }],
      }),
    }),
    { phase: "closed" },
    { connected: false },
  );
  assert.equal(projected.state, "offline");
});

test("forbidden: ready && empty:false && proposedMembers.length===0 cannot be produced", () => {
  const projected = projectRunPlanSection(
    run({ plan: planRecord({ status: "ready", proposedMembers: [] }) }),
    { phase: "closed" },
  );
  assert.equal(projected.state, "ready");
  if (projected.state === "ready") {
    assert.equal(projected.empty, true);
    assert.notEqual(projected.empty === false && projected.proposedMembers.length === 0, true);
  }
});

test("isLivePlanning only when executionPhase === plan and non-terminal", () => {
  assert.equal(isLivePlanning(run({ executionPhase: "plan", state: "running" })), true);
  assert.equal(isLivePlanning(run({ executionPhase: "execute", state: "running" })), false);
  assert.equal(isLivePlanning(run({ executionPhase: "plan", state: "terminal" })), false);
  assert.equal(isLivePlanning(run({ executionPhase: undefined, state: "running" })), false);
});
