// Flow-integration coverage for the automation-gap bounce (QA_REPORT §4):
// AC3 (Chat send + stream reply, no folder gate) and AC1 (mode switch keeps
// each mode's own session list; nothing merges/wipes on switch). Mocks the
// network boundary only (fetch + WebSocket); real App, real session store.
//
// Also covers the Task 11 review fix (queued-draft session scoping): a
// queued follow-up must be bound to the session it was queued against, not
// to whatever session happens to be selected when its run ends, and a
// guard bail-out (offline, engine down) must leave it queued rather than
// silently dropping it. See composerSend.ts's shouldFlushQueue.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { listSessions, reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { RunEventEnvelope, RunSnapshot } from "./runReducer";

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
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

/** A real run_started/run_terminal envelope pair — busy/Stop/Queue chrome is
 *  driven by the tracked run projection these populate, not by the raw
 *  POST /api/prompt response (this fake host's admission ack carries no
 *  `run`; see App.ac6.test.tsx for the same pattern this mirrors). */
function runEnvelope(
  sessionId: string,
  runId: string,
  seq: number,
  payload: RunEventEnvelope["payload"],
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

function runningSnapshot(sessionId: string, runId: string, acceptedPrompt: string): RunSnapshot {
  return {
    sessionId,
    runId,
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
});

describe("AC3 — Chat send + stream reply without a folder gate", () => {
  it("sends on the default sandbox (no workspace bound) and renders the streamed reply", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const composer = await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.type(composer, "Hello Grok");

    const sendBtn = screen.getByRole("button", { name: "Send" });
    assert.equal(
      sendBtn.hasAttribute("disabled"),
      false,
      "Chat send must not be gated behind an open project folder",
    );
    await user.click(sendBtn);

    await waitFor(() => {
      assert.ok(host.callsTo("/api/prompt").length >= 1);
    });
    // No "open a project folder first" banner in Chat.
    assert.equal(screen.queryByText(/open a project folder first/i), null);

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit({ type: "text_delta", text: "Hi there" });
    ws.emit({ type: "done", reason: "stop" });

    await waitFor(() => {
      assert.ok(screen.getByText(/Hi there/));
    });
  });
});

describe("AC7 — effort control visible in both modes, next send uses it", () => {
  it("persists the selected effort across a mode switch and sends it on the next turn", async () => {
    const host = createFakeHost({ mode: "chat", workspace: "C:\\repo", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Visible in Chat. Task 11 replaced the Effort radiogroup with an
    // `Expert ⌄` composer chip that opens a small menu — the trigger's own
    // accessible name is whichever level is current, so find it by its
    // aria-haspopup rather than by a fixed role/name.
    const effortTrigger = await screen.findByRole("button", { name: "Auto" });
    assert.equal(effortTrigger.getAttribute("aria-haspopup"), "menu");
    await user.click(effortTrigger);
    await user.click(await screen.findByRole("menuitemradio", { name: "Expert" }));
    await waitFor(() => assert.ok(host.callsTo("/api/effort").length >= 1));
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: "Expert" }));
    });

    // Survives a mode switch (one global control, not per-mode).
    await user.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"), "true");
    });
    assert.ok(screen.getByRole("button", { name: "Expert" }));

    // Next send in the new mode carries the selected effort.
    await user.keyboard("{Control>}n{/Control}");
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "use expert effort please");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const promptCalls = host.callsTo("/api/prompt");
      assert.ok(promptCalls.length >= 1);
      assert.equal(promptCalls[promptCalls.length - 1]!.body?.effort, "expert");
    });
  });
});

describe("AC1 — mode switch Chat<->Code keeps separate session lists", () => {
  it("does not merge or wipe the other mode's sessions on switch", async () => {
    const host = createFakeHost({
      mode: "chat",
      workspace: "C:\\repo",
      chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

render(<App />);

    const user = userEvent.setup();
    // Real virgin-profile flow: no "New chat" click first — Chat backs the
    // transcript with a session as soon as it boots (GATE Z round 3 fix),
    // so typing straight into the composer must already be persisted.
    const composer = await screen.findByLabelText("Message to agent");
    await user.type(composer, "Chat-only message");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    let ws = FakeWebSocket.latest()!;
    ws.emit({ type: "text_delta", text: "Chat reply" });
    ws.emit({ type: "done", reason: "stop" });
    await waitFor(() => assert.ok(screen.getByText(/Chat reply/)));

    const chatPartitionKey = "chat:__sandbox__";
    await waitFor(() => {
      const sessions = listSessions(chatPartitionKey);
      assert.equal(sessions.length, 1);
      assert.ok(sessions[0]!.messages.some((m) => m.content.includes("Chat-only message")));
    });

    // Switch to Code.
    const codeSeg = screen.getByRole("radio", { name: "Code" });
    await user.click(codeSeg);
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"), "true");
    });

    // Code chrome starts idle — the Chat transcript must not leak in.
    assert.equal(screen.queryByText(/Chat-only message/), null);
    assert.equal(screen.queryByText(/Chat reply/), null);

    // Code: start its own session (Ctrl+N — global shortcut, works without
    // expanding the workspace tree) and send its own turn.
    await user.keyboard("{Control>}n{/Control}");
    const composer2 = screen.getByLabelText("Message to agent");
    await user.type(composer2, "Code-only message");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 2));
    ws = FakeWebSocket.latest()!;
    ws.emit({ type: "text_delta", text: "Code reply" });
    ws.emit({ type: "done", reason: "stop" });
    await waitFor(() => assert.ok(screen.getByText(/Code reply/)));

    const codePartitionKey = "C:\\repo";
    await waitFor(() => {
      // Switching modes ensures an idle active session first (SPEC §4:
      // "the target mode opens with an idle dock"); Ctrl+N then starts a
      // second, so assert containment rather than an exact count.
      const sessions = listSessions(codePartitionKey);
      assert.ok(
        sessions.some((s) => s.messages.some((m) => m.content.includes("Code-only message"))),
      );
    });

    // Switch back to Chat — its own history is intact, Code's did not merge in.
    const chatSeg = screen.getByRole("radio", { name: "Chat" });
    await user.click(chatSeg);
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Chat" }).getAttribute("aria-checked"), "true");
    });
    await waitFor(() => assert.ok(screen.getAllByText(/Chat-only message/).length > 0));
    assert.equal(screen.queryByText(/Code-only message/), null);

    // Nothing merged or wiped: each partition still holds only its own turn.
    const chatSessionsAfter = listSessions(chatPartitionKey);
    const codeSessionsAfter = listSessions(codePartitionKey);
    assert.ok(
      chatSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Chat-only message"))),
    );
    assert.ok(
      !chatSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Code-only message"))),
    );
    assert.ok(
      codeSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Code-only message"))),
    );
    assert.ok(
      !codeSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Chat-only message"))),
    );
  });
});

describe("Queue ⇧⏎ is bound to its own session (review fix, Finding 1)", () => {
  it("never leaks a queued draft into a session switched to meanwhile, and flushes it only once its own session goes idle", async () => {
    const partition = "chat:__sandbox__";
    const SESSION_A = "session-a";
    const SESSION_B = "session-b";
    const RUN_A = "run-a";
    reloadSessionsFromDisk({
      byWorkspace: {
        [partition]: [
          {
            id: SESSION_A,
            workspace: partition,
            title: "Session A",
            // Otherwise saveSessionMessages auto-retitles an uncommitted
            // session from its first user message once one is sent, and
            // "Session A" would stop matching after the send below.
            committedName: true,
            messages: [],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          },
          {
            id: SESSION_B,
            workspace: partition,
            title: "Session B",
            committedName: true,
            messages: [{ id: "b-prior", role: "assistant", content: "prior message in B" }],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          },
        ],
      },
      activeId: { [partition]: SESSION_A },
      pinned: [partition],
      expanded: [partition],
    });

    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Message to agent");

    // Start A's run and keep it non-terminal (busy).
    await user.type(composer, "message for A");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    let ws = FakeWebSocket.latest()!;
    ws.emit(
      runEnvelope(SESSION_A, RUN_A, 1, {
        kind: "run_started",
        run: runningSnapshot(SESSION_A, RUN_A, "message for A"),
      }) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Stop" })));

    // Queue a follow-up while A is busy.
    await user.type(composer, "queued for A");
    await user.click(screen.getByRole("button", { name: "Queue" }));
    assert.ok(screen.getByRole("button", { name: "Queued · 1" }));

    // Switch to session B.
    const bTitle = [...document.querySelectorAll(".session-title")].find(
      (el) => el.textContent === "Session B",
    );
    assert.ok(bTitle, "expected Session B's row in the sidebar");
    fireEvent.click(bTitle!.closest("button") ?? bTitle!);
    await waitFor(() => assert.ok(screen.getByText("prior message in B")));

    // B must show no chip, and A's draft must not have leaked into B.
    assert.equal(screen.queryByRole("button", { name: /^Queued/ }), null);
    assert.equal(host.callsTo("/api/prompt").length, 1);
    assert.ok(
      host.callsTo("/api/prompt").every((c) => c.body?.text !== "queued for A"),
      "A's queued draft must never be sent while B is selected",
    );

    // Switch back to A — still busy, so the chip reappears (bound to A, not
    // lost by the switch away).
    const aTitle = [...document.querySelectorAll(".session-title")].find(
      (el) => el.textContent === "Session A",
    );
    assert.ok(aTitle, "expected Session A's row in the sidebar");
    fireEvent.click(aTitle!.closest("button") ?? aTitle!);
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Queued · 1" })));

    // A's run ends while A is selected -> the held draft flushes into A.
    ws = FakeWebSocket.latest()!;
    ws.emit(
      runEnvelope(SESSION_A, RUN_A, 2, {
        kind: "run_terminal",
        terminalKind: "answered",
        finalAnswer: "reply to A",
        answerVouched: true,
        failure: null,
        terminalAt: "",
      }) as unknown as Record<string, unknown>,
    );

    await waitFor(() => assert.equal(host.callsTo("/api/prompt").length, 2));
    const secondCall = host.callsTo("/api/prompt")[1]!;
    assert.equal(secondCall.body?.text, "queued for A");
    assert.equal(secondCall.body?.sessionId, SESSION_A);
    await waitFor(() => assert.equal(screen.queryByRole("button", { name: /^Queued/ }), null));
  });
});

describe("a queued draft survives a guard bail-out instead of being dropped (review fix, Finding 1c)", () => {
  it("a flush attempt while the engine is unreachable keeps the draft queued and surfaced, then sends once reachable again", async () => {
    const healthClock: { trigger?: () => void } = {};
    setHealthPollTestScheduler((poll) => {
      healthClock.trigger = poll;
      return () => {
        healthClock.trigger = undefined;
      };
    });

    const partition = "chat:__sandbox__";
    const SESSION_A = "offline-session-a";
    const SESSION_B = "offline-session-b";
    const RUN_A = "offline-run";
    reloadSessionsFromDisk({
      byWorkspace: {
        [partition]: [
          {
            id: SESSION_A,
            workspace: partition,
            title: "Session A",
            committedName: true,
            messages: [],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          },
          {
            id: SESSION_B,
            workspace: partition,
            title: "Session B",
            committedName: true,
            messages: [{ id: "b-prior", role: "assistant", content: "prior message in B" }],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          },
        ],
      },
      activeId: { [partition]: SESSION_A },
      pinned: [partition],
      expanded: [partition],
    });

    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Message to agent");

    // Start A's run and keep it non-terminal (busy).
    await user.type(composer, "message one");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(
      runEnvelope(SESSION_A, RUN_A, 1, {
        kind: "run_started",
        run: runningSnapshot(SESSION_A, RUN_A, "message one"),
      }) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Stop" })));

    // Queue a follow-up while busy.
    await user.type(composer, "queued while offline");
    await user.click(screen.getByRole("button", { name: "Queue" }));
    assert.ok(screen.getByRole("button", { name: "Queued · 1" }));

    // A's run ends normally, still fully connected, but while B (not A) is
    // selected — the queued draft must not flush into B (Finding 1a; already
    // covered by the sibling test above), so this alone must not fire it.
    // Doing the termination here, before going offline, keeps this test to
    // Finding 1c's own concern (a guard bail-out must not drop the draft)
    // without also depending on how a live run-terminal WS envelope
    // interacts with the engine-unreachable band — a separate, pre-existing
    // interaction outside this fix's scope (flagged separately).
    const bTitle = [...document.querySelectorAll(".session-title")].find(
      (el) => el.textContent === "Session B",
    );
    assert.ok(bTitle, "expected Session B's row in the sidebar");
    fireEvent.click(bTitle!.closest("button") ?? bTitle!);
    await waitFor(() => assert.ok(screen.getByText("prior message in B")));
    ws.emit(
      runEnvelope(SESSION_A, RUN_A, 2, {
        kind: "run_terminal",
        terminalKind: "answered",
        finalAnswer: "reply one",
        answerVouched: true,
        failure: null,
        terminalAt: "",
      }) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.equal(screen.queryByRole("button", { name: /^Queued/ }), null));
    assert.equal(host.callsTo("/api/prompt").length, 1);

    // The engine goes unreachable — two consecutive failed health polls
    // (App.tsx debounces hostOk false behind streak >= 2).
    host.healthFail = true;
    assert.ok(healthClock.trigger);
    healthClock.trigger!();
    healthClock.trigger!();
    await waitFor(() => assert.ok(document.querySelector(".transcript-offline")));

    // Switch back to A: its run is already terminal, so this is exactly the
    // busy->idle transition the flush effect waits for — except the engine
    // is unreachable. The attempt must bail out on that guard and leave the
    // draft queued and surfaced, not clear it and not throw it away.
    const aTitle = [...document.querySelectorAll(".session-title")].find(
      (el) => el.textContent === "Session A",
    );
    assert.ok(aTitle, "expected Session A's row in the sidebar");
    fireEvent.click(aTitle!.closest("button") ?? aTitle!);
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Queued · 1" })));
    // Give the guarded flush attempt a genuine chance to run and bail out
    // before asserting nothing happened.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      host.callsTo("/api/prompt").length,
      1,
      "the queued draft must not fire while disconnected",
    );
    assert.ok(
      screen.getByRole("button", { name: "Queued · 1" }),
      "the queued draft must remain surfaced as waiting, not silently dropped",
    );

    // The engine comes back -> the still-held draft flushes into A.
    host.healthFail = false;
    healthClock.trigger!();
    await waitFor(() => assert.equal(host.callsTo("/api/prompt").length, 2));
    const secondCall = host.callsTo("/api/prompt")[1]!;
    assert.equal(secondCall.body?.text, "queued while offline");
    assert.equal(secondCall.body?.sessionId, SESSION_A);
    await waitFor(() => assert.equal(screen.queryByRole("button", { name: /^Queued/ }), null));
  });
});
