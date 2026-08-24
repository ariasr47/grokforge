// Journey tests: FakeHost WS + GET /api/runs catch-up for Verify membership.
// Live-host Trusted/Review deny paths remain verification-track V4 after B1.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import { VERIFY_HEADER, VERIFY_LIVE_GROWING, VERIFY_LOADING, VERIFY_VIEW_OUTPUT } from "./VerifySection";
import { FILE_CHANGES_HEADER } from "./FileChangesSection";
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
  it("live WS verify activities fill one Verify list without hunting activity rows (AC-01/11)", async () => {
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

    await waitFor(() => {
      assert.ok(screen.getByRole("region", { name: VERIFY_HEADER }));
    });
    assert.ok(screen.getByText(VERIFY_LIVE_GROWING));

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
      const section = screen.getByRole("region", { name: VERIFY_HEADER });
      assert.ok(within(section).getByText("2"));
    });

    const user = userEvent.setup();
    const section = screen.getByRole("region", { name: VERIFY_HEADER });
    await user.click(within(section).getByRole("button", { name: /Verify/i }));
    assert.ok(within(section).getByText("npm test"));
    assert.ok(within(section).getByText("npm run typecheck"));
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

    await waitFor(() => {
      const section = document.querySelector('[aria-label="Verify"]');
      assert.ok(section);
      assert.equal(section.className.includes("loading"), false);
      assert.ok(section.textContent?.includes("2"));
    });
    assert.ok(host.callsTo("/api/runs").length >= 1);
    const user = userEvent.setup();
    const section = screen.getByRole("region", { name: VERIFY_HEADER });
    await user.click(within(section).getByRole("button", { name: /Verify/i }));
    await user.click(within(section).getAllByRole("button", { name: VERIFY_VIEW_OUTPUT })[0]!);
    const row = document.querySelector('[data-activity-id="a-test"]') as HTMLDetailsElement | null;
    assert.ok(row);
    assert.equal(row.open, true);
    assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
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
    await waitFor(() => {
      assert.ok(host.callsTo("/api/runs").length >= 1);
      const section = document.querySelector('[aria-label="Verify"]');
      assert.ok(section);
      assert.ok(!section.className.includes("verify-loading-state"));
    });

    const runsBefore = host.callsTo("/api/runs").length;
    assert.ok(poll, "health-poll scheduler must be installed");
    poll();
    await waitFor(() => {
      assert.ok(host.callsTo("/api/runs").length > runsBefore);
    });
    assert.equal(screen.queryByText(VERIFY_LOADING), null);
    const section = screen.getByRole("region", { name: VERIFY_HEADER });
    assert.ok(within(section).getByText("1"));
  });

});
