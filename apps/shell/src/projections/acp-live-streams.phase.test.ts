import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composerFooterPhaseText,
  deriveLivePhase,
  deriveLivePhaseFromRun,
  phaseCopy,
  statusBarPhaseText,
} from "./derivedLivePhase.js";
import {
  initialRunProjection,
  reduceRunEvent,
  type ActivityRecord,
  type RunEventEnvelope,
  type RunProjectionRun,
  type RunSnapshot,
} from "./runReducer.js";

const snap = (overrides: Partial<RunSnapshot> = {}): RunSnapshot => ({
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
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
  ...overrides,
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

function event(payload: RunEventEnvelope["payload"], seq: number): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: "s1",
    runId: "r1",
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

function pendingRead(): ActivityRecord {
  return {
    activityId: "read-1",
    invocationId: "read-1",
    name: "read_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "notes.md" },
    output: null,
    error: null,
    diff: null,
    path: "notes.md",
    policy: {},
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    summary: "Read notes.md",
    title: "Reading notes.md",
  };
}

function terminalRead(): ActivityRecord {
  return { ...pendingRead(), lifecycle: "terminal", execution: "executed", status: "succeeded", output: "hello" };
}

describe("bar and footer share one DerivedLivePhase", () => {
  it("Plan-owned: status Planning and footer Plan · no edits applied", () => {
    const d = deriveLivePhase({
      terminal: false,
      ownedBusy: true,
      liveness: "provider",
      planOwned: true,
      pendingTool: null,
      lastContentKind: "thought",
      decisionPending: false,
    });
    assert.equal(d.kind, "plan");
    assert.equal(statusBarPhaseText(d), "Planning");
    assert.equal(composerFooterPhaseText(d), "Plan · no edits applied");
    assert.equal(phaseCopy(d).status, "Planning");
    assert.equal(phaseCopy(d).footer, "Plan · no edits applied");
  });

  it("provider_wait: bar and footer both Waiting for model…", () => {
    const d = deriveLivePhase({
      terminal: false,
      ownedBusy: true,
      liveness: "provider",
      planOwned: false,
      pendingTool: null,
      lastContentKind: null,
      decisionPending: false,
    });
    assert.equal(statusBarPhaseText(d), "Waiting for model…");
    assert.equal(composerFooterPhaseText(d), "Waiting for model…");
  });

  it("retired lying strings are absent from phase copy", () => {
    const kinds: Parameters<typeof deriveLivePhase>[0][] = [
      { terminal: false, ownedBusy: true, liveness: "provider", planOwned: false, pendingTool: null, lastContentKind: null, decisionPending: false },
      { terminal: false, ownedBusy: true, liveness: "provider", planOwned: false, pendingTool: null, lastContentKind: "thought", decisionPending: false },
      { terminal: false, ownedBusy: true, liveness: "provider", planOwned: false, pendingTool: null, lastContentKind: "message", decisionPending: false },
      { terminal: false, ownedBusy: true, liveness: "tool", planOwned: false, pendingTool: { title: null, summary: null, name: null }, lastContentKind: "tool", decisionPending: false },
      { terminal: false, ownedBusy: true, liveness: "provider", planOwned: true, pendingTool: null, lastContentKind: null, decisionPending: false },
    ];
    const banned = /Awaiting presence|Thinking field|Tools in orbit|Shaping answer|Writing answer/;
    for (const input of kinds) {
      const copy = phaseCopy(deriveLivePhase(input));
      assert.equal(banned.test(copy.status ?? ""), false, copy.status ?? "");
      assert.equal(banned.test(copy.footer ?? ""), false, copy.footer ?? "");
    }
  });
});

describe("phase leftover adversaries from journal apply", () => {
  it("in-flight tool displaces waiting/presence and Plan", () => {
    let a = reduceRunEvent(initialRunProjection(), started({ ...snap(), executionPhase: "plan" }));
    a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "think" }, 2));
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "mid" }, 3));
    a = reduceRunEvent(a, event({ kind: "activity_update", activity: pendingRead() }, 4));
    a = reduceRunEvent(a, event({ kind: "run_state", state: "running", liveness: "tool" }, 5));
    const d = deriveLivePhaseFromRun(a.runsById.r1);
    assert.equal(d.kind, "tool");
    assert.equal(phaseCopy(d).status, "Reading notes.md");
    assert.notEqual(phaseCopy(d).status, "Planning");
    assert.notEqual(phaseCopy(d).status, "Waiting for model…");
  });

  it("decision wait demotes leftover Writing…/Thinking… (AC 6)", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "think" }, 2));
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "I will edit." }, 3));
    a = reduceRunEvent(a, event({
      kind: "decision_request",
      request: {
        requestId: "p1", invocationId: "p1", kind: "permission", status: "pending",
        title: "Run shell", detail: "echo", expiresAt: null, policy: {},
      },
    }, 4));
    a = reduceRunEvent(a, event({ kind: "run_state", state: "waiting_for_decision", liveness: "decision" }, 5));
    const d = deriveLivePhaseFromRun(a.runsById.r1);
    assert.equal(d.kind, "decision");
    assert.notEqual(phaseCopy(d).status, "Writing…");
    assert.notEqual(phaseCopy(d).status, "Thinking…");
    assert.notEqual(phaseCopy(d).status, "Reading notes.md");
  });

  it("post-tool provider handoff beats leftover kinds and tool title (AC 7)", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "considering" }, 2));
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "I will read the file." }, 3));
    a = reduceRunEvent(a, event({ kind: "activity_update", activity: pendingRead() }, 4));
    a = reduceRunEvent(a, event({ kind: "activity_update", activity: terminalRead() }, 5));
    a = reduceRunEvent(a, event({ kind: "run_state", state: "running", liveness: "provider" }, 6));
    const run = a.runsById.r1 as RunProjectionRun;
    assert.equal(run.postToolProviderWait, true);
    assert.equal(run.lastContentKind, "tool");
    const d = deriveLivePhaseFromRun(run);
    assert.equal(d.kind, "provider_wait");
    assert.equal(phaseCopy(d).status, "Waiting for model…");
    assert.notEqual(phaseCopy(d).status, "Writing…");
    assert.notEqual(phaseCopy(d).status, "Thinking…");
    assert.notEqual(phaseCopy(d).status, "Reading notes.md");
  });

  it("execution_owner_lost terminal clears Writing… and is not Answered", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "partial words" }, 2));
    assert.equal(phaseCopy(deriveLivePhaseFromRun(a.runsById.r1)).status, "Writing…");
    a = reduceRunEvent(a, event({
      kind: "run_terminal",
      terminalKind: "failed",
      finalAnswer: null,
      answerVouched: false,
      failure: { code: "execution_owner_lost", message: "Owner lost", retryable: true, recoveryAction: "reconnect" },
      terminalAt: "",
    }, 3));
    const d = deriveLivePhaseFromRun(a.runsById.r1);
    assert.equal(d.kind, "clear");
    assert.equal(phaseCopy(d).status, null);
    assert.notEqual(phaseCopy(d).status, "Writing…");
    assert.equal(a.runsById.r1.terminalKind, "failed");
    assert.equal(a.runsById.r1.answerVouched, false);
    assert.equal(a.runsById.r1.finalAnswer, null);
  });
});
