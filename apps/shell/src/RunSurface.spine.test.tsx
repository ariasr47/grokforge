import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { RunSurface } from "./RunSurface.js";
import type { RunProjectionRun, RunSnapshot } from "./runReducer.js";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "s-spine",
  runId: "run-spine",
  connectionGeneration: 1,
  state: "waiting_for_decision",
  acceptedPrompt: "spine check",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 1,
  policy: {},
  model: {},
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
    message: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: null,
    ...overrides,
  } as RunProjectionRun;
}

describe("RunSurface turn spine — node reflects run state", () => {
  it("waiting_for_decision paints the response turn's node amber", () => {
    render(createElement(RunSurface, { run: run({ state: "waiting_for_decision" }) }));
    assert.ok(document.querySelector(".node--amber"), "expected a .node--amber node");
    assert.equal(document.querySelector(".node--done"), null);
  });

  it("terminal/answered paints the response turn's node done (muted)", () => {
    render(
      createElement(RunSurface, {
        run: run({
          state: "terminal",
          terminalKind: "answered",
          finalAnswer: "ok",
          answerVouched: true,
          terminalEventSeq: 2,
        }),
      }),
    );
    assert.ok(document.querySelector(".node--done"), "expected a .node--done node");
    assert.equal(document.querySelector(".node--amber"), null);
  });

  it("the You turn's own node always stays hollow, regardless of run state", () => {
    render(createElement(RunSurface, { run: run({ state: "waiting_for_decision" }) }));
    const youNode = document.querySelector(".you-turn .node");
    assert.ok(youNode, "expected the You turn to have a node");
    assert.equal(youNode!.className.includes("node--"), false, "You node must not carry a state modifier");
  });

  it("never renders the retired Your turn delimiter or Answered strip copy", () => {
    render(
      createElement(RunSurface, {
        run: run({
          state: "terminal",
          terminalKind: "answered",
          finalAnswer: "ok",
          answerVouched: true,
          terminalEventSeq: 2,
        }),
      }),
    );
    assert.equal(document.body.textContent?.includes("Your turn"), false);
    assert.equal(document.body.textContent?.includes("Answered"), false);
  });
});
