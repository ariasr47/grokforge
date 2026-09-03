import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type {
  BrowserWorkMember,
  ChildAgentMember,
  ChildAgentsMembershipFact,
  CodeAgentFact,
  HookMember,
  HooksMembershipFact,
  McpServerMember,
  McpServersMembershipFact,
} from "./api";
import type { RunEventEnvelope, RunSnapshot } from "./runReducer";
import { CHILD_AGENTS_HEADER, CHILD_AGENTS_STATUS_RUNNING } from "./childAgentsProjection";
import { BROWSER_HEADER, BROWSER_STATUS_RUNNING } from "./browserWorkProjection";
import { MCP_HEADER, MCP_STATUS_CONNECTED } from "./mcpServersProjection";
import { HOOKS_HEADER, HOOKS_STATUS_RUNNING } from "./hooksProjection";

const WORKSPACE = "C:\\repo";
const SESSION_A = "vendor-observe-session-a";
const SESSION_B = "vendor-observe-session-b";
const RUN_A = "vendor-observe-run-a";
const RUN_B = "vendor-observe-run-b";

const vendorFact: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "vendor",
  fallbackReason: null,
};

const researcher: ChildAgentMember = {
  childId: "child-a",
  identityLabel: "Researcher",
  status: "running",
  firstEventSeq: 2,
};
const docsFetch: BrowserWorkMember = {
  toolCallId: "fetch-a",
  acpToolKind: "fetch",
  url: "https://docs.x.ai",
  title: "Docs page",
  status: "running",
  snapshotJournaled: false,
  restore: "restored",
  firstEventSeq: 2,
};
const docsConnected: McpServerMember = {
  serverId: "mcp-a",
  name: "Docs",
  status: "connected",
  restore: "restored",
  firstEventSeq: 2,
};
const preTool: HookMember = {
  hookId: "hook-a",
  name: "PreTool",
  status: "running",
  restore: "restored",
  firstEventSeq: 2,
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
          title: "Observe A",
          messages: [{ id: "u-a", role: "user", content: "hello" }],
          updatedAt: Date.now() - 1000,
          status: "live",
          subagents: [],
          open: true,
        },
        {
          id: SESSION_B,
          workspace: WORKSPACE,
          title: "Observe B",
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
    acceptedPrompt: "hello",
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
  opts: { sessionId?: string; runId?: string } = {},
): RunEventEnvelope {
  const sessionId = opts.sessionId ?? SESSION_A;
  const runId = opts.runId ?? RUN_A;
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

async function mountApp(opts: {
  childAgents?: ChildAgentsMembershipFact;
  browserWork?: { disposition: string; members: BrowserWorkMember[] | null };
  mcpServers?: McpServersMembershipFact;
  hooks?: HooksMembershipFact;
} = {}) {
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
    connected: true,
    hasApiKey: true,
    codeAgent: vendorFact,
    planEngagement: { engaged: false, vouched: true },
    childAgents: opts.childAgents ?? { disposition: "ready", members: [researcher] },
    browserWork: (opts.browserWork as never) ?? { disposition: "ready", members: [docsFetch] },
    mcpServers: opts.mcpServers ?? { disposition: "ready", members: [docsConnected] },
    hooks: opts.hooks ?? { disposition: "ready", members: [preTool] },
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
}

function observeLeaked(): boolean {
  const text = document.body.textContent ?? "";
  return (
    Boolean(screen.queryByLabelText(CHILD_AGENTS_HEADER)) ||
    Boolean(screen.queryByLabelText(BROWSER_HEADER)) ||
    Boolean(screen.queryByLabelText(MCP_HEADER)) ||
    Boolean(screen.queryByLabelText(HOOKS_HEADER)) ||
    text.includes("Researcher") ||
    text.includes("Docs page") ||
    text.includes("PreTool")
  );
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

describe("vendor-run-terminal observe chrome isolation", () => {
  it("new/switched session B does not inherit A's child/browser/MCP/hooks; quiet absent when empty", async () => {
    const { ws } = await mountApp();
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(
      envelope(
        {
          kind: "child_agent_update",
          childId: researcher.childId,
          identityLabel: researcher.identityLabel,
          status: researcher.status,
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      const children = screen.getByLabelText(CHILD_AGENTS_HEADER);
      assert.ok(children.textContent?.includes("Researcher"));
      assert.ok(children.textContent?.includes(CHILD_AGENTS_STATUS_RUNNING));
      const browser = screen.getByLabelText(BROWSER_HEADER);
      assert.ok(browser.textContent?.includes("Docs page"));
      assert.ok(browser.textContent?.includes(BROWSER_STATUS_RUNNING));
      const mcp = screen.getByLabelText(MCP_HEADER);
      assert.ok(mcp.textContent?.includes("Docs"));
      assert.ok(mcp.textContent?.includes(MCP_STATUS_CONNECTED));
      const hooks = screen.getByLabelText(HOOKS_HEADER);
      assert.ok(hooks.textContent?.includes("PreTool"));
      assert.ok(hooks.textContent?.includes(HOOKS_STATUS_RUNNING));
    });

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: /Observe B/ }));
    await waitFor(() => {
      assert.equal(document.querySelector(`[data-run-id="${RUN_A}"]`), null);
      assert.equal(observeLeaked(), false);
    });

    ws.emit(
      envelope(
        { kind: "run_started", run: runSnapshot({ sessionId: SESSION_B, runId: RUN_B, acceptedPrompt: "ping" }) },
        1,
        { sessionId: SESSION_B, runId: RUN_B },
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(document.querySelector(`[data-run-id="${RUN_B}"]`)));
    assert.equal(observeLeaked(), false);
    assert.equal(screen.queryByLabelText(CHILD_AGENTS_HEADER) === null, true);
    assert.equal(screen.queryByLabelText(BROWSER_HEADER) === null, true);
    assert.equal(screen.queryByLabelText(MCP_HEADER) === null, true);
    assert.equal(screen.queryByLabelText(HOOKS_HEADER) === null, true);
  });
});
