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
  HookMember,
  HooksMembershipFact,
  McpServerMember,
  McpServersMembershipFact,
} from "./api";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";
import {
  HOOKS_FAILED,
  HOOKS_GENERIC_IDENTITY,
  HOOKS_HEADER,
  HOOKS_LOADING,
  HOOKS_OFFLINE,
  HOOKS_RECONNECT_SHORT,
  HOOKS_STATUS_DONE,
  HOOKS_STATUS_FAILED,
  HOOKS_STATUS_IDLE,
  HOOKS_STATUS_RUNNING,
  HOOKS_UNAVAILABLE,
} from "./hooksProjection";
import { MCP_HEADER, MCP_STATUS_CONNECTED } from "./mcpServersProjection";
import { BROWSER_HEADER, BROWSER_STATUS_RUNNING } from "./browserWorkProjection";
import { CHILD_AGENTS_HEADER, CHILD_AGENTS_STATUS_RUNNING } from "./childAgentsProjection";
import { FILE_CHANGES_HEADER } from "./FileChangesSection";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "vendor-hooks-visible-session";
const RUN_ID = "vendor-hooks-visible-run";
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

const preToolRunning: HookMember = {
  hookId: "h1",
  name: "PreTool",
  status: "running",
  restore: "restored",
  firstEventSeq: 2,
};
const sessionIdle: HookMember = {
  hookId: "h2",
  name: "SessionStart",
  status: "idle",
  restore: "restored",
  firstEventSeq: 3,
};
const postToolDone: HookMember = {
  hookId: "h3",
  name: "PostTool",
  status: "done",
  restore: "restored",
  firstEventSeq: 4,
};
const authFailed: HookMember = {
  hookId: "h4",
  name: "Auth",
  status: "failed",
  restore: "restored",
  firstEventSeq: 5,
};
const unrestorable: HookMember = {
  hookId: "gone",
  name: null,
  status: null,
  restore: "unrestorable",
  firstEventSeq: 6,
};
const unnamedIdle: HookMember = {
  hookId: "h-anon",
  name: null,
  status: "idle",
  restore: "restored",
  firstEventSeq: 7,
};

const docsConnected: McpServerMember = {
  serverId: "s1",
  name: "Docs",
  status: "connected",
  restore: "restored",
  firstEventSeq: 2,
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

function resetHooksState(mode: "chat" | "code" = "code"): void {
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
        title: "Hooks visible",
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

function readyFact(members: HookMember[]): HooksMembershipFact {
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
  hooks?: HooksMembershipFact;
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
        ? { disposition: "ready", members: [] }
        : { disposition: "absent_for_non_code_or_non_vendor", members: null }
    ),
    hooks: opts.hooks ?? (
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

function hooksSection(): HTMLElement | null {
  return document.querySelector('[aria-label="Hooks"]');
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
  resetHooksState("code");
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

describe("vendor-hooks-visible App journeys", () => {
  it("Code vendor ready members show Hooks with names and Running/Idle/Done/Failed", async () => {
    const { ws, host } = await mountApp({
      hooks: readyFact([preToolRunning, sessionIdle, postToolDone, authFailed]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText(HOOKS_HEADER));
      assert.ok(within(section).getByText("PreTool"));
      assert.ok(within(section).getByText(HOOKS_STATUS_RUNNING));
      assert.ok(within(section).getByText("SessionStart"));
      assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
      assert.ok(within(section).getByText("PostTool"));
      assert.ok(within(section).getByText(HOOKS_STATUS_DONE));
      assert.ok(within(section).getByText("Auth"));
      assert.ok(within(section).getByText(HOOKS_STATUS_FAILED));
      assert.ok(within(section).getByText("4"));
    });
    assert.equal(host.state.codeAgent?.identity, "vendor");
    assert.equal(host.state.hooks?.members?.[0]?.hookId, "h1");
  });

  it("name null paints Hook and still shows status", async () => {
    const { ws } = await mountApp({ hooks: readyFact([unnamedIdle]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText(HOOKS_GENERIC_IDENTITY));
      assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
    });
  });

  it("Idle member mounts Hooks section — not quiet empty", async () => {
    const { ws } = await mountApp({ hooks: readyFact([sessionIdle]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText("SessionStart"));
      assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
      assert.ok(within(section).getByText("1"));
      assert.equal(within(section).queryByText(HOOKS_STATUS_RUNNING), null);
    });
  });

  it("Chat never mounts Hooks even when connected", async () => {
    cleanup();
    resetHooksState("chat");
    await mountApp({
      mode: "chat",
      connected: true,
      hooks: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    assert.equal(hooksSection(), null);
    assert.equal(screen.queryByText(HOOKS_HEADER), null);
  });

  it("Mini-Grok fallback never mounts Hooks", async () => {
    const { ws } = await mountApp({
      codeAgent: fallbackCliFact,
      hooks: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(hooksSection(), null);
    assert.equal(screen.queryByText(HOOKS_HEADER), null);
  });

  it("hard_fail never mounts Hooks", async () => {
    const { ws } = await mountApp({
      codeAgent: hardFailFact,
      hooks: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(hooksSection(), null);
    assert.equal(screen.queryByText(HOOKS_HEADER), null);
  });

  it("ready + [] is quiet absent — no section, no load-error copy", async () => {
    const { ws } = await mountApp({ hooks: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(hooksSection(), null);
    assert.equal(screen.queryByText(HOOKS_LOADING), null);
    assert.equal(screen.queryByText(HOOKS_FAILED), null);
  });

  it("hydrating shows Loading hooks…, keeps prior members, and wins over offline copy", async () => {
    const { host, ws } = await mountApp({
      hooks: { disposition: "hydrating", members: [preToolRunning] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText(HOOKS_LOADING));
      assert.ok(within(section).getByText("PreTool"));
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
      const section = hooksSection();
      assert.ok(section);
      const text = section.textContent ?? "";
      assert.equal(text.includes(HOOKS_LOADING), true);
      assert.equal(text.includes("PreTool"), true);
      assert.equal(text.includes(HOOKS_OFFLINE), false);
      assert.equal(text.includes(HOOKS_STATUS_RUNNING), false);
    });
  });

  it("obtain_failed shows Couldn't load hooks. and keeps last-ready rows", async () => {
    const { ws } = await mountApp({
      hooks: { disposition: "obtain_failed", members: [sessionIdle] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      assert.equal(alert.textContent, HOOKS_FAILED);
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText("SessionStart"));
      assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
    });
  });

  it("offline withholds live Running chip, keeps historical rows, does not collapse N to 0", async () => {
    const three = [
      { ...preToolRunning, hookId: "a", name: "Alpha", firstEventSeq: 1 },
      { ...preToolRunning, hookId: "b", name: "Beta", firstEventSeq: 2 },
      { ...preToolRunning, hookId: "c", name: "Gamma", firstEventSeq: 3 },
    ];
    const { host, ws } = await mountApp({ hooks: readyFact(three) });
    let healthDown = false;
    const inner = host.fetchImpl;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health") && healthDown) throw new Error("engine unreachable");
      return inner(input, init);
    }) as typeof fetch;
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const text = hooksSection()?.textContent ?? "";
      assert.equal(text.includes("Alpha"), true);
      assert.equal(text.includes(HOOKS_STATUS_RUNNING), true);
      assert.equal(text.includes("3"), true);
    });
    assert.ok(healthPoll, "health poll must be installed");
    healthDown = true;
    healthPoll();
    healthPoll();
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      const text = section.textContent ?? "";
      assert.equal(text.includes("Alpha"), true);
      assert.equal(text.includes("Beta"), true);
      assert.equal(text.includes("Gamma"), true);
      assert.equal(text.includes(HOOKS_STATUS_RUNNING), false);
      assert.equal(text.includes(HOOKS_OFFLINE), true);
      assert.equal(text.includes("1 running"), false);
      assert.equal(text.includes("3 running"), false);
      assert.ok(within(section).getByText("3"));
    });
  });

  it("parent terminal withholds live Running and shows short reconnect copy", async () => {
    const { ws } = await mountApp({ hooks: readyFact([preToolRunning, sessionIdle]) });
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
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText("PreTool"));
      assert.equal(within(section).queryByText(HOOKS_STATUS_RUNNING), null);
      assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
      assert.ok(within(section).getByText(HOOKS_RECONNECT_SHORT));
      assert.equal(within(section).queryByText("1 running"), null);
    });
  });

  it("unrestorable stays listed Unavailable beside restored peer, not Failed", async () => {
    const { ws } = await mountApp({
      hooks: readyFact([sessionIdle, unrestorable]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText("SessionStart"));
      assert.ok(within(section).getByText(HOOKS_UNAVAILABLE));
      assert.ok(within(section).getByText(HOOKS_GENERIC_IDENTITY));
      assert.equal(within(section).queryByText(HOOKS_STATUS_FAILED), null);
      assert.ok(within(section).getByText("2"));
      assert.equal(within(section).queryByText("1 failed"), null);
    });
  });

  it("thought / ordinary tools do not invent Hooks when members are empty", async () => {
    const { ws } = await mountApp({ hooks: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "reasoning_delta", segmentId: "t", delta: "parent thinking" }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: writeActivity() }, 3) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByText("parent thinking"));
      assert.ok(screen.getByLabelText("Activity"));
    });
    assert.equal(hooksSection(), null);
    assert.equal(screen.queryByText(HOOKS_HEADER), null);
  });

  it("mutating a fake journal hook_update does not change Hooks chrome", async () => {
    const { ws } = await mountApp({ hooks: readyFact([preToolRunning]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(hooksSection());
      assert.ok(within(hooksSection()!).getByText("PreTool"));
    });
    ws.emit({
      schemaVersion: 1,
      type: "hook_update",
      sessionId: SESSION_ID,
      runId: RUN_ID,
      eventSeq: 9,
      connectionGeneration: 1,
      occurredAt: "",
      payload: {
        kind: "hook_update",
        hookId: "ghost",
        name: "Ghost journal hook",
        status: "running",
      },
    } as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = hooksSection();
      assert.ok(section);
      assert.ok(within(section).getByText("PreTool"));
    });
    assert.equal(screen.queryByText("Ghost journal hook"), null);
    assert.ok(within(hooksSection()!).getByText("1"));
  });

  it("sibling MCP / Child agents / Browser still mount beside Hooks", async () => {
    const { ws } = await mountApp({
      hooks: readyFact([preToolRunning]),
      mcpServers: { disposition: "ready", members: [docsConnected] },
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
      assert.ok(hooksSection());
      assert.ok(screen.getByLabelText(MCP_HEADER));
      assert.ok(screen.getByLabelText(CHILD_AGENTS_HEADER));
      assert.ok(screen.getByLabelText(BROWSER_HEADER));
      assert.ok(screen.getByLabelText(FILE_CHANGES_HEADER));
    });
    assert.ok(within(screen.getByLabelText(CHILD_AGENTS_HEADER)).getByText("Researcher"));
    assert.ok(within(screen.getByLabelText(CHILD_AGENTS_HEADER)).getByText(CHILD_AGENTS_STATUS_RUNNING));
    assert.ok(within(screen.getByLabelText(BROWSER_HEADER)).getByText("Docs page"));
    assert.ok(within(screen.getByLabelText(BROWSER_HEADER)).getByText(BROWSER_STATUS_RUNNING));
    assert.ok(within(screen.getByLabelText(FILE_CHANGES_HEADER)).getByText("src/a.ts"));
    assert.ok(within(screen.getByLabelText(MCP_HEADER)).getByText("Docs"));
    assert.ok(within(screen.getByLabelText(MCP_HEADER)).getByText(MCP_STATUS_CONNECTED));
    assert.ok(within(hooksSection()!).getByText("PreTool"));
  });

  it("permission settle stays in the dock; Hooks is not an ask surface; Your turn stays locked; banned copy absent", async () => {
    const { ws } = await mountApp({ hooks: readyFact([preToolRunning]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot({ state: "waiting_for_decision" }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
    const dockCard = await screen.findByRole("region", { name: "Allow running a command?" });
    assert.ok(within(dockCard).getByRole("button", { name: "Allow once" }));
    assert.ok(within(dockCard).getByRole("button", { name: "Deny" }));
    const section = await waitFor(() => {
      const el = hooksSection();
      assert.ok(el);
      return el!;
    });
    assert.ok(within(section).getByText("PreTool"));
    assert.equal(within(section).queryByRole("button", { name: "Allow once" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Deny" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
    assert.equal(screen.queryByText(TURN_COPY), null);
    const text = section.textContent ?? "";
    assert.equal(/stuck/i.test(text), false);
    assert.equal(/status unconfirmed/i.test(text), false);
    assert.equal(/\bhealthy\b/i.test(text), false);
    assert.equal(/\bconnected\b/i.test(text), false);
    assert.equal(/\berror\b/i.test(text), false);
  });
});
