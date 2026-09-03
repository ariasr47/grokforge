// Journey tests: Chat never mounts File changes; Code paints kind only from
// host-vouched fields; shell argv never invents Deleted/Renamed.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { partitionKey, reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import {
  CHANGES_DOCK_LABEL,
  FILE_CHANGES_KIND_DELETED,
  FILE_CHANGES_KIND_RENAMED,
} from "./ChangesDock";
import type { ActivityRecord, RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const CHAT_ROOT = "C:\\Users\\qa\\.grokforge\\chat-sandbox";
const SESSION_ID = "tdr-session";
const RUN_ID = "tdr-run";

function resetBrowserState(mode: "code" | "chat" = "code"): void {
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
  const partition = mode === "chat" ? partitionKey("chat", CHAT_ROOT) : WORKSPACE;
  reloadSessionsFromDisk({
    byWorkspace: {
      [partition]: [{
        id: SESSION_ID,
        workspace: partition,
        title: "Trusted deletes",
        messages: [{ id: "u1", role: "user", content: "delete a file" }],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [partition]: SESSION_ID },
    pinned: [partition],
    expanded: [partition],
  });
  FakeWebSocket.reset();
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "delete a file",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "trusted_workspace" },
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

function deleteActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-del",
    invocationId: "i-del",
    name: "delete_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { path: "gone.txt" },
    output: null,
    error: null,
    diff: null,
    path: "gone.txt",
    kind: "delete",
    fromPath: null,
    toPath: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e-del",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function renameActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-ren",
    invocationId: "i-ren",
    name: "rename_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { fromPath: "from.txt", toPath: "to.txt" },
    output: null,
    error: null,
    diff: null,
    path: "to.txt",
    kind: "rename",
    fromPath: "from.txt",
    toPath: "to.txt",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e-ren",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
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
  resetBrowserState();
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  setHealthPollTestScheduler(null);
});

describe("trusted-deletes-renames App pins (AC-21/22)", () => {
  it("Chat mode does not mount File changes when a vouched delete activity arrives", async () => {
    resetBrowserState("chat");
    const host = createFakeHost({
      mode: "chat",
      workspace: null,
      chatRoot: CHAT_ROOT,
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Message to agent"));
    });
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: snapshot({ lastEventSeq: 1 }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: deleteActivity() }, 2) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(screen.getByRole("article", { name: /Run delete a file/ }));
    });
    assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }), null);
    assert.equal(screen.queryByText(FILE_CHANGES_KIND_DELETED), null);
  });

  it("Code mode shows Deleted/Renamed only from vouched kind fields", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Message to agent"));
    });
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: snapshot({ lastEventSeq: 1 }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: deleteActivity() }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "activity_update", activity: renameActivity() }, 3) as unknown as Record<string, unknown>);

    await waitFor(() => {
      const section = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
      assert.ok(within(section).getByText(FILE_CHANGES_KIND_DELETED));
      assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
      assert.ok(within(section).getByText("gone.txt"));
      assert.ok(within(section).getByText("from.txt → to.txt"));
    });
  });

  it("Code mode shell delete/rename argv does not invent a File changes member", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Message to agent"));
    });
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: snapshot({ lastEventSeq: 1 }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "activity_update",
      activity: deleteActivity({
        activityId: "a-shell",
        invocationId: "i-shell",
        name: "run_shell",
        kind: null,
        path: "gone.txt",
        editId: "e-shell",
        autoApplied: true,
        automaticEligibility: "trusted_command_class",
        command: "del gone.txt",
        recovery: null,
      }),
    }, 2) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(screen.getByText(/run_shell|run shell/i));
    });
    assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }), null);
    assert.equal(screen.queryByText(FILE_CHANGES_KIND_DELETED), null);
    assert.equal(screen.queryByText(FILE_CHANGES_KIND_RENAMED), null);
  });
});
