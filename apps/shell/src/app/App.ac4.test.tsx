// AC4 — Chat: tools confined to sandbox or user-bound folder; escape
// rejected. Confine enforcement itself is host-side and already verified
// (QA_REPORT §3/§5); this test is the shell's half: when the host refuses an
// escaping path, the failed tool_result must render as a visible failure in
// the transcript (not swallowed, not shown as success). Mocks the network
// boundary only (fetch + WebSocket); real App, real session store.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import type { ActivityRecord, RunEventEnvelope } from "../projections/runReducer";

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

describe("AC4 — Chat: an escaping path is rendered as a failed, visible tool result", () => {
  it("shows the confine rejection instead of swallowing or showing success", async () => {
    const host = createFakeHost({
      mode: "chat",
      chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New chat" }));
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "read ../../../../windows/win.ini");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    await waitFor(() => assert.ok(host.lastPromptRun));
    const target = host.lastPromptRun!;

    const pendingActivity: ActivityRecord = {
      activityId: "escape-activity",
      invocationId: "escape-1",
      name: "read_file",
      lifecycle: "pending",
      execution: null,
      status: "running",
      input: { path: "../../../../windows/win.ini" },
      output: null,
      error: null,
      diff: null,
      path: null,
      policy: {},
      automaticEligibility: "not_eligible",
      autoApplied: false,
      command: null,
      editId: null,
      recovery: null,
      summary: null,
    };
    const rejectedActivity: ActivityRecord = {
      ...pendingActivity,
      lifecycle: "terminal",
      execution: "not_executed",
      status: "rejected",
      error: "Path escapes workspace",
      summary: "Path escapes workspace",
    };
    ws.emit(envelope(target, 1, { kind: "activity_update", activity: pendingActivity }) as unknown as Record<string, unknown>);
    ws.emit(envelope(target, 2, { kind: "activity_update", activity: rejectedActivity }) as unknown as Record<string, unknown>);
    ws.emit(envelope(target, 3, {
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "I can't read outside your folder.",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }) as unknown as Record<string, unknown>);

    // Failed tool runs open by default (Receipts: hasFail => open).
    await waitFor(() => {
      const activity = document.querySelector('[data-tool-activity].fail');
      assert.ok(activity, "expected a failed tool-activity group, not a silent drop");
    });
    await waitFor(() => {
      assert.ok(screen.getAllByText(/Path escapes workspace/).length >= 1);
    });
    // Never rendered as a successful tool run.
    assert.equal(document.querySelector('[data-tool-activity].ok'), null);

    // The chat-side non-dev wording also surfaces (SPEC §5: "Chat UX
    // non-dev wording"), and the run did not silently die — a reply followed.
    await waitFor(() => {
      assert.ok(screen.getByText(/can't read outside your folder/i));
    });
  });
});
