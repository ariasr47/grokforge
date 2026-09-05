// Task 1 regression guard (.superpowers/sdd/task-1-brief.md): the HostSocket
// connect effect's `onStatus` callback must call whichever `restoreOwnedRuns`
// closure is CURRENT at the moment a connection opens, not the one captured
// when the effect first constructed the socket. The effect's own dependency
// array intentionally stays `[boot, markDisconnectedActivity]` — rebuilding
// the socket every time the restore callback's identity changes would
// reconnect constantly, a real behavior change — so the only way to prove
// liveness is to watch the SECOND connect (after a forced disconnect) still
// issue a fresh restore call through the same effect instance, not to
// inspect closures directly.
//
// This passes both before and after Task 1's fix: today `restoreOwnedRuns`'s
// dependency chain is accidentally stable (it only closes over refs and
// `useCallback([])`s), so the stale closure captured at mount happens to
// behave identically to the live one. The point of this test is to keep
// failing loudly if a *later* task breaks that accidental stability without
// noticing this effect depends on it.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { RunEventEnvelope, RunSnapshot } from "./runReducer";

const PARTITION = "chat:__sandbox__";
const SESSION_ID = "socket-restore-session";
const RUN_ID = "socket-restore-run";

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
      [PARTITION]: [
        {
          id: SESSION_ID,
          workspace: PARTITION,
          title: "Session A",
          committedName: true,
          messages: [],
          updatedAt: Date.now(),
          status: "idle",
          subagents: [],
          open: true,
        },
      ],
    },
    activeId: { [PARTITION]: SESSION_ID },
    pinned: [PARTITION],
    expanded: [PARTITION],
  });
  FakeWebSocket.reset();
}

function runningSnapshot(acceptedPrompt: string): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt,
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "review" },
    model: { id: "grok-4.6" },
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
  };
}

function runStartedEnvelope(): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "run_started",
    sessionId: SESSION_ID,
    runId: RUN_ID,
    eventSeq: 1,
    connectionGeneration: 1,
    occurredAt: "",
    payload: { kind: "run_started", run: runningSnapshot("restore me") },
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
  // Keep the real 4s health-poll timer out of this test entirely: it can
  // also call reconcileOwnedRuns (a separate /api/runs/ caller), which would
  // pollute the call count this test measures if the test runs long enough
  // for it to fire. Registering a scheduler that never invokes `poll` makes
  // App.tsx skip the real setInterval altogether (see healthPollTestClock.ts).
  setHealthPollTestScheduler(() => () => {});
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
});

describe("HostSocket connect effect reads the live restoreOwnedRuns", () => {
  it("issues a fresh restore on the second connect, not just the closure captured at mount", async () => {
    const host = createFakeHost(
      { mode: "chat", workspace: null, busy: false },
      { runJournals: { [RUN_ID]: { run: runningSnapshot("restore me"), events: [] } } },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();
    await screen.findByLabelText("Message to agent");

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const firstSocket = FakeWebSocket.latest()!;
    await waitFor(() => assert.equal(firstSocket.readyState, FakeWebSocket.OPEN));

    // First connect: the run projection is empty, so restoreOwnedRuns is a
    // no-op (returns before ever calling GET /api/runs/...). This is the
    // baseline, not the thing under test.
    const restoreCallsAfterFirstConnect = host.callsTo("/api/runs/").length;

    // Force the state change a real disconnect/restore would follow: admit a
    // run so the owned-run projection is non-empty by the time the socket
    // reopens (this is also the kind of state change that would rebuild
    // restoreOwnedRuns's identity if its dependency chain were coded to
    // close over live state instead of refs/stable callbacks).
    await user.type(screen.getByLabelText("Message to agent"), "restore me");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    firstSocket.emit(runStartedEnvelope() as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Stop" })));

    // Drop the transport. HostSocket's own backoff timer reconnects it
    // without the outer App effect ever tearing down (deps stay
    // [boot, markDisconnectedActivity]) — so the reopen below runs through
    // the exact same onStatus closure the effect built at mount, making this
    // the SECOND connect through that one closure, not a fresh effect run.
    firstSocket.close();

    // The point of this test is the SECOND connect: it must use the live
    // restoreOwnedRuns, not the closure captured at mount.
    await waitFor(
      () => assert.ok(host.callsTo("/api/runs/").length > restoreCallsAfterFirstConnect),
      { timeout: 5_000 },
    );
    const restoreCallsAfterReconnect = host.callsTo("/api/runs/").length;
    assert.equal(restoreCallsAfterReconnect > restoreCallsAfterFirstConnect, true);
  });
});
