import test from "node:test";
import assert from "node:assert/strict";
import { projectProjectInstructionsTurn } from "./projectInstructionsTurn";
import type { ProjectInstructionsTurnVoucher, RunProjectionRun, RunSnapshot } from "./runReducer";

const snapshot: RunSnapshot = {
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "do the work",
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
    ...overrides,
  };
}

function voucher(
  overrides: Partial<ProjectInstructionsTurnVoucher> = {},
): ProjectInstructionsTurnVoucher {
  return {
    runId: "r1",
    sessionId: "s1",
    connectionGeneration: 1,
    inclusion: "included",
    path: "AGENTS.md",
    ...overrides,
  };
}

test("catch-up open → hydrating Confirming… copy", () => {
  assert.equal(
    projectProjectInstructionsTurn(
      run({ projectInstructions: voucher() }),
      { phase: "open" },
    ).state,
    "hydrating",
  );
});

test("catch-up failed → confirm_error exact copy", () => {
  assert.equal(
    projectProjectInstructionsTurn(run(), { phase: "failed" }).state,
    "confirm_error",
  );
});

test("included → Included · {path}", () => {
  const projection = projectProjectInstructionsTurn(
    run({ projectInstructions: voucher({ inclusion: "included", path: "AGENTS.md" }) }),
    { phase: "closed" },
  );
  assert.equal(projection.state, "included");
  if (projection.state === "included") assert.equal(projection.path, "AGENTS.md");
});

test("not_included → muted No project instructions for this turn or quiet absence", () => {
  assert.equal(
    projectProjectInstructionsTurn(
      run({ projectInstructions: voucher({ inclusion: "not_included", path: null }) }),
      { phase: "closed" },
    ).state,
    "not_included",
  );
});

test("failed → Couldn’t resolve project instructions for this turn. (no path print)", () => {
  const projection = projectProjectInstructionsTurn(
    run({ projectInstructions: voucher({ inclusion: "failed", path: "AGENTS.md" }) }),
    { phase: "closed" },
  );
  assert.equal(projection.state, "failed");
  if (projection.state === "failed") assert.equal(projection.path, "AGENTS.md");
});

test("restored keeps failed", () => {
  const projection = projectProjectInstructionsTurn(
    run({ projectInstructions: voucher({ inclusion: "failed", path: "AGENTS.md" }) }),
    { phase: "failed" },
  );
  assert.equal(projection.state, "restored");
  if (projection.state === "restored") {
    assert.equal(projection.inclusion, "failed");
    assert.equal(projection.path, "AGENTS.md");
  }
  const closed = projectProjectInstructionsTurn(
    run({ projectInstructions: voucher({ inclusion: "failed", path: "AGENTS.md" }) }),
    { phase: "closed" },
  );
  assert.equal(closed.state, "failed");
});

test("Chat / no voucher → absent", () => {
  assert.equal(
    projectProjectInstructionsTurn(run(), { phase: "closed" }, { mode: "chat" }).state,
    "absent",
  );
  assert.equal(
    projectProjectInstructionsTurn(run(), { phase: "closed" }).state,
    "absent",
  );
});

test("included with Agents.md is not painted as a recognized path", () => {
  const projection = projectProjectInstructionsTurn(
    run({ projectInstructions: voucher({ inclusion: "included", path: "Agents.md" }) }),
    { phase: "closed" },
  );
  assert.notEqual(projection.state, "included");
});
