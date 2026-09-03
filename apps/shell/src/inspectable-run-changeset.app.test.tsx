// Journey tests for GATE Q bounce: live Review dock from durable envelopes
// (no live file_edit) and catch-up close after GET /api/runs restore.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import { CHANGES_DOCK_LABEL } from "./ChangesDock";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "review-session";
const RUN_ID = "review-run";
const R1_DIFF = "--- a/r1.txt\n+++ b/r1.txt\n@@ -0,0 +1 @@\n+one";
const R2_DIFF = "--- a/r2.txt\n+++ b/r2.txt\n@@ -0,0 +1 @@\n+two";

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
        title: "Review pending",
        messages: [{ id: "u1", role: "user", content: "stage two files" }],
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

function reviewSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "waiting_for_decision",
    acceptedPrompt: "stage two files",
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

function envelope(
  payload: RunEventEnvelope["payload"],
  seq: number,
): RunEventEnvelope {
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

function reviewActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a1",
    invocationId: "inv-r1",
    name: "write_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "r1.txt" },
    output: null,
    error: null,
    diff: R1_DIFF,
    path: "r1.txt",
    policy: { effectiveMode: "review" },
    automaticEligibility: "not_eligible",
    autoApplied: false,
    command: null,
    editId: "edit-r1",
    recovery: null,
    ...overrides,
  };
}

function reviewDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "req-r1",
    invocationId: "inv-r1",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "r1.txt",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

function pendingReviewEvents(): RunEventEnvelope[] {
  return [
    envelope({ kind: "run_started", run: reviewSnapshot({ lastEventSeq: 1 }) }, 1),
    envelope({
      kind: "activity_update",
      activity: reviewActivity(),
    }, 2),
    envelope({
      kind: "decision_request",
      request: reviewDecision(),
    }, 3),
    envelope({
      kind: "activity_update",
      activity: reviewActivity({
        activityId: "a2",
        invocationId: "inv-r2",
        path: "r2.txt",
        editId: "edit-r2",
        diff: R2_DIFF,
        input: { path: "r2.txt" },
      }),
    }, 4),
    envelope({
      kind: "decision_request",
      request: reviewDecision({
        requestId: "req-r2",
        invocationId: "inv-r2",
        detail: "r2.txt",
      }),
    }, 5),
  ];
}

function seedPersistedRun(lastEventSeq: number, ready = false): void {
  const activity = reviewActivity();
  const decision = reviewDecision();
  localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
    runs: [{
      ...reviewSnapshot({ lastEventSeq, state: "running" }),
      reasoning: {},
      answer: {},
      activities: ready ? { [activity.activityId]: activity } : {},
      decisions: ready ? { [decision.requestId]: decision } : {},
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

describe("inspectable-run-changeset App wiring (AC-07/11/12/16/25)", () => {
  it("live Review pending fills the sticky dock from decision_request + activity, with no file_edit", async () => {
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

    for (const ev of pendingReviewEvents()) {
      ws.emit(ev as unknown as Record<string, unknown>);
    }

    // Both r1.txt/r2.txt are backed by real "diff" decisions — the Changes
    // dock (Task 9) offers Accept/Reject directly on the row, from the same
    // queue the old (now-removed) DiffPanel read.
    const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    await waitFor(() => {
      assert.ok(within(dock).getByText("r1.txt"));
      assert.ok(within(dock).getByText("r2.txt"));
      assert.equal(within(dock).getAllByRole("button", { name: "Accept" }).length, 2);
      assert.equal(within(dock).getAllByRole("button", { name: "Reject" }).length, 2);
    });
    assert.equal(
      host.callsTo("/api/diff").length,
      0,
      "dock must be present before any settle call",
    );

    const user = userEvent.setup();
    await user.click(within(dock).getAllByRole("button", { name: "Accept" })[0]!);
    await waitFor(() => {
      assert.ok(host.callsTo("/api/diff").length >= 1);
    });
  });

  it("GET /api/runs restore closes catch-up from the applied snapshot and rebuilds the dock", async () => {
    seedPersistedRun(6);
    const replayRun = reviewSnapshot({ lastEventSeq: 8, state: "waiting_for_decision" });
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    }, {
      runJournals: {
        [RUN_ID]: {
          run: replayRun,
          events: pendingReviewEvents().filter((ev) => ev.eventSeq > 6),
        },
      },
    });
    // Restore after=6 needs the pending bodies in the 200. Host journals them
    // at seq 2–5 in a live run; for this reload fixture the high-water is 8
    // and the same durable envelopes are replayed as seq 7–8 plus identity.
    host.runJournals.set(RUN_ID, {
      run: replayRun,
      events: [
        envelope({ kind: "activity_update", activity: reviewActivity() }, 7),
        envelope({ kind: "decision_request", request: reviewDecision() }, 8),
      ],
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    await waitFor(() => {
      const section = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
      assert.ok(!section.textContent?.includes("Loading file changes"));
      assert.ok(section.textContent?.includes("r1.txt"));
      // req-r1 is a real "diff" decision — Accept/Reject render on the row
      // directly (Task 9), not a separate "Pending file edits" DiffPanel.
      assert.ok(within(section).getByRole("button", { name: "Accept" }));
      assert.ok(within(section).getByRole("button", { name: "Reject" }));
    });
    assert.ok(host.callsTo("/api/runs").length >= 1);
  });

  it("health-poll reconcile does not open Loading over a ready File changes list (W3)", async () => {
    let poll: (() => void) | undefined;
    setHealthPollTestScheduler((next) => {
      poll = next;
      return () => {
        poll = undefined;
      };
    });
    seedPersistedRun(8, true);
    const replayRun = reviewSnapshot({ lastEventSeq: 8, state: "waiting_for_decision" });
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
            envelope({ kind: "activity_update", activity: reviewActivity() }, 7),
            envelope({ kind: "decision_request", request: reviewDecision() }, 8),
          ],
        },
      },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      if (host.callsTo("/api/runs").length < 1) continue;
      const section = screen.queryByRole("region", { name: CHANGES_DOCK_LABEL });
      if (!section) continue;
      if (within(section).queryByText("Loading file changes…")) continue;
      break;
    }
    assert.ok(host.callsTo("/api/runs").length >= 1);
    const firstSection = screen.queryByRole("region", { name: CHANGES_DOCK_LABEL });
    assert.ok(firstSection);
    assert.equal(within(firstSection!).queryByText("Loading file changes…"), null);

    const runsBefore = host.callsTo("/api/runs").length;
    assert.ok(poll, "health-poll scheduler must be installed");
    poll();
    await waitFor(() => {
      assert.ok(host.callsTo("/api/runs").length > runsBefore);
    });
    assert.equal(screen.queryByText("Loading file changes…"), null);
    const section = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
    assert.ok(within(section).getByText("r1.txt"));
  });
});
