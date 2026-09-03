// Journey tests: FakeHost WS + GET /api/runs catch-up for Verify membership.
// Live-host Trusted/Review deny paths remain verification-track V4 after B1.
//
// Verify moved from an in-stream RunSurface section into the (tabbed) Changes
// dock in Task 9 — see ChangesDock.tsx. These journeys were rewritten against
// the dock: query the single "Changes" region, click into its "Verify" tab
// instead of expanding an in-stream accordion, and drop the old "View output"
// affordance (jumping from a Verify row to its Activity receipt), which the
// Task 9 redesign removed — the dock is a rows-only surface now.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import { CHANGES_DOCK_LABEL } from "./ChangesDock";
import type { ActivityRecord, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "verify-session";
const RUN_ID = "verify-run";

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
        title: "Check run",
        messages: [{ id: "u1", role: "user", content: "run tests" }],
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

function verifySnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "run tests",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "trusted_workspace" },
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

function verifyActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-test",
    invocationId: "inv-test",
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { command: "npm test" },
    output: "ok",
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
    command: "npm test",
    editId: null,
    recovery: null,
    ...overrides,
  };
}

function seedPersistedRun(lastEventSeq: number, ready = false): void {
  const activity = verifyActivity();
  localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
    runs: [{
      ...verifySnapshot({ lastEventSeq, state: "running" }),
      reasoning: {},
      answer: {},
      activities: ready ? { [activity.activityId]: activity } : {},
      decisions: {},
      seenEventSeq: lastEventSeq > 0 ? [1] : [],
      terminalEventSeq: null,
    }],
    cursors: { [SESSION_ID]: lastEventSeq },
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

describe("structured-test-panel App wiring", () => {
  it("live WS verify activities fill the Changes dock's Verify tab without hunting activity rows (AC-01/11)", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Message to agent"));
    });
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;

    ws.emit(envelope({ kind: "run_started", run: verifySnapshot({ lastEventSeq: 1 }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "activity_update",
      activity: verifyActivity(),
    }, 2) as unknown as Record<string, unknown>);

    const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    const user = userEvent.setup();
    await user.click(within(dock).getByRole("tab", { name: /Verify/i }));
    await waitFor(() => {
      assert.ok(within(dock).getByText("npm test"));
    });

    ws.emit(envelope({
      kind: "activity_update",
      activity: verifyActivity({
        activityId: "a-tsc",
        invocationId: "inv-tsc",
        command: "npm run typecheck",
        input: { command: "npm run typecheck" },
      }),
    }, 3) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(within(dock).getByText("npm run typecheck"));
    });
    assert.ok(within(dock).getByText("npm test"));
    assert.equal(host.callsTo("/api/diff").length, 0);
    assert.equal(host.callsTo("/api/edit-recovery").length, 0);
  });

  it("GET /api/runs restore rebuilds the same Verify membership (AC-12/14)", async () => {
    seedPersistedRun(6);
    const replayRun = verifySnapshot({ lastEventSeq: 8, state: "terminal", terminalKind: "answered", finalAnswer: "done", answerVouched: true });
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    }, {
      runJournals: {
        [RUN_ID]: {
          run: replayRun,
          events: [
            envelope({ kind: "activity_update", activity: verifyActivity() }, 7),
            envelope({
              kind: "activity_update",
              activity: verifyActivity({
                activityId: "a-tsc",
                invocationId: "inv-tsc",
                command: "npm run typecheck",
                input: { command: "npm run typecheck" },
              }),
            }, 8),
          ],
        },
      },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    const user = userEvent.setup();
    await user.click(within(dock).getByRole("tab", { name: /Verify/i }));
    await waitFor(() => {
      assert.ok(within(dock).getByText("npm test"));
      assert.ok(within(dock).getByText("npm run typecheck"));
    });
    assert.ok(host.callsTo("/api/runs").length >= 1);
  });

  it("health-poll reconcile does not open Loading over a ready Verify list (W3)", async () => {
    let poll: (() => void) | undefined;
    setHealthPollTestScheduler((next) => {
      poll = next;
      return () => {
        poll = undefined;
      };
    });
    seedPersistedRun(8, true);
    const replayRun = verifySnapshot({ lastEventSeq: 8, state: "running" });
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    }, {
      runJournals: {
        [RUN_ID]: {
          run: replayRun,
          events: [
            envelope({ kind: "activity_update", activity: verifyActivity() }, 7),
          ],
        },
      },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    await waitFor(() => {
      assert.ok(host.callsTo("/api/runs").length >= 1);
      assert.equal(within(dock).queryByText("Loading file changes…") === null, true);
    });

    const user = userEvent.setup();
    await user.click(within(dock).getByRole("tab", { name: /Verify/i }));
    assert.ok(within(dock).getByText("npm test"));

    const runsBefore = host.callsTo("/api/runs").length;
    assert.ok(poll, "health-poll scheduler must be installed");
    poll();
    await waitFor(() => {
      assert.ok(host.callsTo("/api/runs").length > runsBefore);
    });
    assert.equal(within(dock).queryByText("Loading verify results…") === null, true);
    assert.ok(within(dock).getByText("npm test"));
  });
});
