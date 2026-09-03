// Journey tests: FakeHost WS + GET /api/runs catch-up for Git review membership.
//
// Git review moved from an in-stream RunSurface section into the (tabbed)
// Changes dock in Task 9 — see ChangesDock.tsx. These journeys were rewritten
// against the dock: query the single "Changes" region, click into its "Git"
// tab instead of expanding an in-stream accordion, and drop the old
// "View output" affordance (jumping from a Git row to its Activity receipt),
// which the Task 9 redesign removed — the dock is a rows-only surface now.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import { CHANGES_DOCK_LABEL, GIT_REVIEW_LOAD_FAILURE } from "./ChangesDock";
import type { ActivityRecord, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "git-review-session";
const RUN_ID = "git-review-run";

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
        title: "Git review run",
        messages: [{ id: "u1", role: "user", content: "inspect git" }],
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

function gitSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "inspect git",
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

function gitActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-status",
    invocationId: "inv-status",
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { command: "git status -sb" },
    output: "## main\n M dirty.txt\n",
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
    command: "git status -sb",
    editId: null,
    recovery: null,
    ...overrides,
  };
}

function seedPersistedRun(lastEventSeq: number, ready = false): void {
  const activity = gitActivity();
  localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
    runs: [{
      ...gitSnapshot({ lastEventSeq, state: "running" }),
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

describe("git-review-surface App wiring", () => {
  it("live WS git activities fill the Changes dock's Git tab without hunting activity rows", async () => {
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

    ws.emit(envelope({ kind: "run_started", run: gitSnapshot({ lastEventSeq: 1 }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "activity_update",
      activity: gitActivity(),
    }, 2) as unknown as Record<string, unknown>);

    const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    const user = userEvent.setup();
    await user.click(within(dock).getByRole("tab", { name: /Git/i }));
    await waitFor(() => {
      assert.ok(within(dock).getByText("git status -sb"));
    });

    ws.emit(envelope({
      kind: "activity_update",
      activity: gitActivity({
        activityId: "a-diff",
        invocationId: "inv-diff",
        command: "git diff",
        input: { command: "git diff" },
        output: "diff --git a/dirty.txt b/dirty.txt\n",
      }),
    }, 3) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(within(dock).getByText("git diff"));
    });
    assert.ok(within(dock).getByText("git status -sb"));
    assert.equal(host.callsTo("/api/diff").length, 0);
    assert.equal(host.callsTo("/api/edit-recovery").length, 0);
    assert.equal(host.callsTo("/api/permission").length, 0);
    const text = (dock.textContent ?? "").toLowerCase();
    assert.equal(text.includes("working tree clean"), false);
    assert.equal(text.includes("pr ready"), false);
  });

  it("GET /api/runs restore rebuilds the same Git review membership", async () => {
    seedPersistedRun(6);
    const replayRun = gitSnapshot({ lastEventSeq: 8, state: "terminal", terminalKind: "answered", finalAnswer: "done", answerVouched: true });
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
            envelope({ kind: "activity_update", activity: gitActivity() }, 7),
            envelope({
              kind: "activity_update",
              activity: gitActivity({
                activityId: "a-diff",
                invocationId: "inv-diff",
                command: "git diff",
                input: { command: "git diff" },
                output: "diff --git a/dirty.txt b/dirty.txt\n",
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
    await user.click(within(dock).getByRole("tab", { name: /Git/i }));
    await waitFor(() => {
      assert.ok(within(dock).getByText("git status -sb"));
      assert.ok(within(dock).getByText("git diff"));
    });
    assert.ok(host.callsTo("/api/runs").length >= 1);
  });

  it("catch-up GET failure shows load-failure copy, not empty (AC-14)", async () => {
    seedPersistedRun(6);
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    const user = userEvent.setup();
    await user.click(within(dock).getByRole("tab", { name: /Git/i }));
    await waitFor(() => {
      assert.equal(
        (document.body?.innerHTML ?? "").includes(GIT_REVIEW_LOAD_FAILURE),
        true,
      );
    });
  });

  it("health-poll reconcile does not open Loading over a ready Git review list (W3)", async () => {
    let poll: (() => void) | undefined;
    setHealthPollTestScheduler((next) => {
      poll = next;
      return () => {
        poll = undefined;
      };
    });
    seedPersistedRun(8, true);
    const replayRun = gitSnapshot({ lastEventSeq: 8, state: "running" });
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
            envelope({ kind: "activity_update", activity: gitActivity() }, 7),
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
      assert.equal(within(dock).queryByText("Loading file changes…"), null);
    });

    const user = userEvent.setup();
    await user.click(within(dock).getByRole("tab", { name: /Git/i }));
    assert.ok(within(dock).getByText("git status -sb"));

    const runsBefore = host.callsTo("/api/runs").length;
    assert.ok(poll, "health-poll scheduler must be installed");
    poll();
    await waitFor(() => {
      assert.ok(host.callsTo("/api/runs").length > runsBefore);
    });
    assert.equal(within(dock).queryByText("Loading git review…"), null);
    assert.ok(within(dock).getByText("git status -sb"));
  });

  it("Chat mode does not present a Changes dock", async () => {
    const chatRoot = "C:\\Users\\qa\\.grokforge\\chat-sandbox";
    reloadSessionsFromDisk({
      byWorkspace: {
        [chatRoot]: [{
          id: SESSION_ID,
          workspace: chatRoot,
          title: "Chat git",
          messages: [{ id: "u1", role: "user", content: "git status" }],
          updatedAt: Date.now(),
          status: "live",
          subagents: [],
          open: true,
        }],
      },
      activeId: { [chatRoot]: SESSION_ID },
      pinned: [chatRoot],
      expanded: [chatRoot],
    });
    const host = createFakeHost({
      mode: "chat",
      chatRoot,
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => {
      assert.ok(screen.queryByLabelText("Message to agent"));
    });
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: gitSnapshot({ lastEventSeq: 1 }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: gitActivity() }, 2) as unknown as Record<string, unknown>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }), null);
    assert.equal((document.body?.innerHTML ?? "").includes("Git review"), false);
  });
});
