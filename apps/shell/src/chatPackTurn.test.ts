import test from "node:test";
import assert from "node:assert/strict";
import { projectChatPackTurn } from "./chatPackTurn";
import type { ChatPackTurnVoucher, RunProjectionRun, RunSnapshot } from "./runReducer";

const snapshot: RunSnapshot = {
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "hello",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 2,
  policy: { effectiveMode: "review" },
  model: { id: "grok-4.6" },
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  failure: null,
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
    projectInstructions: null,
    chatPack: null,
    ...overrides,
  };
}

function voucher(
  overrides: Partial<ChatPackTurnVoucher> = {},
): ChatPackTurnVoucher {
  return {
    runId: "r1",
    sessionId: "s1",
    conversationId: "home-a",
    connectionGeneration: 1,
    inclusion: "included",
    fault: null,
    files: [{ path: "a.md" }],
    noteIncluded: true,
    ...overrides,
  };
}

test("Code / no voucher → absent", () => {
  assert.equal(
    projectChatPackTurn(run(), { phase: "closed" }, { mode: "code" }).state,
    "absent",
  );
  assert.equal(
    projectChatPackTurn(run(), { phase: "closed" }, { mode: "chat" }).state,
    "absent",
  );
});

test("catch-up open → hydrating, never empty copy", () => {
  const projection = projectChatPackTurn(
    run({ chatPack: voucher() }),
    { phase: "open" },
    { mode: "chat" },
  );
  assert.equal(projection.state, "hydrating");
});

test("catch-up failed without voucher → confirm_error", () => {
  assert.equal(
    projectChatPackTurn(run(), { phase: "failed" }, { mode: "chat" }).state,
    "confirm_error",
  );
});

test("included → Included pack (armed ≠ Included)", () => {
  const projection = projectChatPackTurn(
    run({ chatPack: voucher({ inclusion: "included" }) }),
    { phase: "closed" },
    { mode: "chat" },
  );
  assert.equal(projection.state, "included");
  if (projection.state === "included") {
    assert.equal(projection.noteIncluded, true);
    assert.equal(projection.files[0]?.path, "a.md");
  }
});

test("not_included is vouched empty only", () => {
  assert.equal(
    projectChatPackTurn(
      run({
        chatPack: voucher({
          inclusion: "not_included",
          files: [],
          noteIncluded: false,
        }),
      }),
      { phase: "closed" },
      { mode: "chat" },
    ).state,
    "not_included",
  );
});

test("unconfirmed voucher paints hydrating — never empty", () => {
  assert.equal(
    projectChatPackTurn(
      run({
        chatPack: voucher({
          inclusion: "unconfirmed",
          files: [],
          noteIncluded: false,
        }),
      }),
      { phase: "closed" },
      { mode: "chat" },
    ).state,
    "hydrating",
  );
});

test("confirm_failed → confirm_error, never Confirming…", () => {
  assert.equal(
    projectChatPackTurn(
      run({
        chatPack: voucher({
          inclusion: "confirm_failed",
          files: [],
          noteIncluded: false,
        }),
      }),
      { phase: "closed" },
      { mode: "chat" },
    ).state,
    "confirm_error",
  );
});

test("materialization_fault path vs over_cap from host fault only", () => {
  const path = projectChatPackTurn(
    run({
      chatPack: voucher({
        inclusion: "materialization_fault",
        fault: "path",
        noteIncluded: false,
      }),
    }),
    { phase: "closed" },
    { mode: "chat" },
  );
  assert.equal(path.state, "materialization_fault");
  if (path.state === "materialization_fault") assert.equal(path.fault, "path");

  const cap = projectChatPackTurn(
    run({
      chatPack: voucher({
        inclusion: "materialization_fault",
        fault: "over_cap",
        files: [],
        noteIncluded: false,
      }),
    }),
    { phase: "closed" },
    { mode: "chat" },
  );
  assert.equal(cap.state, "materialization_fault");
  if (cap.state === "materialization_fault") assert.equal(cap.fault, "over_cap");
});

test("restore keeps materialization_fault and confirm_failed", () => {
  const fault = projectChatPackTurn(
    run({
      chatPack: voucher({
        inclusion: "materialization_fault",
        fault: "over_cap",
        noteIncluded: false,
      }),
    }),
    { phase: "failed" },
    { mode: "chat" },
  );
  assert.equal(fault.state, "restored");
  if (fault.state === "restored") {
    assert.equal(fault.inclusion, "materialization_fault");
    assert.equal(fault.fault, "over_cap");
  }

  const confirm = projectChatPackTurn(
    run({
      chatPack: voucher({
        inclusion: "confirm_failed",
        files: [],
        noteIncluded: false,
      }),
    }),
    { phase: "failed" },
    { mode: "chat" },
  );
  assert.equal(confirm.state, "restored");
  if (confirm.state === "restored") assert.equal(confirm.inclusion, "confirm_failed");
});
