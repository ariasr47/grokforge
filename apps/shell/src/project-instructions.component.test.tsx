import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import {
  PI_COMPOSER_EMPTY,
  PI_COMPOSER_ERROR,
  PI_COMPOSER_LOADED_LABEL,
  PI_COMPOSER_LOADING,
} from "./projectInstructionsComposer";
import { PI_TURN_FAILED, piTurnIncluded } from "./projectInstructionsTurn";
import { PLAN_HEADER } from "./PlanSection";
import { RunSurface } from "./RunSurface";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import type { RunProjectionRun, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "pi-session";

function resetBrowserState(): void {
  localStorage.clear();
  localStorage.setItem(
    "grokforge.firstRun",
    JSON.stringify({
      dismissed: true,
      openedFolder: true,
      signedIn: true,
      sentMessage: true,
      pickedMode: true,
      seenAt: new Date().toISOString(),
    }),
  );
  reloadSessionsFromDisk({
    byWorkspace: {
      [WORKSPACE]: [{
        id: SESSION_ID,
        workspace: WORKSPACE,
        title: "Instructions",
        messages: [],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [WORKSPACE]: SESSION_ID },
    pinned: [WORKSPACE],
    expanded: [WORKSPACE],
  });
  FakeWebSocket.reset();
}

const snapshot: RunSnapshot = {
  sessionId: SESSION_ID,
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "follow the recipe",
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
    message: {},
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

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

beforeEach(() => {
  resetBrowserState();
});

afterEach(() => {
  cleanup();
});

test("Code composer: Plan, Expert, Review chips beside the field in order; meta line carries policy + project instructions", async () => {
  // Task 11 replaced the multi-row .composer-footer with chips beside the
  // field (Plan, Expert, Review) and a single mono .cmeta line — this
  // reworks the old footer-order assertion onto that structure, keeping the
  // same intent: Plan/Effort/Project-instructions/Policy are all reachable,
  // in a sensible order.
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
    projectInstructions: { status: "present", path: "AGENTS.md", vouched: true },
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");

  const bar = document.querySelector(".composer .bar");
  assert.ok(bar);
  const barText = bar.textContent ?? "";
  const plan = barText.indexOf("Plan");
  const expert = barText.indexOf("Auto"); // default effort level's chip label
  const review = barText.indexOf("Review");
  assert.ok(plan >= 0 && expert >= 0 && review >= 0);
  assert.ok(plan < expert && expert < review);

  const meta = document.querySelector(".cmeta")?.textContent ?? "";
  const policy = meta.indexOf("Review writes edits to disk and asks before shell");
  const instructions = meta.indexOf(PI_COMPOSER_LOADED_LABEL);
  assert.ok(policy >= 0 && instructions >= 0);
  assert.ok(policy < instructions);
  assert.ok(screen.getByText("AGENTS.md"));
});

test("Chat renders no project-instructions chrome", async () => {
  const host = createFakeHost({
    mode: "chat",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
    projectInstructions: { status: "present", path: "AGENTS.md", vouched: true },
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  assert.equal(screen.queryByText(PI_COMPOSER_LOADED_LABEL), null);
  assert.equal(screen.queryByText(PI_COMPOSER_EMPTY), null);
  assert.equal(screen.queryByText(PI_COMPOSER_ERROR), null);
  assert.equal(screen.queryByText(PI_COMPOSER_LOADING), null);
  assert.equal(document.querySelector("[data-project-instructions]"), null);
});

test("Send not disabled solely for empty or error presence", async () => {
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
    projectInstructions: { status: "absent", path: null, vouched: true },
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => {
    assert.ok(screen.getByText(PI_COMPOSER_EMPTY));
  });
  fireEvent.change(screen.getByLabelText("Message to agent"), {
    target: { value: "hello from code" },
  });
  assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), false);

  FakeWebSocket.latest()?.emit({
    type: "state",
    state: {
      ...host.state,
      projectInstructions: { status: "failed", path: "AGENTS.md", vouched: true },
    },
  });
  await waitFor(() => {
    assert.ok(screen.getByText(PI_COMPOSER_ERROR));
  });
  assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), false);
  assert.equal(screen.queryByText("AGENTS.md"), null);
});

test("workspace switch clears prior path (checking while unready)", async () => {
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
    projectInstructions: { status: "present", path: "AGENTS.md", vouched: true },
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => {
    const loaded = document.querySelector("[data-project-instructions='loaded']");
    assert.equal((loaded?.textContent ?? "").includes("AGENTS.md"), true);
  });
  FakeWebSocket.latest()?.emit({
    type: "state",
    state: {
      ...host.state,
      workspace: "C:\\other",
      workspaceName: "other",
      projectInstructions: { status: "absent", path: null, vouched: false },
    },
  });
  await waitFor(() => {
    const next = document.querySelector("[data-project-instructions='loading']");
    assert.equal((next?.textContent ?? "").includes(PI_COMPOSER_LOADING), true);
  });
  const chip = document.querySelector("[data-project-instructions='loading']");
  const chipText = chip?.textContent ?? "";
  // Boolean/text only. queryByText("—") hits the overview-strip "files —"
  // span (direct text node "—"); assert.equal(element, null) dumps the
  // jsdom/React tree until OOM.
  assert.equal(chipText.includes(PI_COMPOSER_LOADING), true);
  assert.equal(chipText.includes("AGENTS.md"), false);
  assert.equal(chipText.includes("—"), false);
});

test("included turn chip is a quiet pill — not a Plan section or action dock", () => {
  render(
    <RunSurface
      run={run({
        projectInstructions: {
          runId: "r1",
          sessionId: SESSION_ID,
          connectionGeneration: 1,
          inclusion: "included",
          path: "AGENTS.md",
        },
      })}
    />,
  );
  assert.ok(screen.getByText(piTurnIncluded("AGENTS.md")));
  assert.equal(screen.queryByRole("region", { name: PLAN_HEADER }), null);
  // File changes/Verify moved to the Changes dock (Task 9) — RunSurface alone
  // never renders that region at all, so there is nothing left to assert here.
  assert.equal(screen.queryByRole("region", { name: "Pending agent actions" }), null);
});

test("failed turn copy is distinct from not-included and does not print path", () => {
  const { container } = render(
    <RunSurface
      run={run({
        projectInstructions: {
          runId: "r1",
          sessionId: SESSION_ID,
          connectionGeneration: 1,
          inclusion: "failed",
          path: "AGENTS.md",
        },
      })}
    />,
  );
  assert.ok(screen.getByText(PI_TURN_FAILED));
  assert.equal(container.textContent?.includes("AGENTS.md"), false);
  assert.equal(screen.queryByText(/Followed/i), null);
});
