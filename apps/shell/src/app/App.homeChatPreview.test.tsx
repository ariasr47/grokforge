// Repro check for a claimed bug (not yet observed, only found by reading
// code): sessions.ts's chatSessionPreview() builds Home's Chat-homes
// single-line excerpt from `sess.messages` alone. A Contract v1 run's reply
// (message_delta/run_terminal) is deliberately never written into
// `messages` — see promptSendHistory.ts's foldRunAnswersIntoHistory doc
// comment ("Run-backed answers live on the run, not in messages") and
// App.ac9.test.tsx's "keeps the completed first turn..." case, which
// already proves a vouched reply is real and durable, but only in
// runProjection. The claim: after a v1 run completes, the last message in
// `messages` is still the operator's own outgoing prompt (useComposerSend.ts
// pushes it synchronously), so Home's preview would show that prompt
// instead of Grok's reply. This test renders the real <App /> against the
// fake host, per spire-tech-flow-integration-tests, and looks at what Home
// actually paints — proof before any fix, not a restatement of the theory.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import type { RunEventEnvelope } from "../projections/runReducer";

/**
 * A Contract v1 run-scoped envelope addressed at the exact run/session the
 * app just bound via bindNormalizedRun — same helper as App.ac9.test.tsx /
 * App.ac4.test.tsx (see testFakeHost.ts's own `lastPromptRun` doc).
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

describe("Home screen chat-home preview after a completed v1 run", () => {
  it("reflects Grok's vouched reply, not just the operator's own last prompt", async () => {
    const host = createFakeHost({ mode: "chat", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const composer = await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.type(composer, "Tell me a story");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    await waitFor(() => assert.ok(host.lastPromptRun));
    const target = host.lastPromptRun!;

    ws.emit(envelope(target, 1, {
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "Once upon a time, in a far kingdom.",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }) as unknown as Record<string, unknown>);
    await waitFor(() =>
      assert.ok(screen.getByText(/Once upon a time, in a far kingdom/)),
    );

    // Back to Home: App.tsx's newSession synchronously persists the
    // just-finished session's `messages` (persistMessages) before opening a
    // fresh, empty one — Home renders again because the new active session
    // has zero messages and no visible run (the same condition
    // TranscriptBody.tsx gates HomeScreen on).
    await user.click(screen.getByRole("button", { name: "New chat" }));

    await waitFor(() => {
      assert.ok(
        document.querySelectorAll(".home-col")[1],
        "expected the Chat homes column to render on Home",
      );
    });
    const chatHomesCol = document.querySelectorAll(".home-col")[1] as HTMLElement;
    const rows = chatHomesCol.querySelectorAll("button.home-item");
    assert.ok(
      rows.length >= 1,
      "expected at least the just-finished session to list as a chat home",
    );
    // HomeScreen.tsx renders the title in .home-t and chatSessionPreview's
    // output in .home-s (omitted entirely when null) — read the preview
    // element directly rather than searching page text, since the title
    // itself may legitimately equal the operator's prompt (first-line
    // auto-title) even once the preview bug is fixed.
    const previews = Array.from(rows)
      .map((row) => row.querySelector(".home-s")?.textContent ?? null)
      .filter((t): t is string => t !== null);
    assert.equal(
      previews.length,
      1,
      `expected exactly one chat-home row with a preview (the fresh empty session has none); got ${JSON.stringify(previews)}`,
    );
    assert.ok(
      previews[0]!.includes("Once upon a time"),
      `Home's chat-home preview must show Grok's vouched reply, not the operator's own last prompt. Got: ${JSON.stringify(previews[0])}`,
    );
  });
});
