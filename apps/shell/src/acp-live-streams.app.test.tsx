import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { ActivityRecord, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "als-session";
const RUN_ID = "als-run";
const TURN_COPY = "Your turn — type the next message below";

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
        title: "ACP live streams",
        messages: [{ id: "u1", role: "user", content: "stream please" }],
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
    acceptedPrompt: "stream please",
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

function readActivity(lifecycle: "pending" | "terminal"): ActivityRecord {
  return {
    activityId: "read-1",
    invocationId: "read-1",
    name: "read_file",
    lifecycle,
    execution: lifecycle === "terminal" ? "executed" : null,
    status: lifecycle === "terminal" ? "succeeded" : "running",
    input: { path: "notes.md" },
    output: lifecycle === "terminal" ? "hello" : null,
    error: null,
    diff: null,
    path: "notes.md",
    policy: {},
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    summary: "Read notes.md",
    title: "Reading notes.md",
  };
}

async function mountApp(mode: "chat" | "code" = "code") {
  const host = createFakeHost({
    mode,
    workspace: mode === "code" ? WORKSPACE : null,
    workspaceName: mode === "code" ? "repo" : null,
    chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox",
    busy: false,
    planEngagement: mode === "code" ? { engaged: false, vouched: true } : undefined,
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

describe("acp-live-streams App path", () => {
  it("journal activity_update plus private tool_run for the same identity paints one rail", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: readActivity("pending") }, 2) as unknown as Record<string, unknown>);
    ws.emit({
      schemaVersion: 2,
      type: "tool_run",
      activityId: "read-1",
      toolCallId: "read-1",
      lifecycle: "pending",
      execution: null,
      status: "running",
      name: "read_file",
      input: { path: "notes.md" },
      summary: "Read notes.md",
      title: "Reading notes.md",
      command: null,
      output: null,
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
    });
    await waitFor(() => {
      assert.equal(document.querySelectorAll("[data-activity-id='read-1']").length, 1);
    });
    const row = document.querySelector("[data-activity-id='read-1']");
    assert.ok(row?.textContent?.includes("Reading notes.md"));
    assert.equal(screen.getAllByLabelText("Activity").length, 1);
  });

  it("journal message_delta without private text_delta still updates mid-turn", async () => {
    cleanup();
    resetBrowserState("chat");
    const { ws } = await mountApp("chat");
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "message_delta", segmentId: "m", delta: "Chat mid-turn answer" }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Mid-turn narration").textContent?.includes("Chat mid-turn answer"));
    });
    assert.equal(screen.queryByRole("article", { name: "Assistant answer" }), null);
  });

  it("private Awaiting presence does not beat in-flight journal tool", async () => {
    const { ws } = await mountApp("code");
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: readActivity("pending") }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "run_state", state: "running", liveness: "tool" }, 3) as unknown as Record<string, unknown>);
    ws.emit({ type: "run_phase", phase: "waiting_model", detail: "Awaiting presence…" });
    await waitFor(() => {
      assert.equal(document.querySelectorAll("[data-activity-id='read-1']").length, 1);
      assert.ok(document.body.textContent?.includes("Reading notes.md"));
    });
    assert.equal(screen.queryByText("Awaiting presence…"), null);
    assert.equal(screen.queryByText(TURN_COPY), null);
  });

  it("Chat and Code share message_delta journal path", async () => {
    cleanup();
    resetBrowserState("chat");
    const chat = await mountApp("chat");
    chat.ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    chat.ws.emit(envelope({ kind: "message_delta", segmentId: "m", delta: "same path" }, 2) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Mid-turn narration").textContent?.includes("same path"));
    });
    cleanup();
    resetBrowserState("code");
    const code = await mountApp("code");
    code.ws.emit(envelope({ kind: "run_started", run: runSnapshot({ runId: "als-run-code" }) }, 1, "als-run-code") as unknown as Record<string, unknown>);
    code.ws.emit(envelope({ kind: "message_delta", segmentId: "m", delta: "same path" }, 2, "als-run-code") as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Mid-turn narration").textContent?.includes("same path"));
    });
  });

  it("offline does not wipe attached thought / mid-turn / tools / answer", async () => {
    localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
      runs: [{
        ...runSnapshot({ state: "terminal", terminalKind: "answered", finalAnswer: "kept", answerVouched: true, lastEventSeq: 5 }),
        reasoning: { r: "think" },
        answer: {},
        message: { m: "kept" },
        activities: { "read-1": readActivity("terminal") },
        decisions: {},
        seenEventSeq: [1, 2, 3, 4, 5],
        terminalEventSeq: 5,
      }],
      cursors: { [SESSION_ID]: 5 },
    }));
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: false,
      planEngagement: { engaged: false, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByText("think"));
      assert.ok(screen.getByLabelText("Mid-turn narration").textContent?.includes("kept"));
      assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
    });
  });

  it("App source does not treat private thinking_delta/text_delta/tool_run as live authority when a journal run is bound", () => {
    const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");
    assert.equal(appSource.includes("Writing answer…"), false);
    assert.match(appSource, /normalizedRunIdRef\.current/);
  });
});
