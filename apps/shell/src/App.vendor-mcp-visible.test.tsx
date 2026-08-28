import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type {
  BrowserWorkMember,
  ChildAgentMember,
  ChildAgentsMembershipFact,
  CodeAgentFact,
  McpServerMember,
  McpServersMembershipFact,
} from "./api";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";
import {
  MCP_FAILED,
  MCP_GENERIC_IDENTITY,
  MCP_HEADER,
  MCP_LOADING,
  MCP_OFFLINE,
  MCP_RECONNECT_SHORT,
  MCP_STATUS_CONNECTED,
  MCP_STATUS_ERROR,
  MCP_STATUS_IDLE,
  MCP_UNAVAILABLE,
} from "./mcpServersProjection";
import { BROWSER_HEADER, BROWSER_STATUS_RUNNING } from "./browserWorkProjection";
import { CHILD_AGENTS_HEADER, CHILD_AGENTS_STATUS_RUNNING } from "./childAgentsProjection";
import { FILE_CHANGES_HEADER } from "./FileChangesSection";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "vendor-mcp-visible-session";
const RUN_ID = "vendor-mcp-visible-run";
const TURN_COPY = "Your turn — type the next message below";

const vendorFact: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "vendor",
  fallbackReason: null,
};
const fallbackCliFact: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "fallback",
  fallbackReason: "cli_missing",
};
const hardFailFact: CodeAgentFact = {
  resolveStatus: "hard_fail",
  identity: "hard_fail",
  fallbackReason: null,
};

const docsConnected: McpServerMember = {
  serverId: "s1",
  name: "Docs",
  status: "connected",
  restore: "restored",
  firstEventSeq: 2,
};
const searchIdle: McpServerMember = {
  serverId: "s2",
  name: "Search",
  status: "idle",
  restore: "restored",
  firstEventSeq: 3,
};
const authError: McpServerMember = {
  serverId: "s3",
  name: "Auth",
  status: "error",
  restore: "restored",
  firstEventSeq: 4,
};
const unrestorable: McpServerMember = {
  serverId: "gone",
  name: null,
  status: null,
  restore: "unrestorable",
  firstEventSeq: 5,
};
const unnamedIdle: McpServerMember = {
  serverId: "s-anon",
  name: null,
  status: "idle",
  restore: "restored",
  firstEventSeq: 6,
};

const docsFetch: BrowserWorkMember = {
  toolCallId: "f1",
  acpToolKind: "fetch",
  url: "https://docs.x.ai",
  title: "Docs page",
  status: "running",
  snapshotJournaled: false,
  restore: "restored",
  firstEventSeq: 2,
};
const researcher: ChildAgentMember = {
  childId: "child-1",
  identityLabel: "Researcher",
  status: "running",
  firstEventSeq: 2,
};

function resetMcpState(mode: "chat" | "code" = "code"): void {
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
  const partition = mode === "code" ? WORKSPACE : "chat:__sandbox__";
  reloadSessionsFromDisk({
    byWorkspace: {
      [partition]: [{
        id: SESSION_ID,
        workspace: partition,
        title: "MCP visible",
        messages: [{ id: "u1", role: "user", content: "hello" }],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [partition]: SESSION_ID },
    pinned: mode === "code" ? [WORKSPACE] : [],
    expanded: mode === "code" ? [WORKSPACE] : [],
  });
  FakeWebSocket.reset();
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
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

function readyFact(members: McpServerMember[]): McpServersMembershipFact {
  return { disposition: "ready", members };
}

function writeActivity(): ActivityRecord {
  return {
    activityId: "a-write",
    invocationId: "i-write",
    name: "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+hello",
    path: "src/a.ts",
    kind: "content",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e-write",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
  };
}

function shellPermission(): DecisionRequest {
  return {
    requestId: "req-shell",
    invocationId: "inv-shell",
    kind: "permission",
    status: "pending",
    title: "Run shell",
    detail: "npm test",
    expiresAt: null,
    policy: { effectiveMode: "review" },
  };
}

async function mountApp(opts: {
  mode?: "chat" | "code";
  codeAgent?: CodeAgentFact | null;
  mcpServers?: McpServersMembershipFact;
  browserWork?: { disposition: string; members: BrowserWorkMember[] | null };
  childAgents?: ChildAgentsMembershipFact;
  connected?: boolean;
} = {}) {
  const mode = opts.mode ?? "code";
  const vendorEligible = mode === "code" && (opts.codeAgent === undefined || opts.codeAgent?.identity === "vendor");
  const host = createFakeHost({
    mode,
    workspace: mode === "code" ? WORKSPACE : null,
    workspaceName: mode === "code" ? "repo" : null,
    busy: false,
    connected: opts.connected ?? true,
    hasApiKey: true,
    codeAgent: mode === "code" ? (opts.codeAgent === undefined ? vendorFact : opts.codeAgent) : null,
    childAgents: opts.childAgents ?? (
      vendorEligible
        ? { disposition: "ready", members: [] }
        : { disposition: "absent_non_code_or_non_vendor", members: null }
    ),
    browserWork: (opts.browserWork as never) ?? (
      vendorEligible
        ? { disposition: "ready", members: [] }
        : { disposition: "absent_for_non_code_or_non_vendor", members: null }
    ),
    mcpServers: opts.mcpServers ?? (
      vendorEligible
        ? readyFact([])
        : { disposition: "absent_for_non_code_or_non_vendor", members: null }
    ),
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
}

function mcpSection(): HTMLElement | null {
  return document.querySelector('[aria-label="MCP"]');
}

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;
let healthPoll: (() => void) | undefined;

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
  resetMcpState("code");
  healthPoll = undefined;
  setHealthPollTestScheduler((poll) => {
    healthPoll = poll;
    return () => {
      healthPoll = undefined;
    };
  });
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
  healthPoll = undefined;
});

describe("vendor-mcp-visible App journeys", () => {
  it("Code vendor ready members show MCP with names and Connected/Idle/Error", async () => {
    const { ws, host } = await mountApp({
      mcpServers: readyFact([docsConnected, searchIdle, authError]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText(MCP_HEADER));
      assert.ok(within(section).getByText("Docs"));
      assert.ok(within(section).getByText(MCP_STATUS_CONNECTED));
      assert.ok(within(section).getByText("Search"));
      assert.ok(within(section).getByText(MCP_STATUS_IDLE));
      assert.ok(within(section).getByText("Auth"));
      assert.ok(within(section).getByText(MCP_STATUS_ERROR));
      assert.ok(within(section).getByText("3"));
    });
    assert.equal(host.state.codeAgent?.identity, "vendor");
    assert.equal(host.state.mcpServers?.members?.[0]?.serverId, "s1");
  });

  it("name null paints MCP server and still shows status", async () => {
    const { ws } = await mountApp({ mcpServers: readyFact([unnamedIdle]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText(MCP_GENERIC_IDENTITY));
      assert.ok(within(section).getByText(MCP_STATUS_IDLE));
    });
  });

  it("Chat never mounts MCP even when connected", async () => {
    cleanup();
    resetMcpState("chat");
    await mountApp({
      mode: "chat",
      connected: true,
      mcpServers: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    assert.equal(mcpSection(), null);
    assert.equal(screen.queryByText(MCP_HEADER), null);
  });

  it("Mini-Grok fallback never mounts MCP", async () => {
    const { ws } = await mountApp({
      codeAgent: fallbackCliFact,
      mcpServers: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(mcpSection(), null);
    assert.equal(screen.queryByText(MCP_HEADER), null);
  });

  it("hard_fail never mounts MCP", async () => {
    const { ws } = await mountApp({
      codeAgent: hardFailFact,
      mcpServers: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(mcpSection(), null);
    assert.equal(screen.queryByText(MCP_HEADER), null);
  });

  it("ready + [] is quiet absent — no section, no load-error copy", async () => {
    const { ws } = await mountApp({ mcpServers: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(mcpSection(), null);
    assert.equal(screen.queryByText(MCP_LOADING), null);
    assert.equal(screen.queryByText(MCP_FAILED), null);
  });

  it("hydrating shows Loading MCP…, keeps prior members, and wins over offline copy", async () => {
    const { host, ws } = await mountApp({
      mcpServers: { disposition: "hydrating", members: [docsConnected] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText(MCP_LOADING));
      assert.ok(within(section).getByText("Docs"));
    });
    let healthDown = false;
    const inner = host.fetchImpl;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health") && healthDown) throw new Error("engine unreachable");
      return inner(input, init);
    }) as typeof fetch;
    assert.ok(healthPoll, "health poll must be installed");
    healthDown = true;
    healthPoll();
    healthPoll();
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      const text = section.textContent ?? "";
      assert.equal(text.includes(MCP_LOADING), true);
      assert.equal(text.includes("Docs"), true);
      assert.equal(text.includes(MCP_OFFLINE), false);
      assert.equal(text.includes(MCP_STATUS_CONNECTED), false);
    });
  });

  it("obtain_failed shows Couldn't load MCP. and keeps last-ready rows", async () => {
    const { ws } = await mountApp({
      mcpServers: { disposition: "obtain_failed", members: [searchIdle] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      assert.equal(alert.textContent, MCP_FAILED);
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Search"));
      assert.ok(within(section).getByText(MCP_STATUS_IDLE));
    });
  });

  it("offline withholds live Connected chip, keeps historical rows, does not collapse N to 0", async () => {
    const three = [
      { ...docsConnected, serverId: "a", name: "Alpha", firstEventSeq: 1 },
      { ...docsConnected, serverId: "b", name: "Beta", firstEventSeq: 2 },
      { ...docsConnected, serverId: "c", name: "Gamma", firstEventSeq: 3 },
    ];
    const { host, ws } = await mountApp({ mcpServers: readyFact(three) });
    let healthDown = false;
    const inner = host.fetchImpl;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health") && healthDown) throw new Error("engine unreachable");
      return inner(input, init);
    }) as typeof fetch;
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const text = mcpSection()?.textContent ?? "";
      assert.equal(text.includes("Alpha"), true);
      assert.equal(text.includes(MCP_STATUS_CONNECTED), true);
      assert.equal(text.includes("3"), true);
    });
    assert.ok(healthPoll, "health poll must be installed");
    healthDown = true;
    healthPoll();
    healthPoll();
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      const text = section.textContent ?? "";
      assert.equal(text.includes("Alpha"), true);
      assert.equal(text.includes("Beta"), true);
      assert.equal(text.includes("Gamma"), true);
      assert.equal(text.includes(MCP_STATUS_CONNECTED), false);
      assert.equal(text.includes(MCP_OFFLINE), true);
      assert.equal(text.includes("1 connected"), false);
      assert.equal(text.includes("3 connected"), false);
      assert.ok(within(section).getByText("3"));
    });
  });

  it("parent terminal withholds live Connected and shows short reconnect copy", async () => {
    const { ws } = await mountApp({ mcpServers: readyFact([docsConnected, searchIdle]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "cancelled",
      finalAnswer: null,
      answerVouched: false,
      failure: null,
      terminalAt: "",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Docs"));
      assert.equal(within(section).queryByText(MCP_STATUS_CONNECTED), null);
      assert.ok(within(section).getByText(MCP_STATUS_IDLE));
      assert.ok(within(section).getByText(MCP_RECONNECT_SHORT));
      assert.equal(within(section).queryByText("1 connected"), null);
    });
  });

  it("unrestorable stays listed Unavailable beside restored peer, not Error", async () => {
    const { ws } = await mountApp({
      mcpServers: readyFact([searchIdle, unrestorable]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Search"));
      assert.ok(within(section).getByText(MCP_UNAVAILABLE));
      assert.ok(within(section).getByText(MCP_GENERIC_IDENTITY));
      assert.equal(within(section).queryByText(MCP_STATUS_ERROR), null);
      assert.ok(within(section).getByText("2"));
      assert.equal(within(section).queryByText("1 error"), null);
    });
  });

  it("thought / ordinary tools do not invent MCP when members are empty", async () => {
    const { ws } = await mountApp({ mcpServers: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "reasoning_delta", segmentId: "t", delta: "parent thinking" }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: writeActivity() }, 3) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByText("parent thinking"));
      assert.ok(screen.getByLabelText("Activity"));
    });
    assert.equal(mcpSection(), null);
    assert.equal(screen.queryByText(MCP_HEADER), null);
  });

  it("mutating a fake journal mcp_server_update does not change MCP chrome", async () => {
    const { ws } = await mountApp({ mcpServers: readyFact([docsConnected]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(mcpSection());
      assert.ok(within(mcpSection()!).getByText("Docs"));
    });
    ws.emit({
      schemaVersion: 1,
      type: "mcp_server_update",
      sessionId: SESSION_ID,
      runId: RUN_ID,
      eventSeq: 9,
      connectionGeneration: 1,
      occurredAt: "",
      payload: {
        kind: "mcp_server_update",
        serverId: "ghost",
        name: "Ghost journal server",
        status: "connected",
      },
    } as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = mcpSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Docs"));
    });
    assert.equal(screen.queryByText("Ghost journal server"), null);
    assert.ok(within(mcpSection()!).getByText("1"));
  });

  it("sibling Child agents and Browser still mount beside MCP", async () => {
    const { ws } = await mountApp({
      mcpServers: readyFact([docsConnected]),
      childAgents: { disposition: "ready", members: [researcher] },
      browserWork: { disposition: "ready", members: [docsFetch] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: writeActivity() }, 3) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(mcpSection());
      assert.ok(screen.getByLabelText(CHILD_AGENTS_HEADER));
      assert.ok(screen.getByLabelText(BROWSER_HEADER));
      assert.ok(screen.getByLabelText(FILE_CHANGES_HEADER));
    });
    assert.ok(within(screen.getByLabelText(CHILD_AGENTS_HEADER)).getByText("Researcher"));
    assert.ok(within(screen.getByLabelText(CHILD_AGENTS_HEADER)).getByText(CHILD_AGENTS_STATUS_RUNNING));
    assert.ok(within(screen.getByLabelText(BROWSER_HEADER)).getByText("Docs page"));
    assert.ok(within(screen.getByLabelText(BROWSER_HEADER)).getByText(BROWSER_STATUS_RUNNING));
    assert.ok(within(screen.getByLabelText(FILE_CHANGES_HEADER)).getByText("src/a.ts"));
    assert.ok(within(mcpSection()!).getByText("Docs"));
  });

  it("permission settle stays in the dock; MCP is not an ask surface; Your turn stays locked; banned copy absent", async () => {
    const { ws } = await mountApp({ mcpServers: readyFact([docsConnected]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot({ state: "waiting_for_decision" }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
    const dockCard = await screen.findByRole("region", { name: "Allow running a command?" });
    assert.ok(within(dockCard).getByRole("button", { name: "Allow once" }));
    assert.ok(within(dockCard).getByRole("button", { name: "Deny" }));
    const section = await waitFor(() => {
      const el = mcpSection();
      assert.ok(el);
      return el!;
    });
    assert.ok(within(section).getByText("Docs"));
    assert.equal(within(section).queryByRole("button", { name: "Allow once" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Deny" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
    assert.equal(screen.queryByText(TURN_COPY), null);
    const text = section.textContent ?? "";
    assert.equal(/stuck/i.test(text), false);
    assert.equal(/status unconfirmed/i.test(text), false);
    assert.equal(/\bdisconnected\b/i.test(text), false);
    assert.equal(/\bhealthy\b/i.test(text), false);
  });
});
