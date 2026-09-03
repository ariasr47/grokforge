import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { BrowserWorkMember, BrowserWorkMembershipFact, ChildAgentMember, ChildAgentsMembershipFact, CodeAgentFact } from "./api";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";
import {
  BROWSER_FAILED,
  BROWSER_GENERIC_IDENTITY,
  BROWSER_HEADER,
  BROWSER_LOADING,
  BROWSER_OFFLINE,
  BROWSER_RECONNECT_SHORT,
  BROWSER_SNAPSHOT,
  BROWSER_SNAPSHOT_MUTED,
  BROWSER_STATUS_DONE,
  BROWSER_STATUS_FAILED,
  BROWSER_STATUS_RUNNING,
  BROWSER_UNAVAILABLE,
} from "./browserWorkProjection";
import { CHILD_AGENTS_HEADER, CHILD_AGENTS_STATUS_RUNNING } from "./childAgentsProjection";
import { CHANGES_DOCK_LABEL } from "./ChangesDock";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "browser-panel-session";
const RUN_ID = "browser-panel-run";
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

const docsRunning: BrowserWorkMember = {
  toolCallId: "f1",
  acpToolKind: "fetch",
  url: "https://docs.x.ai",
  title: "Docs",
  status: "running",
  snapshotJournaled: false,
  restore: "restored",
  firstEventSeq: 2,
};
const pageDone: BrowserWorkMember = {
  toolCallId: "f2",
  acpToolKind: "fetch",
  url: "https://a.example",
  title: "A",
  status: "done",
  snapshotJournaled: false,
  restore: "restored",
  firstEventSeq: 2,
};
const boomFailed: BrowserWorkMember = {
  toolCallId: "f3",
  acpToolKind: "fetch",
  url: null,
  title: "Boom",
  status: "failed",
  snapshotJournaled: false,
  restore: "restored",
  firstEventSeq: 3,
};
const unrestorable: BrowserWorkMember = {
  toolCallId: "gone",
  acpToolKind: "fetch",
  url: null,
  title: null,
  status: null,
  snapshotJournaled: false,
  restore: "unrestorable",
  firstEventSeq: 4,
};
const researcher: ChildAgentMember = {
  childId: "child-1",
  identityLabel: "Researcher",
  status: "running",
  firstEventSeq: 2,
};

function resetBrowserState(mode: "chat" | "code" = "code"): void {
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
        title: "Browser panel",
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

function readyFact(members: BrowserWorkMember[]): BrowserWorkMembershipFact {
  return { disposition: "ready", members };
}

function fetchActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "f1",
    invocationId: "f1",
    name: "web_fetch",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: {},
    output: null,
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "review" },
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    summary: "Docs",
    title: "Docs",
    acpToolKind: "fetch",
    url: "https://docs.x.ai",
    snapshotJournaled: false,
    ...overrides,
  };
}

function readActivity(): ActivityRecord {
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
  browserWork?: BrowserWorkMembershipFact;
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
    browserWork: opts.browserWork ?? (
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

function browserSection(): HTMLElement | null {
  return document.querySelector('[aria-label="Browser"]');
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

describe("browser-panel App journeys", () => {
  it("Code vendor ready fetch members show Browser with URL/title and Running/Done/Failed", async () => {
    const { ws, host } = await mountApp({
      browserWork: readyFact([docsRunning, pageDone, boomFailed]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText(BROWSER_HEADER));
      assert.ok(within(section).getByText("Docs"));
      assert.ok(within(section).getByText("https://docs.x.ai"));
      assert.ok(within(section).getByText(BROWSER_STATUS_RUNNING));
      assert.ok(within(section).getByText("A"));
      assert.ok(within(section).getByText(BROWSER_STATUS_DONE));
      assert.ok(within(section).getByText("Boom"));
      assert.ok(within(section).getByText(BROWSER_STATUS_FAILED));
    });
    assert.equal(host.state.codeAgent?.identity, "vendor");
    assert.equal(host.state.browserWork?.members?.[0]?.acpToolKind, "fetch");
  });

  it("Chat never mounts Browser even when connected", async () => {
    cleanup();
    resetBrowserState("chat");
    await mountApp({
      mode: "chat",
      connected: true,
      browserWork: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    assert.equal(browserSection(), null);
    assert.equal(screen.queryByText(BROWSER_HEADER), null);
  });

  it("Mini-Grok fallback never mounts Browser", async () => {
    const { ws } = await mountApp({
      codeAgent: fallbackCliFact,
      browserWork: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(browserSection(), null);
    assert.equal(screen.queryByText(BROWSER_HEADER), null);
  });

  it("hard_fail never mounts Browser", async () => {
    const { ws } = await mountApp({
      codeAgent: hardFailFact,
      browserWork: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(browserSection(), null);
    assert.equal(screen.queryByText(BROWSER_HEADER), null);
  });

  it("ready + [] is quiet absent — no section, no load-error copy", async () => {
    const { ws } = await mountApp({ browserWork: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector("[data-run-id]")));
    assert.equal(browserSection(), null);
    assert.equal(screen.queryByText(BROWSER_LOADING), null);
    assert.equal(screen.queryByText(BROWSER_FAILED), null);
  });

  it("hydrating shows Loading browser work…, keeps prior members, and wins over offline copy", async () => {
    const { host, ws } = await mountApp({
      browserWork: { disposition: "hydrating", members: [docsRunning] },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText(BROWSER_LOADING));
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
      const section = browserSection();
      assert.ok(section);
      const text = section.textContent ?? "";
      assert.equal(text.includes(BROWSER_LOADING), true);
      assert.equal(text.includes("Docs"), true);
      assert.equal(text.includes(BROWSER_OFFLINE), false);
      assert.equal(text.includes(BROWSER_STATUS_RUNNING), false);
    });
  });

  it("obtain_failed shows Couldn't load browser work.", async () => {
    const { ws } = await mountApp({
      browserWork: { disposition: "obtain_failed", members: null },
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByRole("alert"));
      assert.equal(screen.getByRole("alert").textContent, BROWSER_FAILED);
    });
  });

  it("offline withholds live Running chip, keeps historical row, does not count running", async () => {
    const { host, ws } = await mountApp({ browserWork: readyFact([docsRunning]) });
    let healthDown = false;
    const inner = host.fetchImpl;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health") && healthDown) throw new Error("engine unreachable");
      return inner(input, init);
    }) as typeof fetch;
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const text = browserSection()?.textContent ?? "";
      assert.equal(text.includes("Docs"), true);
      assert.equal(text.includes(BROWSER_STATUS_RUNNING), true);
    });
    assert.ok(healthPoll, "health poll must be installed");
    healthDown = true;
    healthPoll();
    healthPoll();
    await waitFor(() => {
      const text = browserSection()?.textContent ?? "";
      assert.equal(text.includes("Docs"), true);
      assert.equal(text.includes(BROWSER_STATUS_RUNNING), false);
      assert.equal(text.includes(BROWSER_OFFLINE), true);
      assert.equal(text.includes("1 running"), false);
    });
  });

  it("parent terminal withholds live Running and shows short reconnect copy", async () => {
    const { ws } = await mountApp({ browserWork: readyFact([docsRunning, pageDone]) });
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
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText("Docs"));
      assert.equal(within(section).queryByText(BROWSER_STATUS_RUNNING), null);
      assert.ok(within(section).getByText(BROWSER_STATUS_DONE));
      assert.ok(within(section).getByText(BROWSER_RECONNECT_SHORT));
      assert.equal(within(section).queryByText("1 running"), null);
    });
  });

  it("unrestorable stays listed Unavailable beside restored peer, not Failed", async () => {
    const { ws } = await mountApp({
      browserWork: readyFact([pageDone, unrestorable]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText("A"));
      assert.ok(within(section).getByText(BROWSER_UNAVAILABLE));
      assert.ok(within(section).getByText(BROWSER_GENERIC_IDENTITY));
      assert.equal(within(section).queryByText(BROWSER_STATUS_FAILED), null);
      assert.ok(within(section).getByText("2"));
      assert.equal(within(section).queryByText("1 failed"), null);
    });
  });

  it("snapshot caption only when journaled", async () => {
    const { ws } = await mountApp({
      browserWork: readyFact([{ ...pageDone, snapshotJournaled: true }]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText(BROWSER_SNAPSHOT));
      assert.ok(within(section).getByText(BROWSER_SNAPSHOT_MUTED));
      assert.equal(section.querySelector("img"), null);
    });
  });

  it("no snapshot caption when snapshotJournaled is false", async () => {
    const { ws } = await mountApp({ browserWork: readyFact([pageDone]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText("A"));
    });
    assert.equal(screen.queryByText(BROWSER_SNAPSHOT), null);
  });

  it("no URL/title paints generic Browser work identity", async () => {
    const { ws } = await mountApp({
      browserWork: readyFact([{ ...docsRunning, url: null, title: null }]),
    });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      const section = browserSection();
      assert.ok(section);
      assert.ok(within(section).getByText(BROWSER_GENERIC_IDENTITY));
    });
  });

  it("dual-presence: fetch stays once on the tool rail and once in Browser", async () => {
    const { ws } = await mountApp({ browserWork: readyFact([docsRunning]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: fetchActivity() }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(browserSection());
      assert.ok(within(browserSection()!).getByText("Docs"));
    });
    const toolRows = document.querySelectorAll('[data-activity-id="f1"]');
    assert.equal(toolRows.length, 1);
    const activity = screen.getByLabelText("Activity");
    assert.ok(activity);
    assert.equal(activity.querySelectorAll(".rrow").length, 1);
  });

  it("non-fetch activity and thought do not invent Browser; fetch journal without members does not either", async () => {
    const { ws } = await mountApp({ browserWork: readyFact([]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "reasoning_delta", segmentId: "t", delta: "parent thinking" }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: readActivity() }, 3) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: fetchActivity() }, 4) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByText("parent thinking"));
      assert.ok(screen.getByLabelText("Activity"));
    });
    assert.equal(browserSection(), null);
    assert.equal(screen.queryByText(BROWSER_HEADER), null);
  });

  it("sibling File changes and Child agents still mount beside Browser", async () => {
    const { ws } = await mountApp({
      browserWork: readyFact([docsRunning]),
      childAgents: { disposition: "ready", members: [researcher] },
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
      assert.ok(browserSection());
      assert.ok(screen.getByLabelText(CHILD_AGENTS_HEADER));
      assert.ok(screen.getByLabelText(CHANGES_DOCK_LABEL));
    });
    assert.ok(within(screen.getByLabelText(CHILD_AGENTS_HEADER)).getByText("Researcher"));
    assert.ok(within(screen.getByLabelText(CHILD_AGENTS_HEADER)).getByText(CHILD_AGENTS_STATUS_RUNNING));
    assert.ok(within(screen.getByLabelText(CHANGES_DOCK_LABEL)).getByText("src/a.ts"));
    assert.ok(within(browserSection()!).getByText("Docs"));
  });

  it("permission settle stays in the dock; Browser is not an ask surface; Your turn stays locked; banned copy absent", async () => {
    const { ws } = await mountApp({ browserWork: readyFact([docsRunning]) });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot({ state: "waiting_for_decision" }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
    const dockCard = await screen.findByRole("region", { name: "Grok wants to run a command" });
    assert.ok(within(dockCard).getByRole("button", { name: "Allow" }));
    assert.ok(within(dockCard).getByRole("button", { name: "Deny" }));
    const section = await waitFor(() => {
      const el = browserSection();
      assert.ok(el);
      return el!;
    });
    assert.ok(within(section).getByText("Docs"));
    assert.equal(within(section).queryByRole("button", { name: "Allow" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Deny" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
    assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
    assert.equal(screen.queryByText(TURN_COPY), null);
    const text = section.textContent ?? "";
    assert.equal(/stuck/i.test(text), false);
    assert.equal(/status unconfirmed/i.test(text), false);
    assert.equal(/live page/i.test(text), false);
  });
});
