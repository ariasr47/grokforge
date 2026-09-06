// Task 6 characterization test for `ChatView` — the chrome AROUND
// TranscriptBody: ThreadHeader, the run-footer precedence ladder,
// ArtifactPanel, ActionDock and ComposerPane. TranscriptBody.test.tsx
// already pins TranscriptBody's own five-way transcript ladder; this file
// does not re-test that.
//
// Highest-value target: the footer precedence ladder in ChatView.tsx
// (search `PLAN_LIVE_FOOTER`):
//
//   {openingWs ? "Opening workspace…" : livePlanning ? PLAN_LIVE_FOOTER : runFooter}
//
// a three-way precedence chain nothing currently pins — exactly the kind of
// thing a later task can reorder by accident. For each precedence pair that
// genuinely co-occurs through the real `<App />`, the tests below assert the
// winner's text renders AND the loser's text is absent — asserting only the
// winner would not catch a swapped ternary arm.
//
// `openingWs` and `livePlanning` do NOT co-occur observably through the real
// `<App />` without reaching past the network boundary, so that pair is not
// tested here (reported instead of faked, per the task brief) — confirmed
// empirically, not just by reading the source:
// `livePlanning` requires a non-terminal `activeRun`, and
// composerSend.ts's `composerChromeBusy` makes that unconditionally busy
// (`if (input.activeNonTerminalRun) return true` is its first check), so
// `busyRef.current` is always true (once its mirroring effect, App.tsx
// ~2040, has had a chance to run) whenever `livePlanning` is true. Every
// path into `openPath` (App.tsx ~2803) that runs while `busyRef.current` is
// true calls the real `window.confirm(...)` before it will set
// `openingWs`; jsdom's `window.confirm` is unimplemented and returns a
// falsy value, so the call is refused before `setOpeningWs(true)` is ever
// reached. Stubbing `window.confirm` (precedented elsewhere in this suite,
// e.g. App.artifacts-panel.test.tsx) gets past that gate but a scratch spike
// against a live plan run (workspace-header click, confirm stubbed true,
// `.run-footer`'s textContent polled every 1ms) showed the DOM going
// straight from `PLAN_LIVE_FOOTER` to no footer at all, in three separate
// runs — `openPath`'s own `await api.cancel()` before `setOpeningWs(true)`,
// plus `ensureActiveSession` swapping `sessionId` (which un-scopes
// `activeRun`, clearing `livePlanning`) once `openWorkspace` resolves, both
// land inside one React commit here: `openingWs` really does become `true`
// in between, but this fake host's synchronous handlers resolve fast enough
// that React never paints that intermediate value, so there is nothing on
// screen for a test to assert on. See the task report for the full trace.
//
// Exercises the real `<App />` with only the network boundary faked
// (`createFakeHost`, `FakeWebSocket` from `./testFakeHost`), same shape as
// TranscriptBody.test.tsx: real session store, real reducers, real React
// tree.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../app/App";
import { createFakeHost, FakeWebSocket } from "../app/testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import { PLAN_LIVE_FOOTER } from "../projections/planArm";
import type { RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

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

afterEach(() => {
  cleanup();
});

function seedFirstRun(): void {
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
}

async function eventually(check: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      last = error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw last instanceof Error ? last : new Error("condition not met before timeout");
}

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

function runningPlanSnapshot(
  sessionId: string,
  runId: string,
  acceptedPrompt: string,
): RunSnapshot {
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
    executionPhase: "plan",
  };
}

describe("Task 6 — ChatView footer precedence ladder", () => {
  it("a live plan-phase run's footer wins over a reconnect message from that same busy run", async () => {
    const WORKSPACE = "C:\\repo-plan";
    const SESSION_ID = "chatview-plan-session";
    const RUN_ID = "chatview-plan-run";
    seedFirstRun();
    reloadSessionsFromDisk({
      byWorkspace: {
        [WORKSPACE]: [
          {
            id: SESSION_ID,
            workspace: WORKSPACE,
            title: "Plan stretch",
            messages: [{ id: "u1", role: "user", content: "propose a change" }],
            updatedAt: Date.now(),
            status: "live",
            subagents: [],
            open: true,
          },
        ],
      },
      activeId: { [WORKSPACE]: SESSION_ID },
      pinned: [WORKSPACE],
      expanded: [WORKSPACE],
    });
    FakeWebSocket.reset();
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo-plan",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await screen.findByLabelText("Message to agent");
    await eventually(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(
      runEnvelope(SESSION_ID, RUN_ID, 1, {
        kind: "run_started",
        run: runningPlanSnapshot(SESSION_ID, RUN_ID, "propose a change"),
      }) as unknown as Record<string, unknown>,
    );

    // Confirms livePlanning is genuinely live before touching the transport.
    await eventually(() => {
      assert.ok(screen.getByText(PLAN_LIVE_FOOTER));
    });

    // Drop the transport while the plan run is still non-terminal. App.tsx's
    // HostSocket onStatus(false) handler paints a "Reconnecting…" runFooter
    // whenever busyRef.current is true (App.tsx ~1697) — the plan run itself
    // never went terminal (no run_terminal was emitted), so livePlanning is
    // still true at the exact moment runFooter flips truthy underneath it.
    // That is the real co-occurrence the ladder's ternary has to arbitrate.
    ws.close();

    await eventually(() => {
      assert.ok(screen.getByText(PLAN_LIVE_FOOTER));
      assert.equal(screen.queryByText(/Connection lost/) === null, true);
    });
  });

  it("opening a different workspace wins the footer over a just-ended run's leftover message", async () => {
    const WORKSPACE_A = "C:\\repo-a";
    const WORKSPACE_B = "C:\\repo-b";
    seedFirstRun();
    reloadSessionsFromDisk({
      byWorkspace: {
        [WORKSPACE_A]: [
          {
            id: "session-a",
            workspace: WORKSPACE_A,
            title: "Workspace A",
            messages: [],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          },
        ],
        // sessions.ts's recomputePins ignores the `pinned` array below and
        // rebuilds it from `Object.keys(byWorkspace)` filtered to workspaces
        // with at least one non-closed session — WORKSPACE_B needs a session
        // of its own or its sidebar header never renders.
        [WORKSPACE_B]: [
          {
            id: "session-b",
            workspace: WORKSPACE_B,
            title: "Workspace B",
            messages: [],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          },
        ],
      },
      activeId: { [WORKSPACE_A]: "session-a", [WORKSPACE_B]: "session-b" },
      pinned: [WORKSPACE_A, WORKSPACE_B],
      expanded: [WORKSPACE_A],
    });
    FakeWebSocket.reset();
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE_A,
      workspaceName: "repo-a",
      busy: false,
      planEngagement: { engaged: false, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const composer = await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.type(composer, "run the tests");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await eventually(() => assert.ok(host.callsTo("/api/prompt").length >= 1));

    const ws = FakeWebSocket.latest();
    assert.ok(ws);
    ws!.emit({ type: "done", reason: "error" });

    await eventually(() => {
      assert.ok(screen.getByText(/Run ended/));
    });

    // Switch workspace via the sidebar's workspace header: App.tsx wires
    // that click straight to `onSelectWorkspace={(path) => void
    // openPath(path)}` (App.tsx ~5164) with no intervening await, and
    // openPath's own setOpeningWs(true) (App.tsx ~2803) is the first state
    // update it makes once it decides to proceed — nothing here is busy, so
    // that decision does not need the window.confirm gate, and the update
    // commits synchronously inside this one click.
    const otherWorkspaceHeader = screen.getByTitle(WORKSPACE_B);
    fireEvent.click(otherWorkspaceHeader);

    assert.ok(screen.getByText("Opening workspace…"));
    assert.equal(screen.queryByText(/Run ended/) === null, true);
    assert.equal(screen.queryByText(PLAN_LIVE_FOOTER) === null, true);

    // Let the switch finish so no in-flight fetch leaks into the next test.
    await eventually(() => {
      assert.equal(screen.queryByText("Opening workspace…") === null, true);
    });
  });
});

describe("Task 6 — ChatView composes the thread chrome", () => {
  it("an active session renders the thread header, transcript, action dock and composer together", async () => {
    const WORKSPACE = "C:\\repo-compose";
    const SESSION_ID = "chatview-compose-session";
    const RUN_ID = "chatview-compose-run";
    seedFirstRun();
    reloadSessionsFromDisk({
      byWorkspace: {
        [WORKSPACE]: [
          {
            id: SESSION_ID,
            workspace: WORKSPACE,
            title: "Compose check",
            messages: [{ id: "u1", role: "user", content: "run the deploy script" }],
            updatedAt: Date.now(),
            status: "live",
            subagents: [],
            open: true,
          },
        ],
      },
      activeId: { [WORKSPACE]: SESSION_ID },
      pinned: [WORKSPACE],
      expanded: [WORKSPACE],
    });
    FakeWebSocket.reset();
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo-compose",
      busy: false,
      planEngagement: { engaged: false, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const composer = await screen.findByLabelText("Message to agent");

    // A real composer send, even though this fake host's bare `{ ok: true }`
    // POST /api/prompt response is one App.tsx's sendText (App.tsx ~3908)
    // treats as inadmissible and reports as an error a moment later: the
    // eager, synchronous half of sendText that runs before that POST
    // (App.tsx's beginStreamRun, ~3799) still opens the stream epoch that
    // gates the legacy permission_request handler below (stampActivity,
    // App.tsx ~876, refuses a stamp with no live activity run open). The
    // run_started envelope right after supplies the lasting activeRun that
    // ThreadHeader's Cancel run actually keys off, independent of whatever
    // sendText's own admission does with runStartedAt.
    const user = userEvent.setup();
    await user.type(composer, "hello from the composed-chrome test");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await eventually(() => assert.ok(host.callsTo("/api/prompt").length >= 1));

    await eventually(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    // Same run_started envelope shape as the ladder test above — activeRun
    // going non-terminal is what composerSend.ts's composerChromeBusy keys
    // off unconditionally, so this alone drives ThreadHeader's Cancel run.
    ws.emit(
      runEnvelope(SESSION_ID, RUN_ID, 1, {
        kind: "run_started",
        run: {
          sessionId: SESSION_ID,
          runId: RUN_ID,
          connectionGeneration: 1,
          state: "running",
          acceptedPrompt: "run the deploy script",
          admittedAt: "",
          updatedAt: "",
          lastEventSeq: 1,
          policy: { effectiveMode: "review" },
          model: { id: "grok-4.6" },
          terminalKind: null,
          finalAnswer: null,
          answerVouched: false,
          failure: null,
        },
      }) as unknown as Record<string, unknown>,
    );
    // Legacy permission_request wire event — same shape
    // gate-keyboard-trust.integration.test.tsx uses for the same dock.
    ws.emit({ type: "permission_request", id: "perm-compose", kind: "shell", detail: "npm run deploy" });

    // All four land in the same check() call so the assertion is that they
    // are simultaneously present, not merely each reachable at some point.
    await eventually(() => {
      // ThreadHeader: the live run's own Cancel affordance.
      assert.ok(screen.getByRole("button", { name: "Cancel run" }));
      // TranscriptBody: the session's own content actually painted.
      // findAllByText, not findByText: MessageList's virtualizer can paint
      // the same row more than once in this harness (see
      // TranscriptBody.test.tsx's identical note) — the claim under test is
      // only that the content is showing, not how many nodes carry it.
      assert.equal(screen.getAllByText(/run the deploy script/).length >= 1, true);
      // ActionDock: the permission gate rendered as its own landmark.
      assert.ok(screen.getByRole("region", { name: "Pending agent actions" }));
      // ComposerPane: still present alongside the dock, not replaced by it.
      assert.ok(screen.getByLabelText("Message to agent"));
    });
  });
});
