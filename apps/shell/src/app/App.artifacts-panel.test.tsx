import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import { setHealthPollTestScheduler } from "../lib/healthPollTestClock";
import { setArtifactPanelForceRenderError } from "../dock/ArtifactPanel";
import { CHANGES_DOCK_LABEL } from "../dock/ChangesDock";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

const CHAT_PARTITION = "chat:__sandbox__";
const WORKSPACE = "C:\\repo";
const SESSION_ID = "artifact-session";
const SESSION_B = "artifact-session-b";
const RUN_ID = "artifact-run";

const carousel = {
  version: 1,
  blocks: [
    {
      type: "carousel",
      title: "Best sides",
      items: [{ title: "Steamed rice", body: "Short-grain.", badge: "Essential" }],
    },
  ],
};

const choicesDoc = {
  version: 1,
  blocks: [
    {
      type: "choices",
      prompt: "Pick one",
      options: [{ label: "Alpha", description: "first" }],
    },
  ],
};

function fencedGrokUi(doc: unknown): string {
  return "```grok-ui\n" + JSON.stringify(doc) + "\n```";
}

function failedFence(): string {
  return "```grok-ui\nnot-json{{{{{\n```";
}

function prose(n: number, ch = "a"): string {
  return ch.repeat(n);
}

function chatSession(id: string, title: string, messages: Array<{ id: string; role: "user" | "assistant"; content: string }>) {
  return {
    id,
    workspace: CHAT_PARTITION,
    title,
    committedName: true,
    messages,
    updatedAt: Date.now(),
    status: "live" as const,
    subagents: [] as [],
    open: true,
  };
}

function resetChatState(extraSessions: ReturnType<typeof chatSession>[] = []): void {
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
  const sessions = [
    chatSession(SESSION_ID, "Artifact chat", [
      { id: "u1", role: "user", content: "sibling question" },
    ]),
    ...extraSessions,
  ];
  reloadSessionsFromDisk({
    byWorkspace: { [CHAT_PARTITION]: sessions },
    activeId: { [CHAT_PARTITION]: SESSION_ID },
    pinned: [],
    expanded: [],
  });
  FakeWebSocket.reset();
  setArtifactPanelForceRenderError(false);
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "sibling question",
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

async function mountApp(opts: { mode?: "chat" | "code"; workspace?: string | null } = {}) {
  const mode = opts.mode ?? "chat";
  const host = createFakeHost({
    mode,
    workspace: opts.workspace ?? (mode === "code" ? WORKSPACE : null),
    workspaceName: mode === "code" || opts.workspace ? "repo" : null,
    busy: false,
    connected: true,
    hasApiKey: true,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await waitFor(() => assert.ok(document.getElementById("composer-input")), { timeout: 10000 });
  await waitFor(() => assert.ok(FakeWebSocket.latest()), { timeout: 10000 });
  return { host, ws: FakeWebSocket.latest()! };
}

async function settleElevatable(ws: FakeWebSocket, text: string, seqStart = 1, runId = RUN_ID) {
  ws.emit(
    envelope(
      { kind: "run_started", run: runSnapshot({ runId, lastEventSeq: seqStart }) },
      seqStart,
      runId,
    ) as unknown as Record<string, unknown>,
  );
  ws.emit(
    envelope(
      {
        kind: "run_terminal",
        terminalKind: "answered",
        finalAnswer: text,
        answerVouched: true,
        failure: null,
        terminalAt: "",
      },
      seqStart + 1,
      runId,
    ) as unknown as Record<string, unknown>,
  );
  await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
}

function assertCompact(el: HTMLElement) {
  const cs = getComputedStyle(el);
  assert.ok(
    cs.display === "none" || el.getAttribute("hidden") != null || cs.visibility === "hidden",
  );
  assert.ok(cs.overflow !== "auto" && cs.overflow !== "scroll");
  assert.ok(cs.overflowY !== "auto" && cs.overflowY !== "scroll");
}

function clickFirstOpen(): void {
  const btns = screen.queryAllByRole("button", { name: /^Open$/i });
  assert.ok(btns.length >= 1, `expected an Open button, found ${btns.length}`);
  fireEvent.click(btns[0]!);
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
  resetChatState();
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  FakeWebSocket.reset();
  setHealthPollTestScheduler(null);
  setArtifactPanelForceRenderError(false);
});

describe("artifacts-panel App journeys", () => {
  it("live settle-then-Open: same-kind body, compact RunSurface, Close ≠ delete, remount closed", async () => {
    const { ws } = await mountApp();
    const text = "Intro\n\n" + fencedGrokUi(carousel);
    await settleElevatable(ws, text);
    assert.equal(Boolean(document.querySelector(".artifact-panel")), false);

    clickFirstOpen();
    const panel = await waitFor(() => {
      const el = document.querySelector(".artifact-panel");
      assert.ok(el);
      return el as HTMLElement;
    });
    const heading = within(panel).getByRole("heading");
    assert.match(heading.textContent ?? "", /Beside/);
    assert.match(heading.textContent ?? "", /Artifact chat/);
    assert.ok(within(panel).getByText("Best sides"));
    assert.ok(within(panel).getByText("Steamed rice"));

    const transcript = document.querySelector(".transcript") as HTMLElement;
    const answer = transcript.querySelector(".assistant-answer") as HTMLElement;
    assert.ok(answer);
    assert.ok(answer.classList.contains("assistant-answer--compact"));
    assertCompact(answer);
    assert.equal(answer.textContent?.includes("Steamed rice"), false);
    assert.ok(transcript.textContent?.includes("sibling question"));

    fireEvent.click(within(panel).getByRole("button", { name: /^Close$/i }));
    await waitFor(() => assert.equal(Boolean(document.querySelector(".artifact-panel")), false));
    assert.ok(screen.getAllByText("Steamed rice").length >= 1);
    assert.ok((document.querySelector(".transcript")?.textContent ?? "").includes("sibling question"));

    cleanup();
    render(<App />);
    await waitFor(() => assert.ok(document.getElementById("composer-input")), { timeout: 10000 });
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
    assert.equal(Boolean(document.querySelector(".artifact-panel")), false);
    assert.ok(screen.getByText("Steamed rice"));
  });

  it("mixed failed fence + ≥ 1500 remainder opens long-markdown with non-failed body", async () => {
    const remainder = prose(1500, "p");
    const text = failedFence() + "\n\n" + remainder;
    const { ws } = await mountApp();
    await settleElevatable(ws, text);
    clickFirstOpen();
    const panel = await waitFor(() => {
      const el = document.querySelector(".artifact-panel");
      assert.ok(el);
      return el as HTMLElement;
    });
    assert.equal(panel.textContent?.includes("```grok-ui"), false);
    assert.equal(panel.textContent?.includes("not-json"), false);
    assert.ok((panel.textContent ?? "").includes(remainder));
  });

  it("short 1499 reply has no Open; elevatable settle does not auto-open", async () => {
    const { ws } = await mountApp();
    ws.emit(
      envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: prose(1499, "s"),
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(document.querySelector(".assistant-answer")));
    assert.equal(screen.queryByRole("button", { name: /^Open$/i }) === null, true);
    assert.equal(Boolean(document.querySelector(".artifact-panel")), false);

    ws.emit(
      envelope(
        { kind: "run_started", run: runSnapshot({ runId: "run-2" }) },
        1,
        "run-2",
      ) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: fencedGrokUi(carousel),
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
        2,
        "run-2",
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
    assert.equal(Boolean(document.querySelector(".artifact-panel")), false);
  });

  it("Thought, mid-turn, and failed-only ≥ 1500 never mint Open; mixed success+failed does", async () => {
    const { ws } = await mountApp();
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(
      envelope({ kind: "reasoning_delta", segmentId: "r", delta: "secret thought" }, 2) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.queryByText("secret thought")));
    assert.equal(screen.queryByRole("button", { name: /^Open$/i }) === null, true);

    ws.emit(
      envelope({ kind: "message_delta", segmentId: "m", delta: "unfinished words still streaming" }, 3) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.queryByText(/unfinished words/)));
    assert.equal(screen.queryByRole("button", { name: /^Open$/i }) === null, true);

    cleanup();
    resetChatState();
    const { ws: ws2 } = await mountApp();
    const dump = "```grok-ui\n" + prose(1600, "x") + "\n```";
    ws2.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws2.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: dump,
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(document.querySelector(".assistant-answer")));
    assert.equal(screen.queryByRole("button", { name: /^Open$/i }) === null, true);

    cleanup();
    resetChatState();
    const { ws: ws3 } = await mountApp();
    const mixed = fencedGrokUi(carousel) + "\n\n" + failedFence();
    await settleElevatable(ws3, mixed);
    clickFirstOpen();
    const panel = await waitFor(() => document.querySelector(".artifact-panel") as HTMLElement);
    assert.ok(within(panel).getByText("Steamed rice"));
  });

  it("opening a second elevatable document replaces the single panel", async () => {
    const docA = {
      version: 1,
      blocks: [{ type: "carousel", title: "Doc A", items: [{ title: "Alpha card", body: "a" }] }],
    };
    const docB = {
      version: 1,
      blocks: [{ type: "carousel", title: "Doc B", items: [{ title: "Beta card", body: "b" }] }],
    };
    resetChatState();
    reloadSessionsFromDisk({
      byWorkspace: {
        [CHAT_PARTITION]: [
          chatSession(SESSION_ID, "Artifact chat", [
            { id: "u1", role: "user", content: "sibling question" },
            { id: "a1", role: "assistant", content: fencedGrokUi(docA) },
            { id: "a2", role: "assistant", content: fencedGrokUi(docB) },
          ]),
        ],
      },
      activeId: { [CHAT_PARTITION]: SESSION_ID },
      pinned: [],
      expanded: [],
    });
    await mountApp();
    await waitFor(() => {
      assert.ok(document.body.textContent?.includes("Doc A"));
      assert.ok(document.body.textContent?.includes("Doc B"));
    }, { timeout: 10000 });
    const opens = screen.queryAllByRole("button", { name: /^Open$/i });
    assert.equal(opens.length, 2, `open buttons=${opens.length}`);
    fireEvent.click(opens[0]!);
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")), { timeout: 10000 });
    assert.ok(document.querySelector(".artifact-panel")?.textContent?.includes("Doc A"));
    fireEvent.click(screen.queryAllByRole("button", { name: /^Open$/i })[1]!);
    await waitFor(() => {
      const panel = document.querySelector(".artifact-panel");
      assert.ok(panel?.textContent?.includes("Doc B"));
      assert.equal(panel?.textContent?.includes("Doc A"), false);
    }, { timeout: 10000 });
    assert.equal(document.querySelectorAll(".artifact-panel").length, 1);
  });

  it("honest empty has no panel; shared-renderer throw is open-error and keeps the turn", async () => {
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
      if (text.includes("forced shared renderer") || text.includes("ThrowOnRender")) return;
      prevError.apply(console, args);
    };
    try {
    await mountApp();
    assert.equal(Boolean(document.querySelector(".artifact-panel")), false);
    assert.equal(screen.queryByText("Couldn't open this artifact.") === null, true);

    cleanup();
    resetChatState();
    const { ws } = await mountApp();
    await settleElevatable(ws, fencedGrokUi(carousel));
    setArtifactPanelForceRenderError(true);
    clickFirstOpen();
    await waitFor(() => assert.ok(screen.queryByText("Couldn't open this artifact.")));
    assert.ok(document.querySelector(".artifact-panel"));
    assert.ok((document.querySelector(".transcript")?.textContent ?? "").includes("sibling question"));
    assert.equal(screen.queryByText("0 artifacts") === null, true);
    } finally {
      console.error = prevError;
    }
  });

  it("source-gone clears to absent, not open-error", async () => {
    const { ws } = await mountApp();
    await settleElevatable(ws, fencedGrokUi(carousel));
    clickFirstOpen();
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")));
    const confirm = window.confirm;
    window.confirm = () => true;
    try {
      fireEvent.click(screen.getByTitle("Delete"));
    } finally {
      window.confirm = confirm;
    }
    await waitFor(() => assert.equal(Boolean(document.querySelector(".artifact-panel")), false));
    assert.equal(screen.queryByText("Couldn't open this artifact.") === null, true);
  });

  it("permission settle stays in the Action dock while Artifact is open; Esc does not steal from dock", async () => {
    resetChatState();
    reloadSessionsFromDisk({
      byWorkspace: {
        [CHAT_PARTITION]: [
          chatSession(SESSION_ID, "Artifact chat", [
            { id: "u1", role: "user", content: "sibling question" },
            { id: "a1", role: "assistant", content: fencedGrokUi(carousel) },
          ]),
        ],
      },
      activeId: { [CHAT_PARTITION]: SESSION_ID },
      pinned: [],
      expanded: [],
    });
    const { ws } = await mountApp();
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
    clickFirstOpen();
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")));
    ws.emit(
      envelope({ kind: "run_started", run: runSnapshot({ state: "waiting_for_decision", runId: "perm-run" }) }, 1, "perm-run") as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope({ kind: "decision_request", request: shellPermission() }, 2, "perm-run") as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.queryByRole("region", { name: "Grok wants to run a command" })));
    const dockCard = screen.getByRole("region", { name: "Grok wants to run a command" });
    assert.ok(within(dockCard).getByRole("button", { name: "Allow" }));
    const panel = document.querySelector(".artifact-panel") as HTMLElement;
    assert.ok(panel);
    assert.equal(within(panel).queryByRole("button", { name: "Allow" }) === null, true);
    assert.equal(within(panel).queryByRole("button", { name: "Deny" }) === null, true);

    fireEvent.keyDown(window, { key: "Escape" });
    assert.ok(document.querySelector(".artifact-panel"));
  });

  it("Code elevatable Open leaves File changes members; Open does not mint pack membership", async () => {
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
          title: "Code artifact",
          committedName: true,
          messages: [{ id: "u1", role: "user", content: "edit and document" }],
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
    const { host, ws } = await mountApp({ mode: "code", workspace: WORKSPACE });
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: writeActivity() }, 2) as unknown as Record<string, unknown>);
    ws.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: fencedGrokUi(carousel),
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
        3,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.queryByLabelText(CHANGES_DOCK_LABEL)));
    // Task 15 — Open now lives on the in-thread .beside card, not
    // .assistant-answer-actions; the accessible name is the stable hook.
    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")));
    assert.ok(screen.getByLabelText(CHANGES_DOCK_LABEL));
    // The dock splits a row's path into a muted dir span and a filename span
    // (see ChangesDock.tsx's FileRow) — "src/a.ts" is never one text node.
    assert.ok(within(screen.getByLabelText(CHANGES_DOCK_LABEL)).getByText("src/"));
    assert.ok(within(screen.getByLabelText(CHANGES_DOCK_LABEL)).getByText("a.ts"));
    assert.equal(
      host.callsTo("/api/chat-pack").some((c) => c.body?.action === "pin_file"),
      false,
    );
  });

  it("Thought stays separate when a final elevatable Answer exists", async () => {
    const { ws } = await mountApp();
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(
      envelope({ kind: "reasoning_delta", segmentId: "r", delta: "private reasoning should not elevate" }, 2) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: fencedGrokUi(carousel),
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
        3,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
    clickFirstOpen();
    const panel = await waitFor(() => document.querySelector(".artifact-panel") as HTMLElement);
    assert.ok(within(panel).getByText("Steamed rice"));
    assert.equal(panel.textContent?.includes("private reasoning should not elevate"), false);
  });

  it("panel choice fills the composer and does not auto-send", async () => {
    const { host, ws } = await mountApp();
    const promptCallsBefore = host.callsTo("/api/prompt").length;
    await settleElevatable(ws, fencedGrokUi(choicesDoc));
    clickFirstOpen();
    const panel = await waitFor(() => document.querySelector(".artifact-panel") as HTMLElement);
    fireEvent.click(within(panel).getByText("Alpha"));
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    await waitFor(() => assert.match(composer.value, /I choose: Alpha/));
    assert.equal(host.callsTo("/api/prompt").length, promptCallsBefore);
  });

  it("conversation switch clears; return does not restore; Esc closes when dock is idle", async () => {
    resetChatState([
      chatSession(SESSION_B, "Other chat", [{ id: "u-b", role: "user", content: "other thread" }]),
    ]);
    const { ws } = await mountApp();
    await settleElevatable(ws, fencedGrokUi(carousel));
    clickFirstOpen();
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")));

    const otherTitle = [...document.querySelectorAll(".session-title")].find(
      (el) => el.textContent === "Other chat",
    );
    assert.ok(otherTitle);
    fireEvent.click(otherTitle.closest("button") ?? otherTitle);
    await waitFor(() => {
      assert.ok((document.querySelector(".transcript")?.textContent ?? "").includes("other thread"));
      assert.equal(Boolean(document.querySelector(".artifact-panel")), false);
    });

    const firstTitle = [...document.querySelectorAll(".session-title")].find(
      (el) => el.textContent === "Artifact chat",
    );
    assert.ok(firstTitle);
    fireEvent.click(firstTitle.closest("button") ?? firstTitle);
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
    assert.equal(Boolean(document.querySelector(".artifact-panel")), false);

    clickFirstOpen();
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")));
    (document.getElementById("composer-input") as HTMLTextAreaElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape", bubbles: true });
    await waitFor(() => assert.equal(Boolean(document.querySelector(".artifact-panel")), false));
  });

  it("Chat↔Code mode switch on the same conversation id keeps the binding", async () => {
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
    const shared = {
      id: SESSION_ID,
      title: "Shared conv",
      committedName: true,
      messages: [{ id: "u1", role: "user" as const, content: "sibling question" }],
      updatedAt: Date.now(),
      status: "live" as const,
      subagents: [] as [],
      open: true,
    };
    reloadSessionsFromDisk({
      byWorkspace: {
        [CHAT_PARTITION]: [{ ...shared, workspace: CHAT_PARTITION }],
        [WORKSPACE]: [{ ...shared, workspace: WORKSPACE }],
      },
      activeId: { [CHAT_PARTITION]: SESSION_ID, [WORKSPACE]: SESSION_ID },
      pinned: [WORKSPACE],
      expanded: [WORKSPACE],
    });
    FakeWebSocket.reset();
    const { ws } = await mountApp({ workspace: WORKSPACE });
    await settleElevatable(ws, fencedGrokUi(carousel));
    clickFirstOpen();
    await waitFor(() => assert.ok(document.querySelector(".artifact-panel")));
    const codeRadio = screen.queryByRole("radio", { name: "Code" });
    assert.ok(codeRadio);
    fireEvent.click(codeRadio);
    await waitFor(() =>
      assert.equal(screen.queryByRole("radio", { name: "Code" })?.getAttribute("aria-checked"), "true"),
    );
    assert.ok(document.querySelector(".artifact-panel"));
    assert.ok(within(document.querySelector(".artifact-panel") as HTMLElement).getByText("Steamed rice"));
  });

  it("historical ChatBubble Open + compact works without a live run", async () => {
    resetChatState();
    reloadSessionsFromDisk({
      byWorkspace: {
        [CHAT_PARTITION]: [
          chatSession(SESSION_ID, "Artifact chat", [
            { id: "u1", role: "user", content: "sibling question" },
            { id: "hist-1", role: "assistant", content: fencedGrokUi(carousel) },
          ]),
        ],
      },
      activeId: { [CHAT_PARTITION]: SESSION_ID },
      pinned: [],
      expanded: [],
    });
    await mountApp();
    await waitFor(() => assert.ok(screen.queryByRole("button", { name: /^Open$/i })));
    clickFirstOpen();
    const panel = await waitFor(() => document.querySelector(".artifact-panel") as HTMLElement);
    assert.ok(within(panel).getByText("Steamed rice"));
    const compact = document.querySelector(".msg-body--artifact-compact") as HTMLElement;
    assert.ok(compact);
    assertCompact(compact);
    assert.ok(screen.getByText("sibling question"));
  });
});
