import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunTerminalNotice } from "./RunTerminalNotice.js";
import type { DecisionRequest, RunProjectionRun } from "./runReducer.js";

afterEach(() => cleanup());

const prompt = "Create docs/dogfood/acp-code/deny-note.md containing exactly DENY-PROBE and stop.";

function run(overrides: Partial<RunProjectionRun> = {}): RunProjectionRun {
  return {
    sessionId: "s",
    runId: "run-deny",
    connectionGeneration: 1,
    state: "terminal",
    acceptedPrompt: prompt,
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 3,
    policy: {},
    model: {},
    terminalKind: "answered",
    finalAnswer: "Stopped.",
    answerVouched: true,
    failure: null,
    reasoning: {},
    answer: {},
    message: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1, 2, 3]),
    terminalEventSeq: 3,
    ...overrides,
  };
}

function declined(kind: DecisionRequest["kind"], title: string): DecisionRequest {
  return {
    requestId: "w1",
    invocationId: "w1",
    kind,
    status: "declined",
    title,
    detail: "docs/dogfood/acp-code/deny-note.md",
    expiresAt: null,
    policy: {},
  };
}

test("declined write shows Denied and Retry, not Answered", () => {
  let retried = "";
  render(
    createElement(RunTerminalNotice, {
      run: run({ decisions: { w1: declined("permission", "Write file") } }),
      onRetryPrompt: (p) => {
        retried = p;
      },
    }),
  );
  assert.equal(screen.queryByText("Answered"), null);
  assert.ok(screen.getByText("Denied"));
  fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
  assert.equal(retried, prompt);
});

test("declined diff shows Denied and Retry", () => {
  render(
    createElement(RunTerminalNotice, {
      run: run({ decisions: { w1: declined("diff", "Edit file") } }),
      onRetryPrompt: () => {},
    }),
  );
  assert.equal(screen.queryByText("Answered"), null);
  assert.ok(screen.getByText("Denied"));
  assert.ok(screen.getByRole("button", { name: /^Retry$/ }));
});

test("declined write without onRetryPrompt still shows Denied", () => {
  render(
    createElement(RunTerminalNotice, {
      run: run({ decisions: { w1: declined("permission", "Write file") } }),
    }),
  );
  assert.ok(screen.getByText("Denied"));
  assert.equal(screen.queryByRole("button", { name: /^Retry$/ }), null);
  assert.equal(screen.queryByText("Answered"), null);
});

test("clean answered run stays Answered with no Retry", () => {
  render(
    createElement(RunTerminalNotice, {
      run: run(),
      onRetryPrompt: () => {},
    }),
  );
  assert.ok(screen.getByText("Answered"));
  assert.equal(screen.queryByText("Denied"), null);
  assert.equal(screen.queryByRole("button", { name: /^Retry$/ }), null);
});
