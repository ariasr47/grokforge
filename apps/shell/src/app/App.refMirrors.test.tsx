// Task 2 (refactor/shell-structure) — characterization tests for the
// latest-value ref mirrors in App.tsx, written BEFORE their render-time
// writes move into effects (see .superpowers/sdd/task-2-brief.md and
// AGENT-PREAMBLE.md). Both behaviors below are gated by `sessionIdRef`
// being current at the moment `onServerEvent` decides envelope ownership:
// `applyRailEvidence`/`paintEnvelopeActivity` read `sessionIdRef.current`
// (not the closed-over `sessionId` state) precisely so a stable callback
// keeps seeing the CURRENT session without needing to be recreated on every
// switch. If that ref ever lagged behind (e.g. a discarded-render artifact
// under concurrent rendering), a run event could paint into — or leak out
// of — the wrong session's rail. This file pins the observable behavior so
// Step 3's render-to-effect migration cannot change it invisibly.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { partitionKey, reloadSessionsFromDisk } from "../lib/sessions";
import { setHealthPollTestScheduler } from "../lib/healthPollTestClock";
import type { DecisionRequest, RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

const CHAT_ROOT = "C:\\Users\\qa\\.grokforge\\chat-sandbox";
const CHAT_PART = partitionKey("chat", CHAT_ROOT);
const SESSION_A = "session-alpha";
const SESSION_B = "session-beta";
const TITLE_A = "Session Alpha";
const TITLE_B = "Session Beta";

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
      [CHAT_PART]: [
        {
          id: SESSION_A,
          workspace: CHAT_PART,
          title: TITLE_A,
          committedName: true,
          packMembers: { files: [], note: null },
          messages: [],
          updatedAt: Date.now(),
          status: "live",
          subagents: [],
          open: true,
        },
        {
          id: SESSION_B,
          workspace: CHAT_PART,
          title: TITLE_B,
          committedName: true,
          packMembers: { files: [], note: null },
          messages: [],
          updatedAt: Date.now() - 1000,
          status: "idle",
          subagents: [],
          open: true,
        },
      ],
    },
    activeId: { [CHAT_PART]: SESSION_A },
    pinned: [CHAT_PART],
    expanded: [CHAT_PART],
  });
  FakeWebSocket.reset();
}

function runSnapshot(sessionId: string, runId: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId,
    runId,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "hello",
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

function envelope(
  payload: RunEventEnvelope["payload"],
  seq: number,
  sessionId: string,
  runId: string,
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

function permission(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "perm-req",
    invocationId: "perm-inv",
    kind: "permission",
    status: "pending",
    title: "Run shell",
    detail: "echo default",
    expiresAt: null,
    policy: {},
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
  setHealthPollTestScheduler(null);
});

beforeEach(() => {
  resetBrowserState();
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
});

async function mountApp() {
  const host = createFakeHost({
    mode: "chat",
    workspace: null,
    busy: false,
    chatRoot: CHAT_ROOT,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
}

function sidebar(): HTMLElement {
  return screen.getByRole("complementary", { name: "Chat sessions" });
}

describe("App latest-value ref mirrors (Task 2 characterization)", () => {
  it("(a) a run event for the previous session, arriving after a fast switch, is not painted into the new session's rail", async () => {
    const { ws } = await mountApp();
    const user = userEvent.setup();

    // Session A is current: its own run's permission paints normally —
    // sanity check that the emit/paint plumbing works at all here.
    ws.emit(envelope({ kind: "run_started", run: runSnapshot(SESSION_A, "run-a") }, 1, SESSION_A, "run-a") as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: permission({ requestId: "perm-a-1", detail: "echo owned-by-a" }) }, 2, SESSION_A, "run-a") as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(screen.getAllByText("echo owned-by-a").length >= 1));

    // Fast switch: A -> B.
    await user.click(within(sidebar()).getByText(TITLE_B));
    await waitFor(() => assert.equal(screen.queryAllByText("echo owned-by-a").length, 0));

    // A's run (now the *previous* session) fires a late decision_request —
    // e.g. a permission request the agent raised just before the switch,
    // delivered by the socket just after.
    ws.emit(envelope({ kind: "decision_request", request: permission({ requestId: "perm-a-2", detail: "echo late-for-a" }) }, 3, SESSION_A, "run-a") as unknown as Record<string, unknown>);

    // Let any (mis)paint settle, then confirm it never reached B's rail.
    // (Returning to A afterward is deliberately not asserted here: A's own
    // run projection is updated unconditionally regardless of ownership —
    // only the CROSS-session leak into B's live view is sessionIdRef's job
    // to prevent, and that is what this assertion pins.)
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(screen.queryAllByText("echo late-for-a").length, 0);
  });

  it("(b) sendText admits against whichever session is current at send time", async () => {
    const { host, ws } = await mountApp();
    const user = userEvent.setup();

    // Fast switch: A -> B, then send from B.
    await user.click(within(sidebar()).getByText(TITLE_B));
    await waitFor(() => assert.ok(screen.getByLabelText("Message to agent")));

    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "hello from B" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    const prompt = host.callsTo("/api/prompt")[0];
    assert.equal(prompt?.body?.sessionId, SESSION_B);
    assert.equal(prompt?.body?.conversationId, SESSION_B);

    // The engine's own live response for B's new run must paint under B —
    // this is the same sessionIdRef-gated ownership check as (a), exercised
    // for a self-originated send instead of an externally-arriving event.
    ws.emit(envelope({ kind: "run_started", run: runSnapshot(SESSION_B, "run-b") }, 1, SESSION_B, "run-b") as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: permission({ requestId: "perm-b-1", detail: "echo owned-by-b" }) }, 2, SESSION_B, "run-b") as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(screen.getAllByText("echo owned-by-b").length >= 1));
  });
});
