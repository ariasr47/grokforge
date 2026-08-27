import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveLivePhaseFromRun, phaseCopy } from "./derivedLivePhase.js";
import {
  initialRunProjection,
  persistableRunProjection,
  reduceRunEvent,
  restoreRunProjection,
  type ActivityRecord,
  type RunEventEnvelope,
  type RunSnapshot,
} from "./runReducer.js";

const snap = (): RunSnapshot => ({
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "do the work",
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

const started = (): RunEventEnvelope => ({
  schemaVersion: 1,
  type: "run_started",
  sessionId: "s1",
  runId: "r1",
  eventSeq: 1,
  connectionGeneration: 1,
  occurredAt: "",
  payload: { kind: "run_started", run: snap() },
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

function tool(lifecycle: "pending" | "terminal"): ActivityRecord {
  return {
    activityId: "read-1",
    invocationId: "read-1",
    name: "read_file",
    lifecycle,
    execution: lifecycle === "terminal" ? "executed" : null,
    status: lifecycle === "terminal" ? "succeeded" : "running",
    input: { path: "notes.md" },
    output: lifecycle === "terminal" ? "hello" : null,
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

describe("reachable-state four-store replay", () => {
  it("thought → message_delta → tool → provider wait → CAS-copied answer stay distinct", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "considering" }, 2));
    assert.equal(phaseCopy(deriveLivePhaseFromRun(a.runsById.r1)).status, "Thinking…");

    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "I will read the file." }, 3));
    assert.equal(phaseCopy(deriveLivePhaseFromRun(a.runsById.r1)).status, "Writing…");
    assert.equal(a.runsById.r1.reasoning.r, "considering");
    assert.equal(a.runsById.r1.message.m, "I will read the file.");
    assert.deepEqual(a.runsById.r1.answer, {});

    a = reduceRunEvent(a, event({ kind: "activity_update", activity: tool("pending") }, 4));
    a = reduceRunEvent(a, event({ kind: "run_state", state: "running", liveness: "tool" }, 5));
    assert.equal(phaseCopy(deriveLivePhaseFromRun(a.runsById.r1)).status, "Reading notes.md");

    a = reduceRunEvent(a, event({ kind: "activity_update", activity: tool("terminal") }, 6));
    a = reduceRunEvent(a, event({ kind: "run_state", state: "running", liveness: "provider" }, 7));
    assert.equal(phaseCopy(deriveLivePhaseFromRun(a.runsById.r1)).status, "Waiting for model…");

    a = reduceRunEvent(a, event({
      kind: "message_delta",
      segmentId: "m",
      delta: " Done.",
    }, 8));
    assert.equal(phaseCopy(deriveLivePhaseFromRun(a.runsById.r1)).status, "Writing…");

    a = reduceRunEvent(a, event({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "I will read the file. Done.",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 9));

    const run = a.runsById.r1;
    assert.equal(run.reasoning.r, "considering");
    assert.equal(run.message.m, "I will read the file. Done.");
    assert.equal(run.finalAnswer, "I will read the file. Done.");
    assert.equal(run.answerVouched, true);
    assert.deepEqual(run.answer, {});
    assert.equal(Object.keys(run.activities).length, 1);
    assert.equal(run.activities["read-1"]?.title, "Reading notes.md");
    assert.equal(deriveLivePhaseFromRun(run).kind, "clear");
    // Byte identity with finalAnswer is expected and is not a store collapse.
    assert.equal(run.message.m, run.finalAnswer);
  });

  it("Chat no-thought no-tool: message store stays distinct from CAS answer", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "Chat mid-turn answer" }, 2));
    a = reduceRunEvent(a, event({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "Chat mid-turn answer",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 3));
    const run = a.runsById.r1;
    assert.equal(Object.keys(run.reasoning).length, 0);
    assert.equal(Object.keys(run.activities).length, 0);
    assert.equal(run.message.m, "Chat mid-turn answer");
    assert.equal(run.finalAnswer, "Chat mid-turn answer");
    assert.deepEqual(run.answer, {});
  });

  it("long sequential burst merges by identity — one activity record", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    for (let i = 0; i < 8; i++) {
      const lifecycle = i % 2 === 0 ? "pending" : "terminal";
      a = reduceRunEvent(a, event({
        kind: "activity_update",
        activity: { ...tool(lifecycle), activityId: `t-${Math.floor(i / 2)}`, invocationId: `t-${Math.floor(i / 2)}` },
      }, i + 2));
    }
    assert.equal(Object.keys(a.runsById.r1.activities).length, 4);
  });

  it("thought never fills finalAnswer or answer store", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "secret thought" }, 2));
    a = reduceRunEvent(a, event({
      kind: "run_terminal",
      terminalKind: "failed",
      finalAnswer: null,
      answerVouched: false,
      failure: { code: "missing_final_answer", message: "Missing final answer", retryable: true, recoveryAction: "retry_prompt" },
      terminalAt: "",
    }, 3));
    assert.equal(a.runsById.r1.reasoning.r, "secret thought");
    assert.equal(a.runsById.r1.finalAnswer, null);
    assert.equal(a.runsById.r1.answerVouched, false);
    assert.deepEqual(a.runsById.r1.answer, {});
  });

  it("cancel after unvouched message_delta keeps mid-turn and does not vouch Answer", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "partial words" }, 2));
    a = reduceRunEvent(a, event({
      kind: "run_terminal",
      terminalKind: "cancelled",
      finalAnswer: null,
      answerVouched: false,
      failure: null,
      terminalAt: "",
    }, 3));
    assert.equal(a.runsById.r1.message.m, "partial words");
    assert.equal(a.runsById.r1.finalAnswer, null);
    assert.equal(a.runsById.r1.answerVouched, false);
  });

  it("persist/restore keeps thought, message, tools, and vouched answer", () => {
    let a = reduceRunEvent(initialRunProjection(), started());
    a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "think" }, 2));
    a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "mid" }, 3));
    a = reduceRunEvent(a, event({ kind: "activity_update", activity: tool("terminal") }, 4));
    a = reduceRunEvent(a, event({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "mid",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 5));
    const restored = restoreRunProjection(persistableRunProjection(a));
    const run = restored.runsById.r1;
    assert.equal(run.reasoning.r, "think");
    assert.equal(run.message.m, "mid");
    assert.equal(run.activities["read-1"]?.summary, "Read notes.md");
    assert.equal(run.finalAnswer, "mid");
    assert.equal(run.answerVouched, true);
  });
});
