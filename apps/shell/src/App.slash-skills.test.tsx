import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import {
  SKILLS_ARMED,
  SKILLS_CHECKING,
  SKILLS_EMPTY,
  SKILLS_FAILED,
  SKILLS_SENT,
  SKILLS_TITLE,
  SKILLS_UNAVAILABLE,
} from "./skillsCatalogComposer";
import { CODE_AGENT_FALLBACK_CLI } from "./codeAgentComposer";
import { SETTLE_CARD_BELOW } from "./copyDock.js";
import type { CodeAgentFact, SkillsCatalogFact } from "./api";
import {
  initialRunProjection,
  mergeRunSnapshot,
  persistableRunProjection,
  restoreRunProjection,
  type RunEventEnvelope,
  type RunSnapshot,
} from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "slash-skills-session";
const RUN_ID = "slash-skills-run";
const FIXTURE = "/forge-skill-fixture";
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

const readyCatalog: SkillsCatalogFact = {
  disposition: "ready",
  commands: [{ name: FIXTURE, description: "Forge skill fixture" }],
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
        title: "Slash skills",
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
    acceptedPrompt: FIXTURE,
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

function envelope(payload: RunEventEnvelope["payload"], seq: number, runId = RUN_ID): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: SESSION_ID,
    runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

async function mountApp(opts: {
  mode?: "chat" | "code";
  codeAgent?: CodeAgentFact | null;
  skillsCatalog?: SkillsCatalogFact;
  promptRefuse?: { status: number; code: string; error: string } | null;
  priorConversations?: boolean;
  emptyHistory?: boolean;
} = {}) {
  const mode = opts.mode ?? "code";
  if (opts.emptyHistory) {
    const partition = mode === "code" ? WORKSPACE : "chat:__sandbox__";
    reloadSessionsFromDisk({
      byWorkspace: {
        [partition]: [{
          id: SESSION_ID,
          workspace: partition,
          title: "New chat",
          messages: [],
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
  }
  const host = createFakeHost(
    {
      mode,
      workspace: mode === "code" ? WORKSPACE : null,
      workspaceName: mode === "code" ? "repo" : null,
      busy: false,
      connected: true,
      hasApiKey: true,
      priorConversations: opts.priorConversations ?? false,
      codeAgent: mode === "code" ? (opts.codeAgent === undefined ? vendorFact : opts.codeAgent) : null,
      skillsCatalog: opts.skillsCatalog ?? (
        mode === "code"
          ? readyCatalog
          : { disposition: "absent_non_vendor", commands: null }
      ),
      planEngagement: mode === "code" ? { engaged: false, vouched: true } : undefined,
    },
    opts.promptRefuse ? { promptRefuse: opts.promptRefuse } : {},
  );
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
}

function firstToken(text: string): string {
  const trimmed = text.trimStart();
  const m = trimmed.match(/^[^\s]+/);
  return m ? m[0]! : "";
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
});

beforeEach(() => {
  resetBrowserState("code");
});

afterEach(() => {
  cleanup();
});

describe("slash-skills journeys", () => {
  it("Code vendor ready: / opens Skills listing only vouched names", async () => {
    await mountApp();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => {
      assert.ok(screen.getByRole("listbox", { name: SKILLS_TITLE }));
    });
    assert.ok(screen.getByRole("option", { name: FIXTURE }));
    assert.equal(screen.queryByRole("option", { name: "/invented" }), null);
    assert.equal(screen.queryByPlaceholderText("Type a command…"), null);
    assert.equal(screen.queryByText("Code continuum"), null);
    assert.equal(
      screen.queryByText("Summarize this repo structure and the main entrypoints."),
      null,
    );
  });

  it("conversations-not-found unmounts while Skills is open", async () => {
    const NOT_FOUND = "Forge didn't find your earlier conversations.";
    await mountApp({ emptyHistory: true, priorConversations: true });
    const user = userEvent.setup({ delay: null });
    await waitFor(() => {
      assert.equal(Boolean(screen.queryByText(NOT_FOUND)), true);
    });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => {
      assert.equal(Boolean(screen.queryByRole("listbox", { name: SKILLS_TITLE })), true);
    });
    assert.equal(Boolean(screen.queryByText(NOT_FOUND)), false);
    assert.equal(Boolean(screen.queryByRole("button", { name: "Start a new conversation" })), false);
    assert.equal(Boolean(screen.queryByRole("button", { name: "Save troubleshooting file" })), false);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      assert.equal(Boolean(screen.queryByRole("listbox", { name: SKILLS_TITLE })), false);
    });
    await waitFor(() => {
      assert.equal(Boolean(screen.queryByText(NOT_FOUND)), true);
    });
  });

  it("mixed ready catalog lists every usable /name and not Couldn't load skills.", async () => {
    await mountApp({
      skillsCatalog: {
        disposition: "ready",
        commands: [
          { name: "/a", description: null },
          { name: "/b", description: "bee" },
        ],
      },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => assert.ok(screen.getByRole("listbox", { name: SKILLS_TITLE })));
    assert.ok(screen.getByRole("option", { name: "/a" }));
    assert.ok(screen.getByRole("option", { name: /\/b/ }));
    assert.equal(screen.queryByText(SKILLS_FAILED), null);
    assert.equal(screen.queryByText(SKILLS_CHECKING), null);
    assert.equal(screen.queryByRole("option", { name: "no-slash" }), null);
  });

  it("WS replace-shrink paints this payload only (stale name gone)", async () => {
    const { host, ws } = await mountApp({
      skillsCatalog: {
        disposition: "ready",
        commands: [
          { name: "/keep", description: null },
          { name: "/stale", description: null },
        ],
      },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => assert.ok(screen.getByRole("option", { name: "/stale" })));
    const live = FakeWebSocket.latest() ?? ws;
    live.emit({
      type: "state",
      state: {
        ...host.state,
        skillsCatalog: {
          disposition: "ready",
          commands: [
            { name: "/keep", description: null },
            { name: "/new", description: "n" },
          ],
        },
      },
    });
    await waitFor(() => {
      assert.ok(screen.getByRole("option", { name: "/keep" }));
      assert.ok(screen.getByRole("option", { name: /\/new/ }));
    });
    assert.equal(screen.queryByRole("option", { name: "/stale" }), null);
    assert.equal(screen.queryByText(SKILLS_FAILED), null);
  });

  it("select surviving /name after mixed voucher still posts skillHandoff", async () => {
    const { host } = await mountApp({
      skillsCatalog: {
        disposition: "ready",
        commands: [
          { name: FIXTURE, description: "Forge skill fixture" },
          { name: "/b", description: "bee" },
        ],
      },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => assert.ok(screen.getByRole("option", { name: FIXTURE })));
    await user.click(screen.getByRole("option", { name: FIXTURE }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    const body = host.callsTo("/api/prompt").at(-1)?.body ?? {};
    assert.deepEqual(body.skillHandoff, { name: FIXTURE });
    assert.equal(firstToken(String(body.text ?? "")), FIXTURE);
  });

  it("select + Send posts skillHandoff and first-token /name", async () => {
    const { host } = await mountApp();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => assert.ok(screen.getByRole("option", { name: FIXTURE })));
    await user.click(screen.getByRole("option", { name: FIXTURE }));
    await waitFor(() => {
      assert.ok(screen.getByText(SKILLS_ARMED(FIXTURE)));
    });
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      assert.ok(host.callsTo("/api/prompt").length >= 1);
    });
    const body = host.callsTo("/api/prompt").at(-1)?.body ?? {};
    assert.deepEqual(body.skillHandoff, { name: FIXTURE });
    assert.equal(firstToken(String(body.text ?? "")), FIXTURE);
  });

  it("Chat typing / does not open Skills", async () => {
    cleanup();
    resetBrowserState("chat");
    await mountApp({
      mode: "chat",
      skillsCatalog: { disposition: "absent_non_vendor", commands: null },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    assert.equal(screen.queryByRole("listbox", { name: SKILLS_TITLE }), null);
    assert.equal(screen.queryByText(SKILLS_CHECKING), null);
    assert.equal(screen.queryByText(SKILLS_EMPTY), null);
  });

  it("Mini-Grok fallback has no Skills palette", async () => {
    await mountApp({
      codeAgent: fallbackCliFact,
      skillsCatalog: { disposition: "absent_non_vendor", commands: null },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    assert.equal(screen.queryByRole("listbox", { name: SKILLS_TITLE }), null);
    assert.equal(screen.queryByText(SKILLS_ARMED(FIXTURE)), null);
  });

  it("awaiting_first_valid shows Checking skills… with no armable rows", async () => {
    await mountApp({
      skillsCatalog: { disposition: "awaiting_first_valid", commands: null },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => {
      assert.ok(screen.getByText(SKILLS_CHECKING));
    });
    assert.equal(screen.queryByText(SKILLS_EMPTY), null);
    assert.equal(screen.queryByRole("option"), null);
  });

  it("ready + [] shows No skills from Grok Code", async () => {
    await mountApp({
      skillsCatalog: { disposition: "ready", commands: [] },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => {
      assert.ok(screen.getByText(SKILLS_EMPTY));
    });
    assert.equal(screen.queryByText(SKILLS_FAILED), null);
    assert.equal(screen.queryByRole("option"), null);
  });

  it("obtain_failed shows Couldn't load skills.", async () => {
    await mountApp({
      skillsCatalog: { disposition: "obtain_failed", commands: null },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => {
      assert.ok(screen.getByText(SKILLS_FAILED));
    });
    assert.equal(screen.queryByText(SKILLS_EMPTY), null);
    assert.equal(screen.queryByRole("option"), null);
  });

  it("fallback after arm clears the chip immediately", async () => {
    const { host, ws } = await mountApp();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => assert.ok(screen.getByRole("option", { name: FIXTURE })));
    await user.click(screen.getByRole("option", { name: FIXTURE }));
    await waitFor(() => {
      assert.equal(document.body.textContent?.includes(SKILLS_ARMED(FIXTURE)), true);
    });
    const live = FakeWebSocket.latest() ?? ws;
    live.emit({
      type: "state",
      state: {
        ...host.state,
        codeAgent: fallbackCliFact,
        skillsCatalog: { disposition: "absent_non_vendor", commands: null },
      },
    });
    await waitFor(() => {
      assert.equal(document.body.textContent?.includes(CODE_AGENT_FALLBACK_CLI), true);
      assert.equal(document.body.textContent?.includes(SKILLS_ARMED(FIXTURE)), false);
    });
    assert.equal(screen.queryByRole("listbox", { name: SKILLS_TITLE }), null);
  });

  it("armed missing at send shows Skill no longer available. and does not freestyle-retry", async () => {
    const { host } = await mountApp({
      promptRefuse: {
        status: 409,
        code: "skill_handoff_unavailable",
        error: SKILLS_UNAVAILABLE,
      },
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "/");
    await waitFor(() => assert.ok(screen.getByRole("option", { name: FIXTURE })));
    await user.click(screen.getByRole("option", { name: FIXTURE }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      assert.ok(screen.getAllByText(SKILLS_UNAVAILABLE).length >= 1);
    });
    await waitFor(() => {
      assert.equal(screen.queryByText(SKILLS_ARMED(FIXTURE)), null);
    });
    const prompts = host.callsTo("/api/prompt");
    assert.equal(prompts.length, 1);
    assert.deepEqual(prompts[0]?.body?.skillHandoff, { name: FIXTURE });
  });

  it("handoff-consumed paints Skill · /name sent and withholds Started ·", async () => {
    const { ws } = await mountApp();
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            skillHandoffProvenance: { kind: "consumed", name: FIXTURE },
          }),
        },
        1,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(screen.getByText(SKILLS_SENT(FIXTURE)));
    });
    assert.equal(document.body.textContent?.includes("Started ·"), false);
    assert.equal(/before it thinks/i.test(document.body.textContent ?? ""), false);
  });

  it("dismiss / unmatched slash send is unarmed (skillHandoff null)", async () => {
    const { host } = await mountApp();
    const user = userEvent.setup({ delay: null });
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "/");
    await waitFor(() => assert.ok(screen.getByRole("listbox", { name: SKILLS_TITLE })));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      assert.equal(screen.queryByRole("listbox", { name: SKILLS_TITLE }), null);
    });
    await user.clear(composer);
    await user.type(composer, "/not-a-listed-skill");
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    assert.equal(send.disabled, true);
    assert.equal(host.callsTo("/api/prompt").length, 0);
  });
});

describe("slash-skills catch-up / dock / thought adversaries", () => {
  it("mergeRunSnapshot keeps consumed on omitted-key replay and never invents consumed", () => {
    const baseSnap = runSnapshot();
    const admitted = mergeRunSnapshot(initialRunProjection(), baseSnap);
    assert.equal(admitted.runsById[RUN_ID]?.skillHandoffProvenance ?? null, null);
    const consumed = mergeRunSnapshot(admitted, {
      ...baseSnap,
      skillHandoffProvenance: { kind: "consumed", name: FIXTURE },
    });
    assert.equal(consumed.runsById[RUN_ID]?.skillHandoffProvenance?.kind, "consumed");
    assert.equal(consumed.runsById[RUN_ID]?.skillHandoffProvenance?.name, FIXTURE);
    const omitted: RunSnapshot = { ...baseSnap };
    delete omitted.skillHandoffProvenance;
    const replay = mergeRunSnapshot(consumed, omitted);
    assert.equal(replay.runsById[RUN_ID]?.skillHandoffProvenance?.kind, "consumed");
    const restored = restoreRunProjection(
      JSON.parse(JSON.stringify(persistableRunProjection(replay))),
    );
    assert.equal(restored.runsById[RUN_ID]?.skillHandoffProvenance?.kind, "consumed");
    const none = mergeRunSnapshot(consumed, {
      ...baseSnap,
      skillHandoffProvenance: { kind: "none", name: null },
    });
    assert.equal(none.runsById[RUN_ID]?.skillHandoffProvenance?.kind, "none");
  });

  it("skill-driven pending permission keeps Send locked and dock as settle home", async () => {
    const { ws } = await mountApp();
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            state: "waiting_for_decision",
            skillHandoffProvenance: { kind: "consumed", name: FIXTURE },
          }),
        },
        1,
      ) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "decision_request",
          request: {
            requestId: "perm-1",
            invocationId: "inv-1",
            kind: "permission",
            status: "pending",
            title: "Run shell",
            detail: "npm test",
            expiresAt: null,
            policy: { effectiveMode: "review" },
          },
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Pending agent actions"));
    });
    assert.ok(screen.getByLabelText("Grok wants to run a command"));
    const send = screen.queryByRole("button", { name: "Send" });
    if (send) {
      assert.equal(send.hasAttribute("disabled"), true);
      assert.equal(send.getAttribute("title"), SETTLE_CARD_BELOW);
    }
    assert.equal(screen.queryByText(TURN_COPY), null);
    assert.equal(screen.queryByRole("listbox", { name: SKILLS_TITLE }), null);
  });

  it("thought is not the Answer on a skill-handoff run", async () => {
    const { ws } = await mountApp();
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            skillHandoffProvenance: { kind: "consumed", name: FIXTURE },
          }),
        },
        1,
      ) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope({ kind: "reasoning_delta", segmentId: "r", delta: "private thought" }, 2) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope({
        kind: "run_terminal",
        terminalKind: "answered",
        finalAnswer: "vouched answer",
        answerVouched: true,
        failure: null,
        terminalAt: "",
      }, 3) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
    });
    assert.ok(screen.getByText("private thought"));
    const answer = screen.getByRole("article", { name: "Assistant answer" });
    assert.equal(answer.textContent?.includes("private thought"), false);
    assert.ok(answer.textContent?.includes("vouched answer"));
    const thought = screen.getByText("Thought").closest("details");
    assert.ok(thought);
    assert.equal(thought?.textContent?.includes("vouched answer"), false);
  });
});
