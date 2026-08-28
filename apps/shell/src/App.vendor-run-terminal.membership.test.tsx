import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { ActivityRecord, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_A = "vendor-terminal-session-a";
const SESSION_B = "vendor-terminal-session-b";
const RUN_A = "vendor-terminal-run-a";
const RUN_B = "vendor-terminal-run-b";
const TOOL_COUNT = 30;

const vendorFact = {
  resolveStatus: "ready" as const,
  identity: "vendor" as const,
  fallbackReason: null,
};

function resetBrowserState(activeId = SESSION_A): void {
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
      [WORKSPACE]: [
        {
          id: SESSION_A,
          workspace: WORKSPACE,
          title: "Prior spire-tech",
          messages: [{ id: "u-a", role: "user", content: "run the tools" }],
          updatedAt: Date.now() - 1000,
          status: "live",
          subagents: [],
          open: true,
        },
        {
          id: SESSION_B,
          workspace: WORKSPACE,
          title: "Brand new",
          messages: [],
          updatedAt: Date.now(),
          status: "idle",
          subagents: [],
          open: true,
        },
      ],
    },
    activeId: { [WORKSPACE]: activeId },
    pinned: [WORKSPACE],
    expanded: [WORKSPACE],
  });
  FakeWebSocket.reset();
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_A,
    runId: RUN_A,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "run the tools",
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
  opts: { sessionId?: string; runId?: string; generation?: number } = {},
): RunEventEnvelope {
  const sessionId = opts.sessionId ?? SESSION_A;
  const runId = opts.runId ?? RUN_A;
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId,
    runId,
    eventSeq: seq,
    connectionGeneration: opts.generation ?? 1,
    occurredAt: "",
    payload,
  };
}

function toolActivity(index: number, lifecycle: "pending" | "terminal" = "terminal"): ActivityRecord {
  const fail = index === 0;
  return {
    activityId: `tool-${index}`,
    invocationId: `tool-${index}`,
    name: fail ? "codex_fail" : "list_dir",
    lifecycle,
    execution: lifecycle === "terminal" ? (fail ? "executed" : "executed") : null,
    status: lifecycle === "terminal" ? (fail ? "failed" : "succeeded") : "running",
    input: {},
    output: fail ? null : ".",
    error: fail ? "boom" : null,
    diff: null,
    path: fail ? null : ".",
    policy: {},
    automaticEligibility: "read",
    autoApplied: false,
    command: fail ? null : "ls",
    editId: null,
    recovery: null,
    summary: fail ? "Codex fail" : `list dir ${index}`,
    title: fail ? "Codex fail" : `list dir ${index}`,
  };
}

function foreignLeakVisible(): boolean {
  const text = document.body.textContent ?? "";
  return text.includes("Codex fail") || text.includes("list dir 7") || text.includes("list dir 29");
}

function activityRailCount(): number {
  return screen.queryAllByLabelText("Activity").length;
}

async function mountApp() {
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
    connected: true,
    hasApiKey: true,
    codeAgent: vendorFact,
    planEngagement: { engaged: false, vouched: true },
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
}

async function paintSessionATools(ws: FakeWebSocket): Promise<void> {
  ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
  for (let i = 0; i < TOOL_COUNT; i++) {
    ws.emit(
      envelope({ kind: "activity_update", activity: toolActivity(i) }, i + 2) as unknown as Record<string, unknown>,
    );
  }
  await waitFor(() => {
    assert.ok(screen.getByText("Codex fail"));
    assert.ok(screen.getByText("list dir 29"));
    assert.equal(activityRailCount() >= 1, true);
  });
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
  resetBrowserState(SESSION_A);
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
});

describe("vendor-run-terminal membership (Activity live-paint isolation)", () => {
  it("brand-new / switched session B never paints session A's tool rail, including after first ping", async () => {
    const { ws } = await mountApp();
    await paintSessionATools(ws);

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: /Brand new/ }));
    await waitFor(() => {
      assert.equal(activityRailCount(), 0);
      assert.equal(foreignLeakVisible(), false);
      assert.equal(screen.queryByText("Tool activity"), null);
      assert.equal(screen.queryByText(/Tools\(0\)/), null);
    });

    await user.type(screen.getByLabelText("Message to agent"), "ping");
    await user.click(screen.getByRole("button", { name: "Send" }));

    ws.emit(
      envelope(
        { kind: "run_started", run: runSnapshot({ sessionId: SESSION_B, runId: RUN_B, acceptedPrompt: "ping" }) },
        1,
        { sessionId: SESSION_B, runId: RUN_B },
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(document.querySelector(`[data-run-id="${RUN_B}"]`)));
    assert.equal(foreignLeakVisible(), false);
    assert.equal(screen.queryByText(/Tools\(0\)/), null);

    for (let i = 0; i < TOOL_COUNT; i++) {
      ws.emit(
        envelope({ kind: "activity_update", activity: toolActivity(i) }, i + 40) as unknown as Record<string, unknown>,
      );
    }
    await waitFor(() => assert.ok(document.querySelector(`[data-run-id="${RUN_B}"]`)));
    assert.equal(foreignLeakVisible(), false, "session A tool identities must not paint on B after first ping");
    assert.equal(screen.queryByText("Codex fail"), null);
    assert.equal(activityRailCount(), 0);

    ws.emit(
      envelope(
        { kind: "activity_update", activity: toolActivity(3) },
        2,
        { sessionId: SESSION_B, runId: RUN_B },
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(screen.getByText("list dir 3"));
    });
    assert.equal(screen.queryByText("Codex fail"), null);
    assert.equal(screen.queryByText("list dir 29"), null);

    const prior = screen.getAllByRole("button").find((el) =>
      /Prior spire-tech|run the tools/.test(el.textContent ?? ""),
    );
    assert.ok(prior, "session A remains in the sidebar (not a process-global wipe)");
    await user.click(prior);
    await waitFor(() => {
      assert.ok(screen.getByText("Codex fail"));
      assert.ok(screen.getByText("list dir 29"));
    });
  });

  it("hydrate keeps this session's journaled tools and excludes foreign; generation is not a wipe", async () => {
    const bTool = toolActivity(3);
    const aActivities: Record<string, ActivityRecord> = {};
    for (let i = 0; i < TOOL_COUNT; i++) aActivities[`tool-${i}`] = toolActivity(i);
    localStorage.setItem(
      "grokforge.runProjection.v1",
      JSON.stringify({
        runs: [
          {
            ...runSnapshot({
              state: "terminal",
              terminalKind: "answered",
              finalAnswer: "done",
              answerVouched: true,
              lastEventSeq: TOOL_COUNT + 2,
            }),
            reasoning: {},
            answer: {},
            message: {},
            activities: aActivities,
            decisions: {},
            seenEventSeq: Array.from({ length: TOOL_COUNT + 2 }, (_, i) => i + 1),
            terminalEventSeq: TOOL_COUNT + 2,
          },
          {
            ...runSnapshot({
              sessionId: SESSION_B,
              runId: RUN_B,
              acceptedPrompt: "ping",
              state: "terminal",
              terminalKind: "answered",
              finalAnswer: "pong",
              answerVouched: true,
              lastEventSeq: 3,
            }),
            reasoning: {},
            answer: {},
            message: { m: "pong" },
            activities: { "tool-3": bTool },
            decisions: {},
            seenEventSeq: [1, 2, 3],
            terminalEventSeq: 3,
          },
        ],
        cursors: { [SESSION_A]: TOOL_COUNT + 2, [SESSION_B]: 3 },
      }),
    );
    resetBrowserState(SESSION_B);
    localStorage.setItem(
      "grokforge.runProjection.v1",
      JSON.stringify({
        runs: [
          {
            ...runSnapshot({
              state: "terminal",
              terminalKind: "answered",
              finalAnswer: "done",
              answerVouched: true,
              lastEventSeq: TOOL_COUNT + 2,
            }),
            reasoning: {},
            answer: {},
            message: {},
            activities: aActivities,
            decisions: {},
            seenEventSeq: Array.from({ length: TOOL_COUNT + 2 }, (_, i) => i + 1),
            terminalEventSeq: TOOL_COUNT + 2,
          },
          {
            ...runSnapshot({
              sessionId: SESSION_B,
              runId: RUN_B,
              acceptedPrompt: "ping",
              state: "terminal",
              terminalKind: "answered",
              finalAnswer: "pong",
              answerVouched: true,
              lastEventSeq: 3,
            }),
            reasoning: {},
            answer: {},
            message: { m: "pong" },
            activities: { "tool-3": bTool },
            decisions: {},
            seenEventSeq: [1, 2, 3],
            terminalEventSeq: 3,
          },
        ],
        cursors: { [SESSION_A]: TOOL_COUNT + 2, [SESSION_B]: 3 },
      }),
    );

    const { ws } = await mountApp();
    await waitFor(() => {
      assert.ok(document.querySelector(`[data-run-id="${RUN_B}"]`));
      assert.ok(screen.getByText("list dir 3"));
    });
    assert.equal(screen.queryByText("Codex fail"), null);
    assert.equal(screen.queryByText("list dir 29"), null);

    ws.emit(
      envelope(
        { kind: "run_state", state: "running", liveness: "provider" },
        4,
        { sessionId: SESSION_B, runId: RUN_B, generation: 99 },
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(screen.getByText("list dir 3"));
    });
    assert.equal(screen.queryByText("Codex fail"), null);
  });
});
