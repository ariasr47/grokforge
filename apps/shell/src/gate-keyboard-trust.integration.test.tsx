import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";

// F1 + F4: both findings are about the same trust gap — a bare, unmodified
// key (S/Y/N for F1, Digit1-3 for F4) must never settle a gate the operator
// was not actually looking at. `inEditable` alone only rules out text
// fields; these tests prove the newer `dockOwnsFocus` requirement closes the
// rest of the gap, at the one level (a mounted App) where App.tsx's global
// tinykeys map can actually be exercised.

const WORKSPACE = "C:\\repo";
const SESSION_ID = "gate-trust-session";
const RUN_ID = "gate-trust-run";

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

function baseSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "restore the last edit",
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

test("F1: a bare S grants nothing unless the action dock owns focus — the same key grants once focus genuinely moves there", async () => {
  seedFirstRun();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
  const host = createFakeHost({ mode: "chat", workspace: WORKSPACE, workspaceName: "repo", busy: false });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  const composer = await screen.findByLabelText("Message to agent");
  const user = userEvent.setup();
  await user.type(composer, "run tests");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const socket = FakeWebSocket.latest();
  assert.ok(socket);
  socket!.emit({ type: "permission_request", id: "perm-1", kind: "shell", detail: "npm test" });

  const dock = await screen.findByRole("region", { name: "Pending agent actions" });
  within(dock).getByRole("region", { name: "Grok wants to run a command" });

  // Attention is elsewhere: neither an editable field (already guarded by
  // inEditable) nor the dock itself — e.g. focus sitting on document.body,
  // same as "nothing in particular is focused". A bare S must do nothing:
  // no POST to settle the permission, and the gate is still showing.
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.keyDown(document.body, { key: "s", code: "KeyS" });
  within(dock).getByRole("region", { name: "Grok wants to run a command" });
  assert.equal(host.callsTo("/api/permission").length, 0);

  // Focus genuinely lands in the dock (e.g. tabbing to Deny, or the dock's
  // own open-focus) — the identical bare key now settles it for real.
  const denyBtn = within(dock).getByRole("button", { name: "Deny" });
  denyBtn.focus();
  fireEvent.keyDown(denyBtn, { key: "s", code: "KeyS" });
  await waitFor(() => {
    const calls = host.callsTo("/api/permission");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.body?.decision, "allow_session");
  });
});

test("F4: Digit1 chooses the ask gate's option only while the action dock owns focus", async () => {
  seedFirstRun();
  reloadSessionsFromDisk({
    byWorkspace: {
      [WORKSPACE]: [
        {
          id: SESSION_ID,
          workspace: WORKSPACE,
          title: "Gate trust",
          messages: [{ id: "u1", role: "user", content: "restore the last edit" }],
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
  const host = createFakeHost({ mode: "code", workspace: WORKSPACE, workspaceName: "repo", busy: false });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  const ws = FakeWebSocket.latest()!;

  ws.emit(envelope({ kind: "run_started", run: baseSnapshot() }, 1) as unknown as Record<string, unknown>);
  const activity = {
    activityId: "act-1",
    invocationId: "inv-1",
    name: "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: null,
    path: "src/a.ts",
    policy: { effectiveMode: "review" },
    automaticEligibility: "none",
    autoApplied: false,
    command: null,
    editId: "edit-1",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
  } as unknown as ActivityRecord;
  ws.emit(envelope({ kind: "activity_update", activity }, 2) as unknown as Record<string, unknown>);
  const decision: DecisionRequest = {
    requestId: "rec-1",
    invocationId: "inv-1",
    kind: "recovery_confirmation",
    status: "pending",
    title: "Restore?",
    detail: "Restore edit-1 to its state before the last write?",
    expiresAt: null,
    policy: { effectiveMode: "review" },
  };
  ws.emit(envelope({ kind: "decision_request", request: decision }, 3) as unknown as Record<string, unknown>);

  const dock = await screen.findByRole("region", { name: "Pending agent actions" });
  const gate = await within(dock).findByRole("region", { name: "Grok has a question" });
  const recoverBtn = within(gate).getByRole("button", { name: "Recover" });

  // Focus elsewhere (not the dock): Digit1 must not act.
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.keyDown(document.body, { key: "1", code: "Digit1" });
  assert.equal(host.callsTo("/api/edit-recovery").length, 0);

  // Focus the option itself (not a click — proving the keyboard path, not
  // the click handler): Digit1 now fires the same action Recover's click
  // would.
  recoverBtn.focus();
  fireEvent.keyDown(recoverBtn, { key: "1", code: "Digit1" });
  await waitFor(() => assert.equal(host.callsTo("/api/edit-recovery").length, 1));
});
