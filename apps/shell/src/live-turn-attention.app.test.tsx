import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import { api } from "./api";
import { CHANGES_DOCK_LABEL } from "./ChangesDock";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "live-turn-session";
const RUN_ID = "live-turn-run";
const RUN_ID_2 = "live-turn-run-2";
const TURN_COPY = "Your turn";
const SHELL_DETAIL = "echo live-turn-attention";

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
        title: "Live turn",
        messages: [{ id: "u1", role: "user", content: "watch the burst" }],
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

function liveSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "waiting_for_decision",
    acceptedPrompt: "watch the burst",
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

function envelope(payload: RunEventEnvelope["payload"], seq: number, runId: string = RUN_ID): RunEventEnvelope {
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

function shellPermission(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "perm-1",
    invocationId: "inv-perm",
    kind: "permission",
    status: "pending",
    title: "Run shell",
    detail: SHELL_DETAIL,
    expiresAt: null,
    policy: {},
    ...overrides,
  };
}

function writeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "act-d",
    invocationId: "inv-d",
    name: "write_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "notes.md" },
    output: null,
    error: null,
    diff: "--- a/notes.md\n+++ b/notes.md\n+hi",
    path: "notes.md",
    policy: { effectiveMode: "review" },
    automaticEligibility: "not_eligible",
    autoApplied: false,
    command: null,
    editId: "edit-d",
    recovery: null,
    ...overrides,
  };
}

function diffDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "diff-1",
    invocationId: "inv-d",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "notes.md",
    expiresAt: null,
    policy: {},
    ...overrides,
  };
}

function seedPersistedRun(lastEventSeq: number): void {
  localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
    runs: [{
      ...liveSnapshot({ lastEventSeq, state: "waiting_for_decision" }),
      reasoning: {},
      answer: {},
      activities: {},
      decisions: {},
      seenEventSeq: lastEventSeq > 0 ? [1] : [],
      terminalEventSeq: null,
    }],
    cursors: { [SESSION_ID]: lastEventSeq },
  }));
}

async function mountApp(mode: "chat" | "code" = "code") {
  const host = createFakeHost({
    mode,
    workspace: mode === "code" ? WORKSPACE : null,
    workspaceName: mode === "code" ? "repo" : null,
    chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox",
    busy: false,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await waitFor(() => {
    assert.ok(screen.getByLabelText("Message to agent"));
  });
  await waitFor(() => assert.ok(FakeWebSocket.latest()));
  return { host, ws: FakeWebSocket.latest()! };
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
  resetBrowserState("code");
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
});

describe("live-turn-attention App wiring", () => {
  it("envelope decision_request fills dock and rail without a legacy permission_request", async () => {
    const { host, ws } = await mountApp("code");
    ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);

    const dock = await screen.findByRole("region", { name: "Pending agent actions" });
    assert.ok(within(dock).getByRole("region", { name: "Grok wants to run a command" }));
    assert.ok(within(dock).getByText(SHELL_DETAIL));
    assert.ok(screen.getByText("Permission requested: shell"));

    fireEvent.click(within(dock).getByRole("button", { name: "Allow" }));
    await waitFor(() => {
      const calls = host.callsTo("/api/permission");
      assert.ok(calls.length >= 1);
      const body = calls[calls.length - 1]!.body;
      assert.equal(body?.sessionId, SESSION_ID);
      assert.equal(body?.runId, RUN_ID);
      assert.equal(body?.requestId, "perm-1");
      assert.equal(body?.invocationId, "inv-perm");
      assert.equal(body?.decision, "allow_once");
    });

    ws.emit(envelope({
      kind: "decision_request",
      request: shellPermission({ status: "accepted" }),
    }, 3) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.equal(document.body.textContent?.includes("Grok wants to run a command"), false);
    });
    assert.equal(
      document.body.textContent?.includes("Permission requested: shell") ?? false,
      false,
    );
  });

  it("decision_not_found from Allow once does not raise an error banner", async () => {
    const { host, ws } = await mountApp("code");
    host.nextPermissionError = {
      status: 404,
      error: "no pending permission",
      code: "decision_not_found",
    };
    ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
    const dock = await screen.findByRole("region", { name: "Pending agent actions" });
    fireEvent.click(within(dock).getByRole("button", { name: "Allow" }));
    await waitFor(() => {
      assert.ok(host.callsTo("/api/permission").length >= 1);
    });
    assert.equal(document.querySelector(".banner-error"), null);
    assert.equal(screen.queryByText("no pending permission"), null);
  });

  it("GET /api/runs catch-up rebuilds dock and rail including Diff proposed path", async () => {
    seedPersistedRun(1);
    const replayRun = liveSnapshot({ lastEventSeq: 4, state: "waiting_for_decision" });
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
            envelope({ kind: "run_started", run: liveSnapshot() }, 1),
            envelope({ kind: "activity_update", activity: writeActivity() }, 2),
            envelope({ kind: "decision_request", request: shellPermission() }, 3),
            envelope({ kind: "decision_request", request: diffDecision() }, 4),
          ],
        },
      },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);

    const dock = await screen.findByRole("region", { name: "Pending agent actions" });
    assert.ok(within(dock).getByRole("region", { name: "Grok wants to run a command" }));
    // Task 9: the diff decision's Accept/Reject render in the (separate)
    // Changes dock now, not inside "Pending agent actions".
    const changesDock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL });
    assert.ok(within(changesDock).getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      assert.ok(screen.getByText("Permission requested: shell"));
      assert.ok(screen.getByText("Diff proposed: notes.md"));
    });
    assert.ok(host.callsTo("/api/runs").length >= 1);
  });

  it("non-terminal run with no pending withholds Your turn and keeps Stop chrome", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({
      kind: "run_started",
      run: liveSnapshot({ state: "running" }),
    }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: "Stop" }));
    });
    assert.equal(screen.queryByText(TURN_COPY), null);
    assert.equal(screen.queryByRole("button", { name: "Send" }), null);
  });

  it("AC10 live permission wait uses busy/Stop chrome, not Attention required Send", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
    await screen.findByRole("region", { name: "Grok wants to run a command" });
    assert.equal(screen.queryByText(TURN_COPY), null);
    assert.ok(screen.getByRole("button", { name: "Stop" }));
    assert.equal(screen.queryByRole("button", { name: "Send" }), null);
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.disabled, true);
    assert.equal(composer.placeholder, "Settle the card below");
    assert.equal(screen.queryByText("Run stalled"), null);
    assert.equal(screen.queryByText("No response"), null);
  });

  it("terminal leftover permission drops the card and unlocks Send", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
    await screen.findByRole("region", { name: "Grok wants to run a command" });
    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "cancelled",
      finalAnswer: null,
      answerVouched: false,
      failure: null,
      terminalAt: "",
    }, 3) as unknown as Record<string, unknown>);
    const send = await screen.findByRole("button", { name: "Send" });
    assert.notEqual(send.getAttribute("title"), "Attention required");
    assert.equal(screen.queryByRole("region", { name: "Grok wants to run a command" }), null);
  });

  it("clean finish paints the response node done and unlocks Send", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({
      kind: "run_started",
      run: liveSnapshot({ state: "running" }),
    }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "done",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(document.querySelector(".node--done"));
    });
    const composer = screen.getByLabelText("Message to agent");
    fireEvent.change(composer, { target: { value: "next" } });
    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.hasAttribute("disabled"), false);
  });

  it("elapsed silence alone never paints Your turn", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({
      kind: "run_started",
      run: liveSnapshot({ state: "running" }),
    }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Stop" })));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(screen.queryByText(TURN_COPY), null);
  });

  it("settle failure keeps the dock item and does not unlock turn-ready", async () => {
    const original = api.runPermission;
    api.runPermission = (async () => {
      const err = new Error("request expired") as Error & { code?: string };
      err.code = "request_expired";
      throw err;
    }) as typeof api.runPermission;
    try {
      const { ws } = await mountApp("code");
      ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
      ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
      const dock = await screen.findByRole("region", { name: "Pending agent actions" });
      fireEvent.click(within(dock).getByRole("button", { name: "Allow" }));
      await waitFor(() => {
        assert.ok(screen.getByRole("region", { name: "Grok wants to run a command" }));
      });
      assert.equal(screen.queryByText(TURN_COPY), null);
      assert.ok(screen.getByRole("button", { name: "Stop" }));
    } finally {
      api.runPermission = original;
    }
  });

  it("explicit collapse mid-burst keeps the group closed while dock and withheld turn stay honest", async () => {
    const { host, ws } = await mountApp("code");
    const composer = screen.getByLabelText("Message to agent");
    fireEvent.change(composer, { target: { value: "watch the burst" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    const burstActivity = (i: number): ActivityRecord => ({
      activityId: `burst-${i}`,
      invocationId: `burst-${i}`,
      name: "read_file",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      input: { path: `f${i}.txt` },
      output: `out-${i}`,
      error: null,
      diff: null,
      path: `f${i}.txt`,
      policy: {},
      automaticEligibility: "read",
      autoApplied: false,
      command: null,
      editId: null,
      recovery: null,
      summary: `f${i}.txt`,
      title: null,
    });
    ws.emit(envelope({ kind: "run_started", run: liveSnapshot({ state: "running" }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: burstActivity(1) }, 2) as unknown as Record<string, unknown>);
    const head = await screen.findByRole("button", { name: /action/i });
    fireEvent.click(head);
    assert.equal(head.getAttribute("aria-expanded"), "false");
    ws.emit(envelope({ kind: "activity_update", activity: burstActivity(2) }, 3) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 4) as unknown as Record<string, unknown>);
    await screen.findByRole("region", { name: "Grok wants to run a command" });
    assert.equal(head.getAttribute("aria-expanded"), "false");
    assert.equal(screen.queryByText(TURN_COPY), null);
  });

  it("Chat and Code share dock presence and withheld Your turn for the same pending permission", async () => {
    async function assertParity(mode: "chat" | "code") {
      cleanup();
      resetBrowserState(mode);
      const { ws } = await mountApp(mode);
      ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
      ws.emit(envelope({ kind: "decision_request", request: shellPermission() }, 2) as unknown as Record<string, unknown>);
      const dock = await screen.findByRole("region", { name: "Pending agent actions" });
      assert.ok(within(dock).getByRole("region", { name: "Grok wants to run a command" }));
      assert.equal(screen.queryByText(TURN_COPY), null);
      assert.ok(screen.getByRole("button", { name: "Stop" }));
    }
    await assertParity("code");
    await assertParity("chat");
  });

  it("removes the permanent activityOuterStickDisabledRef latch", () => {
    const src = readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8");
    assert.equal(src.includes("activityOuterStickDisabledRef"), false);
  });

  it("keeps exactly one continuous spine across two runs in the same session", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({ kind: "run_started", run: liveSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "first done",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => assert.ok(document.querySelector(".node--done")));
    ws.emit(envelope(
      { kind: "run_started", run: liveSnapshot({ runId: RUN_ID_2, acceptedPrompt: "second prompt" }) },
      1,
      RUN_ID_2,
    ) as unknown as Record<string, unknown>);
    await waitFor(() => assert.equal(document.querySelectorAll(".run-content").length, 2));
    assert.equal(document.querySelectorAll(".spine").length, 1);
    assert.equal(document.querySelectorAll(".stream").length, 1);
  });
});
