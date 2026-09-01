import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { ChildAgentMember, ChildAgentsMembershipFact, CodeAgentFact } from "./api";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";
import {
  CHILD_AGENTS_FAILED,
  CHILD_AGENTS_HEADER,
  CHILD_AGENTS_LOADING,
  CHILD_AGENTS_OFFLINE,
  CHILD_AGENTS_RECONNECT_SHORT,
  CHILD_AGENTS_STATUS_DONE,
  CHILD_AGENTS_STATUS_FAILED,
  CHILD_AGENTS_STATUS_RUNNING,
} from "./childAgentsProjection";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "subagent-pane-session";
const RUN_ID = "subagent-pane-run";
const TURN_COPY = "Your turn";

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

const researcher: ChildAgentMember = {
  childId: "child-1",
  identityLabel: "Researcher",
  status: "running",
  firstEventSeq: 2,
};
const summarizerDone: ChildAgentMember = {
  childId: "child-2",
  identityLabel: "Summarizer",
  status: "done",
  firstEventSeq: 2,
};
const boomFailed: ChildAgentMember = {
  childId: "child-3",
  identityLabel: "Boom",
  status: "failed",
  firstEventSeq: 2,
};

function decorativeSubagent() {
  return {
    id: "deco-1",
    name: "Decorative leftover",
    role: "explore",
    branch: "main",
    status: "running" as const,
    updatedAt: Date.now(),
  };
}

function resetBrowserState(mode: "chat" | "code" = "code", withDecorative = false): void {
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
        title: "Subagent pane",
        messages: [{ id: "u1", role: "user", content: "hello" }],
        updatedAt: Date.now(),
        status: "live",
        subagents: withDecorative ? [decorativeSubagent()] : [],
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

function readyFact(members: ChildAgentMember[]): ChildAgentsMembershipFact {
  return { disposition: "ready", members };
}

function thoughtActivity(): ActivityRecord {
  return {
    activityId: "a-read",
    invocationId: "i-read",
    name: "read_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "notes.md" },
    output: null,
    error: null,
    diff: null,
    path: "notes.md",
    policy: { effectiveMode: "review" },
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    summary: "Read notes.md",
    title: "Reading notes.md",
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
  childAgents?: ChildAgentsMembershipFact;
  connected?: boolean;
  decorative?: boolean;
} = {}) {
  const mode = opts.mode ?? "code";
  const host = createFakeHost({
    mode,
    workspace: mode === "code" ? WORKSPACE : null,
    workspaceName: mode === "code" ? "repo" : null,
    busy: false,
    connected: opts.connected ?? true,
    hasApiKey: true,
    codeAgent: mode === "code" ? (opts.codeAgent === undefined ? vendorFact : opts.codeAgent) : null,
    childAgents: opts.childAgents ?? (
      mode === "code" && (opts.codeAgent === undefined || opts.codeAgent?.identity === "vendor")
        ? readyFact([])
        : { disposition: "absent_non_code_or_non_vendor", members: null }
    ),
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
}

function childAgentsSection(): HTMLElement | null {
  return document.querySelector('[aria-label="Child agents"]');
}

function decorativeRoster(): HTMLElement | null {
  return document.querySelector('[aria-label="Subagents"]');
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
  resetBrowserState("code");
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

describe("subagent-pane App journeys", () => {
  it("Code vendor ready running member shows Child agents + Running", async () => {
    const { ws, host } = await mountApp({ childAgents: readyFact([researcher]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = childAgentsSection();
      assert.ok(section);
      assert.ok(within(section).getByText(CHILD_AGENTS_HEADER));
      assert.ok(within(section).getByText("Researcher"));
      assert.ok(within(section).getByText(CHILD_AGENTS_STATUS_RUNNING));
    });
    assert.equal(host.state.codeAgent?.identity, "vendor");
  });

  it("first-frame done and failed paint those chips, not Running", async () => {
    const { ws } = await mountApp({
      childAgents: readyFact([summarizerDone, boomFailed]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: summarizerDone.childId,
      identityLabel: summarizerDone.identityLabel,
      status: "done",
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: boomFailed.childId,
      identityLabel: boomFailed.identityLabel,
      status: "failed",
    }, 3) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = childAgentsSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Summarizer"));
      assert.ok(within(section).getByText(CHILD_AGENTS_STATUS_DONE));
      assert.ok(within(section).getByText("Boom"));
      assert.ok(within(section).getByText(CHILD_AGENTS_STATUS_FAILED));
      assert.equal(within(section).queryByText(CHILD_AGENTS_STATUS_RUNNING), null);
    });
  });

  it("Chat never mounts Child agents", async () => {
    cleanup();
    resetBrowserState("chat");
    await mountApp({
      mode: "chat",
      childAgents: { disposition: "absent_non_code_or_non_vendor", members: null },
    });
    assert.equal(childAgentsSection(), null);
    assert.equal(screen.queryByText(CHILD_AGENTS_HEADER), null);
    assert.equal(decorativeRoster(), null);
  });

  it("Mini-Grok fallback never mounts Child agents", async () => {
    const { ws } = await mountApp({
      codeAgent: fallbackCliFact,
      childAgents: { disposition: "absent_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(childAgentsSection(), null);
    assert.equal(screen.queryByText(CHILD_AGENTS_HEADER), null);
  });

  it("hard_fail never mounts Child agents", async () => {
    const { ws } = await mountApp({
      codeAgent: hardFailFact,
      childAgents: { disposition: "absent_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(childAgentsSection(), null);
    assert.equal(screen.queryByText(CHILD_AGENTS_HEADER), null);
  });

  it("ready + [] is quiet absent — no section, no load-error copy", async () => {
    const { ws } = await mountApp({ childAgents: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(childAgentsSection(), null);
    assert.equal(screen.queryByText(CHILD_AGENTS_LOADING), null);
    assert.equal(screen.queryByText(CHILD_AGENTS_FAILED), null);
  });

  it("hydrating shows Loading child agents… and keeps prior members", async () => {
    const { ws } = await mountApp({
      childAgents: { disposition: "hydrating", members: [researcher] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = childAgentsSection();
      assert.ok(section);
      assert.ok(within(section).getByText(CHILD_AGENTS_LOADING));
      assert.ok(within(section).getByText("Researcher"));
    });
  });

  it("obtain_failed shows Couldn't load child agents.", async () => {
    const { ws } = await mountApp({
      childAgents: { disposition: "obtain_failed", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByRole("alert"));
      assert.equal(screen.getByRole("alert").textContent, CHILD_AGENTS_FAILED);
    });
  });

  it("PublicState.connected false does not hide vendor Child agents (eligibility is codeAgent)", async () => {
    const { ws } = await mountApp({
      connected: false,
      childAgents: readyFact([researcher]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = childAgentsSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Researcher"));
      assert.ok(within(section).getByText(CHILD_AGENTS_STATUS_RUNNING));
    });
  });

  it("offline withholds live Running chip, keeps historical row, does not count running", async () => {
    const { host, ws } = await mountApp({ childAgents: readyFact([researcher]) });
    let healthDown = false;
    const inner = host.fetchImpl;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health") && healthDown) throw new Error("engine unreachable");
      return inner(input, init);
    }) as typeof fetch;
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const text = childAgentsSection()?.textContent ?? "";
      assert.equal(text.includes("Researcher"), true);
      assert.equal(text.includes(CHILD_AGENTS_STATUS_RUNNING), true);
    });
    assert.ok(healthPoll, "health poll must be installed");
    healthDown = true;
    healthPoll();
    healthPoll();
    await waitFor(() => {
      const text = childAgentsSection()?.textContent ?? "";
      assert.equal(text.includes("Researcher"), true);
      assert.equal(text.includes(CHILD_AGENTS_STATUS_RUNNING), false);
      assert.equal(text.includes(CHILD_AGENTS_OFFLINE), true);
      assert.equal(text.includes("1 running"), false);
    });
  });

  it("parent terminal withholds live Running and shows short reconnect copy", async () => {
    const { ws } = await mountApp({ childAgents: readyFact([researcher, summarizerDone]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: summarizerDone.childId,
      identityLabel: summarizerDone.identityLabel,
      status: "done",
    }, 3) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "cancelled",
      finalAnswer: null,
      answerVouched: false,
      failure: null,
      terminalAt: "",
    }, 4) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = childAgentsSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Researcher"));
      assert.equal(within(section).queryByText(CHILD_AGENTS_STATUS_RUNNING), null);
      assert.ok(within(section).getByText(CHILD_AGENTS_STATUS_DONE));
      assert.ok(within(section).getByText(CHILD_AGENTS_RECONNECT_SHORT));
      assert.equal(within(section).queryByText("1 running"), null);
    });
  });

  it("decorative Code sidebar Subagents does not paint beside journaled Child agents", async () => {
    cleanup();
    resetBrowserState("code", true);
    const { ws } = await mountApp({
      childAgents: readyFact([researcher]),
      decorative: true,
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(childAgentsSection());
      assert.ok(within(childAgentsSection()!).getByText("Researcher"));
    });
    assert.equal(decorativeRoster(), null);
    assert.equal((document.body?.textContent ?? "").includes("Decorative leftover"), false);
  });

  it("decorative Code sidebar Subagents stays unmounted on quiet-absent vendor", async () => {
    cleanup();
    resetBrowserState("code", true);
    const { ws } = await mountApp({ childAgents: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(childAgentsSection(), null);
    assert.equal(decorativeRoster(), null);
  });

  it("thought and ordinary tools do not invent Child agents rows", async () => {
    const { ws } = await mountApp({ childAgents: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "reasoning_delta", segmentId: "t", delta: "parent thinking" }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: thoughtActivity() }, 3) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByText("parent thinking"));
    });
    assert.equal(childAgentsSection(), null);
    assert.equal(screen.queryByText(CHILD_AGENTS_HEADER), null);
  });

  it("permission settle stays in the dock; Child agents is not an ask surface; Your turn stays locked", async () => {
    const { ws } = await mountApp({ childAgents: readyFact([researcher]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot({ state: "waiting_for_decision" }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "child_agent_update",
      childId: researcher.childId,
      identityLabel: researcher.identityLabel,
      status: "running",
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 3) as unknown as Record<string, unknown>);
    const dockCard = await screen.findByRole("region", { name: "Allow running a command?" });
    assert.ok(within(dockCard).getByRole("button", { name: "Allow once" }));
    assert.ok(within(dockCard).getByRole("button", { name: "Deny" }));
    const section = await waitFor(() => {
      const el = childAgentsSection();
      assert.ok(el);
      return el!;
    });
    assert.ok(within(section).getByText("Researcher"));
    assert.equal(within(section).queryByRole("button", { name: "Allow once" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Deny" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
    assert.equal(screen.queryByText(TURN_COPY), null);
    const text = section.textContent ?? "";
    assert.equal(/stuck/i.test(text), false);
    assert.equal(/status unconfirmed/i.test(text), false);
  });
});
