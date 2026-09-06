import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import {
  PI_COMPOSER_EMPTY,
  PI_COMPOSER_ERROR,
  PI_COMPOSER_LOADED_LABEL,
  PI_COMPOSER_LOADING,
} from "../projections/projectInstructionsComposer";
import { PI_TURN_FAILED, piTurnIncluded } from "../projections/projectInstructionsTurn";
import type { RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "pi-app-session";
const RUN_ID = "pi-app-run";

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
        title: "Recipe journey",
        messages: [{ id: "u1", role: "user", content: "follow the recipe" }],
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

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "follow the recipe",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "review" },
    model: { id: "grok-4.6" },
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    ...overrides,
  };
}

function envelope(payload: RunEventEnvelope["payload"], seq: number): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

function seedPersistedFailedRun(): void {
  localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
    runs: [{
      ...runSnapshot({ lastEventSeq: 2, state: "terminal", terminalKind: "answered", finalAnswer: "done", answerVouched: true }),
      reasoning: {},
      answer: {},
      activities: {},
      decisions: {},
      seenEventSeq: [1, 2],
      terminalEventSeq: 2,
      projectInstructions: {
        runId: RUN_ID,
        sessionId: SESSION_ID,
        connectionGeneration: 1,
        inclusion: "failed",
        path: "AGENTS.md",
      },
    }],
    cursors: { [SESSION_ID]: 2 },
  }));
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

describe("project-instructions App journeys", () => {
  it("loaded path chrome from host-vouched presence (AC-13)", async () => {
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
      assert.ok(screen.getByText(PI_COMPOSER_LOADED_LABEL));
      assert.ok(screen.getByText("AGENTS.md"));
    });
    assert.equal(screen.queryByText(/Followed/i) === null, true);
    assert.equal(document.body.textContent?.includes("Agents.md"), false);
  });

  it("empty ≠ error composer copy; Send stays enabled (AC-14/15)", async () => {
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
    await waitFor(() => assert.ok(screen.getByText(PI_COMPOSER_EMPTY)));
    assert.equal(screen.queryByText(PI_COMPOSER_ERROR) === null, true);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), "keep going");
    assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), false);

    FakeWebSocket.latest()?.emit({
      type: "state",
      state: {
        ...host.state,
        projectInstructions: { status: "failed", path: "AGENTS.md", vouched: true },
      },
    });
    await waitFor(() => assert.ok(screen.getByText(PI_COMPOSER_ERROR)));
    assert.equal(screen.queryByText(PI_COMPOSER_EMPTY) === null, true);
    assert.equal(screen.queryByText("AGENTS.md") === null, true);
    assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), false);
  });

  it("live included voucher paints Included · path and never Followed (AC-16)", async () => {
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
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "project_instructions",
      projectInstructions: {
        runId: RUN_ID,
        sessionId: SESSION_ID,
        connectionGeneration: 1,
        inclusion: "included",
        path: "AGENTS.md",
      },
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByText(piTurnIncluded("AGENTS.md")));
    });
    assert.equal(screen.queryByText(/Followed/i) === null, true);
  });

  it("failed turn copy restores after catch-up and is not collapsed (AC-19)", async () => {
    seedPersistedFailedRun();
    const replay = runSnapshot({
      lastEventSeq: 2,
      state: "terminal",
      terminalKind: "answered",
      finalAnswer: "done",
      answerVouched: true,
    });
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      projectInstructions: { status: "failed", path: "AGENTS.md", vouched: true },
    }, {
      runJournals: {
        [RUN_ID]: {
          run: replay,
          events: [
            envelope({
              kind: "project_instructions",
              projectInstructions: {
                runId: RUN_ID,
                sessionId: SESSION_ID,
                connectionGeneration: 1,
                inclusion: "failed",
                path: "AGENTS.md",
              },
            }, 2),
          ],
        },
      },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByText(PI_TURN_FAILED));
    });
    assert.equal(screen.queryByText(/No project instructions for this turn/) === null, true);
    assert.equal(screen.queryByText(piTurnIncluded("AGENTS.md")) === null, true);
    assert.ok(host.callsTo("/api/runs").length >= 1);
  });

  it("missing projectInstructions field → loading, never invents a path (AC-18)", async () => {
    const host = createFakeHost(
      {
        mode: "code",
        workspace: WORKSPACE,
        workspaceName: "repo",
        busy: false,
        projectInstructions: undefined,
      },
      { omitProjectInstructions: true },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(PI_COMPOSER_LOADING));
    });
    assert.equal(screen.queryByText("AGENTS.md") === null, true);
    assert.equal(screen.queryByText(PI_COMPOSER_EMPTY) === null, true);
  });

  it("Chat journey has no recipe chrome (AC-20)", async () => {
    const host = createFakeHost({
      mode: "chat",
      workspace: null,
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    assert.equal(screen.queryByText(PI_COMPOSER_LOADED_LABEL) === null, true);
    assert.equal(screen.queryByText(PI_COMPOSER_EMPTY) === null, true);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), "hello chat");
    assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), false);
  });
});
