// A live `run_terminal` WS envelope that lands while the engine is unreachable
// (hostOk === false, i.e. after App.tsx's two-failed-poll debounce). The socket
// can still deliver a run's terminal after /api/health has started failing —
// they are independent transports — so this crossing is reachable in the real
// app, and it had no coverage: App.flows.test.tsx's offline queue test
// deliberately terminates its run *before* going offline to stay off it.
//
// The run must settle exactly as it would online (Stop clears, the answer is
// kept) while the offline band and the disabled composer stay put, and a draft
// queued against that run must survive the crossing rather than being dropped
// or fired into an unreachable engine.
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
const SESSION_ID = "offline-terminal-session";
const RUN_ID = "offline-terminal-run";

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

function runEnvelope(seq: number, payload: RunEventEnvelope["payload"]): RunEventEnvelope {
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

function terminalEnvelope(seq: number, finalAnswer: string): RunEventEnvelope {
  return runEnvelope(seq, {
    kind: "run_terminal",
    terminalKind: "answered",
    finalAnswer,
    answerVouched: true,
    failure: null,
    terminalAt: "",
  });
}

function composerEl(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message to agent"]');
  assert.ok(el, "expected the composer");
  return el;
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
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
});

/** Renders the App with one busy run and the engine already unreachable. */
async function busyRunThenEngineDown(): Promise<{
  host: ReturnType<typeof createFakeHost>;
  ws: FakeWebSocket;
  user: ReturnType<typeof userEvent.setup>;
  poll: () => void;
}> {
  const healthClock: { trigger?: () => void } = {};
  setHealthPollTestScheduler((poll) => {
    healthClock.trigger = poll;
    return () => {
      healthClock.trigger = undefined;
    };
  });

  const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  render(<App />);
  const user = userEvent.setup();
  const composer = await screen.findByLabelText("Message to agent");

  await user.type(composer, "message one");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  const ws = FakeWebSocket.latest()!;
  ws.emit(
    runEnvelope(1, { kind: "run_started", run: runningSnapshot("message one") }) as unknown as Record<
      string,
      unknown
    >,
  );
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Stop" })));

  return { host, ws, user, poll: () => healthClock.trigger?.() };
}

async function takeEngineDown(host: ReturnType<typeof createFakeHost>, poll: () => void): Promise<void> {
  host.healthFail = true;
  // App.tsx debounces hostOk false behind two consecutive failed polls.
  poll();
  poll();
  await waitFor(() => assert.ok(document.querySelector(".transcript-offline")));
}

describe("a run_terminal envelope that lands while the engine is unreachable", () => {
  it("settles the run, keeps the offline band, and stays usable once the engine returns", async () => {
    const { host, ws, poll } = await busyRunThenEngineDown();
    await takeEngineDown(host, poll);
    assert.equal(FakeWebSocket.instances.length, 1, "one socket before the terminal");
    assert.ok(screen.getByRole("button", { name: "Stop" }), "still busy before the terminal");

    ws.emit(terminalEnvelope(2, "reply one") as unknown as Record<string, unknown>);

    // The run settles: Stop clears even though the health probe is failing.
    await waitFor(() =>
      assert.ok(screen.queryByRole("button", { name: "Stop" }) === null, "Stop must clear"),
    );
    // …and the answer the socket delivered is kept, not discarded as unreachable.
    await screen.findByText("reply one");

    // The offline chrome is untouched by the terminal: still banded, still
    // refusing sends, and still exactly one socket (no reconnect storm).
    assert.ok(document.querySelector(".transcript-offline"), "band survives the terminal");
    assert.equal(composerEl().disabled, true, "composer stays disabled while offline");
    assert.equal(FakeWebSocket.instances.length, 1, "one socket after the terminal");

    // The engine comes back: the band clears and the composer is usable again.
    host.healthFail = false;
    poll();
    await waitFor(() => assert.ok(document.querySelector(".transcript-offline") === null));
    await waitFor(() => assert.equal(composerEl().disabled, false));
    assert.ok(screen.getByText("reply one"), "the answer survives reconnection");
    assert.equal(FakeWebSocket.instances.length, 1, "one socket after recovery");
  });

  it("holds a draft queued against that run instead of dropping or firing it", async () => {
    const { host, ws, user, poll } = await busyRunThenEngineDown();

    await user.type(screen.getByLabelText("Message to agent"), "queued while running");
    await user.click(screen.getByRole("button", { name: "Queue" }));
    assert.ok(screen.getByRole("button", { name: "Queued · 1" }));

    await takeEngineDown(host, poll);

    // The busy -> idle transition the flush effect waits for happens here,
    // while the engine is unreachable: the attempt must bail out on that
    // guard and leave the draft queued, not clear it and not send it.
    ws.emit(terminalEnvelope(2, "reply one") as unknown as Record<string, unknown>);
    await waitFor(() =>
      assert.ok(screen.queryByRole("button", { name: "Stop" }) === null, "Stop must clear"),
    );
    // Give the guarded flush a genuine chance to run before asserting it didn't fire.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      host.callsTo("/api/prompt").length,
      1,
      "the queued draft must not fire while the engine is unreachable",
    );
    assert.ok(
      screen.getByRole("button", { name: "Queued · 1" }),
      "the queued draft must stay surfaced, not be silently dropped",
    );

    // The engine comes back -> the still-held draft flushes into its own session.
    host.healthFail = false;
    poll();
    await waitFor(() => assert.equal(host.callsTo("/api/prompt").length, 2));
    const secondCall = host.callsTo("/api/prompt")[1]!;
    assert.equal(secondCall.body?.text, "queued while running");
    assert.equal(secondCall.body?.sessionId, SESSION_ID);
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Queued/ }) === null));
  });
});
