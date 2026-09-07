// AC9 flow-integration test — GATE Z bounce regression coverage.
// Mocks the network boundary only (fetch + WebSocket); real App, real session
// store, real mode reducer, per spire-tech-flow-integration-tests.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { flushSessions, listSessions, reloadSessionsFromDisk } from "../lib/sessions";
import { restoreRunProjection, type RunEventEnvelope } from "../projections/runReducer";

/**
 * A Contract v1 run-scoped envelope addressed at the exact run/session the
 * app just bound via bindNormalizedRun (see testFakeHost.ts's own
 * `lastPromptRun` doc). Once a real send admits through POST /api/prompt,
 * App.tsx's onServerEvent only reduces this shape — a bare unscoped
 * `{type, ...}` frame is deliberately ignored post-bind.
 */
function envelope(
  target: { runId: string; sessionId: string },
  seq: number,
  payload: RunEventEnvelope["payload"],
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: target.sessionId,
    runId: target.runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

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

describe("AC9 — mode switch mid-stream / no second agent", () => {
  it("is never blocked while the host reports busy (a mid-stream turn) and cancels+switches", async () => {
    const host = createFakeHost({ mode: "chat", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Boot completes and the app renders the Chat chrome.
    const chatSeg = await screen.findByRole("radio", { name: "Chat" });
    assert.equal(chatSeg.getAttribute("aria-checked"), "true");

    // Simulate the host mid-stream: it pushes a state event with busy:true,
    // exactly as it would while text_delta frames are still arriving.
    await waitFor(() => assert.ok(FakeWebSocket.latest(), "expected a WS connection"));
    const ws = FakeWebSocket.latest()!;
    ws.emit({
      type: "state",
      state: { ...host.state, busy: true },
    });

    const codeSeg = await screen.findByRole("radio", { name: "Code" });
    await waitFor(() => {
      assert.equal(
        codeSeg.hasAttribute("disabled"),
        false,
        "mode segment must not be disabled while busy (SPEC §4: always available)",
      );
    });

    const user = userEvent.setup();
    await user.click(codeSeg);

    // Cancel must fire before/alongside the mode switch; a forced click must
    // not be inert (the shipped defect: 555 more deltas arrived, no switch).
    await waitFor(() => {
      assert.ok(
        host.callsTo("/api/cancel").length >= 1,
        "expected POST /api/cancel while busy",
      );
      assert.ok(
        host.callsTo("/api/mode").length >= 1,
        "expected POST /api/mode to actually fire",
      );
    });

    await waitFor(() => {
      const codeRadio = screen.getByRole("radio", { name: "Code" });
      assert.equal(codeRadio.getAttribute("aria-checked"), "true");
    });
  });

  it("is never blocked while a permission card is pending (host busy stays true)", async () => {
    const host = createFakeHost({ mode: "code", workspace: "C:\\repo", busy: true });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const codeSeg = await screen.findByRole("radio", { name: "Code" });
    await waitFor(() => {
      assert.equal(codeSeg.getAttribute("aria-checked"), "true");
    });

    // Host is busy (as it is while a permission_request is outstanding —
    // QA confirmed the disabled state was identical for both cases).
    const chatSeg = screen.getByRole("radio", { name: "Chat" });
    assert.equal(chatSeg.hasAttribute("disabled"), false);

    const user = userEvent.setup();
    await user.click(chatSeg);

    await waitFor(() => {
      assert.ok(host.callsTo("/api/cancel").length >= 1);
      assert.ok(host.callsTo("/api/mode").length >= 1);
    });
  });

  it("never spawns a second agent via hover/focus prefetch (C2 / removed endpoint)", async () => {
    const host = createFakeHost({ mode: "chat", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const codeSeg = await screen.findByRole("radio", { name: "Code" });

    const user = userEvent.setup();
    await user.hover(codeSeg);
    codeSeg.focus();
    await user.unhover(codeSeg);

    // No hover/focus network call at all — the fix is removal, not
    // conditioning (the endpoint is also gone from the shipped host).
    assert.equal(
      host.callsTo("prefetch").length,
      0,
      "hover/focus on the mode segment must never call the network",
    );
  });
});

// GATE Z round 3: AC9 clause 2 ("partial text stays in origin mode") had no
// coverage that started from the app's actual default first-launch state.
// Both tests below deliberately never click "New chat" — a genuinely empty
// profile, exactly as AC2 guarantees a new user starts in.
describe('AC9 clause 2 — partial text survives on a virgin profile (no "New chat" click)', () => {
  it("keeps the partial reply in Chat after a mid-stream mode switch away and back", async () => {
    const host = createFakeHost({ mode: "chat", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Virgin profile: send straight from the default first-launch chrome —
    // no "New chat" click first.
    const composer = await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.type(composer, "Tell me a story");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    await waitFor(() => assert.ok(host.lastPromptRun));
    const target = host.lastPromptRun!;

    // Mid-stream: host busy, partial text already rendered.
    ws.emit({ type: "state", state: { ...host.state, busy: true } });
    ws.emit(envelope(target, 1, { kind: "message_delta", segmentId: "s1", delta: "Once upon a time, in a " }) as unknown as Record<string, unknown>);
    ws.emit(envelope(target, 2, { kind: "message_delta", segmentId: "s1", delta: "far kingdom" }) as unknown as Record<string, unknown>);
    await waitFor(() =>
      assert.ok(screen.getByText(/Once upon a time, in a far kingdom/)),
    );

    // Mode switch mid-stream (clauses 1/3 — busy not blocking, no second
    // agent — are covered by the tests above; this one is clause 2).
    const codeSeg = await screen.findByRole("radio", { name: "Code" });
    await user.click(codeSeg);
    await waitFor(() => {
      assert.equal(
        screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"),
        "true",
      );
    });
    // Code opens idle: with Home's Chat-homes column wired to real data
    // (Task 13), Home may legitimately preview this same chat's own last
    // message — that is not a leak, it's Home working as designed
    // (mode-agnostic, docs/design/forge-next/Home.dc.html). What this
    // assertion actually guards is narrower: the live Chat transcript/
    // message list itself must not still be what's rendering the text.
    // So: collect every match, drop any that live inside Home's own
    // surface, and require zero survivors. Comparing a length (a number)
    // rather than a live DOM node keeps this safe even when it fails —
    // node:assert's failure-message builder walks a live element's React
    // Fiber tree at unbounded depth and freezes the process (see
    // .superpowers/sdd/crash-diagnosis.md); numbers never trigger that.
    const leakedOutsideHome = screen
      .queryAllByText(/Once upon a time/)
      .filter((el) => !el.closest(".home"));
    assert.equal(
      leakedOutsideHome.length,
      0,
      "the streaming Chat reply must not render outside Home's own preview",
    );

    // Back to Chat: the partial text must still be there.
    const chatSeg = screen.getByRole("radio", { name: "Chat" });
    await user.click(chatSeg);
    await waitFor(() => {
      assert.equal(
        screen.getByRole("radio", { name: "Chat" }).getAttribute("aria-checked"),
        "true",
      );
    });
    await waitFor(() => {
      assert.ok(
        screen.getByText(/Once upon a time, in a far kingdom/),
        "partial text must survive the round trip on a virgin profile",
      );
    });

    // Backed by a real durable record, not React state that happened to
    // survive because the component never unmounted — but investigated
    // empirically (fix/fakehost-prompt-shape) against the wrong mechanism.
    // A Contract v1 reply (message_delta/run_terminal) lives only in
    // runProjection, never in `messages`: App.tsx's session-store autosave
    // and switchMode's persist-before-flip step both read only
    // `messages`/`messagesRef.current`, and useRunEventStream.ts's
    // onServerEvent never calls setMessages for message_delta/run_terminal
    // in its v1 branch — by design, not oversight (see
    // promptSendHistory.ts's foldRunAnswersIntoHistory doc comment:
    // "Run-backed answers live on the run, not in messages"). So
    // listSessions() never sees this text and is the wrong assertion here.
    // What actually makes a v1 reply durable before/without any reload is
    // runProjection's own independent localStorage cache (App.tsx's "Run
    // identity/cursors outlive a WebView reload" effect, key
    // grokforge.runProjection.v1, written on every runProjection change and
    // restored via restoreRunProjection at mount) — confirmed by an
    // empirical probe (send, run_terminal, unmount, remount) that the text
    // really does survive a real reload through this path. Assert against
    // that real mechanism instead.
    const sessions = listSessions("chat:__sandbox__");
    assert.equal(sessions.length, 1);
    const restoredProjection = restoreRunProjection(
      JSON.parse(localStorage.getItem("grokforge.runProjection.v1") ?? "null"),
    );
    const restoredRun = restoredProjection.runsById[target.runId];
    assert.ok(restoredRun, "the mid-stream run must be in the durable runProjection cache");
    assert.ok(
      Object.values(restoredRun.message ?? {}).join("").includes("Once upon a time"),
      "the partial reply must survive in runProjection's own localStorage cache, independent of listSessions()",
    );
  });

  it('keeps the completed first turn after a plain reload with no "New chat" click', async () => {
    const host = createFakeHost({ mode: "chat", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const composer = await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.type(composer, "Hello Grok");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    await waitFor(() => assert.ok(host.lastPromptRun));
    const target = host.lastPromptRun!;
    ws.emit(envelope(target, 1, {
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "Hi there",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(screen.getByText(/Hi there/)));

    // Same finding as App.ac9's sibling "keeps the partial reply..." test
    // above, investigated empirically (fix/fakehost-prompt-shape): a v1
    // run_terminal's vouched finalAnswer lives only in runProjection, by
    // design (see promptSendHistory.ts's foldRunAnswersIntoHistory doc
    // comment) — App.tsx's session-store autosave persists only `messages`
    // state, which useRunEventStream.ts's onServerEvent never updates for
    // run_terminal, so listSessions() never sees this reply. What actually
    // makes it durable before a reload is runProjection's own independent
    // localStorage cache (App.tsx's "Run identity/cursors outlive a WebView
    // reload" effect, key grokforge.runProjection.v1); wait for that real
    // mechanism instead of the session store.
    await waitFor(() => {
      const restored = restoreRunProjection(
        JSON.parse(localStorage.getItem("grokforge.runProjection.v1") ?? "null"),
      );
      assert.equal(
        restored.runsById[target.runId]?.finalAnswer,
        "Hi there",
        "runProjection's own localStorage cache must persist the vouched answer before any reload can preserve it",
      );
    });

    // A real reload flushes localStorage on `pagehide` before the page goes
    // away — this is the browser guarantee a plain refresh relies on.
    flushSessions();
    assert.notEqual(
      localStorage.getItem("grokforge.sessions.v2"),
      null,
      'the first Chat turn must be persisted without any explicit "New chat"',
    );

    // A real host also reports busy:false once the turn is done; the fake
    // host only flips it on /api/cancel or /api/mode, so mirror that here
    // for the fresh boot below.
    host.state.busy = false;

    // Simulate the reload: unmount, drop the WS connection, remount fresh —
    // localStorage (the only thing a reload actually preserves) stays put.
    cleanup();
    FakeWebSocket.reset();
    render(<App />);

    await waitFor(() => {
      assert.ok(
        screen.getByText(/Hi there/),
        "the completed first turn must survive a plain reload",
      );
    });
    assert.equal(screen.queryByText(/^Chat with Grok$/) === null, true);
  });
});
