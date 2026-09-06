import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import {
  HOME_NAME_PLACEHOLDER,
  HOME_NAME_SAVE_FAILED,
  PACK_COMPOSER_ARMED_TOOLTIP,
  PACK_COMPOSER_EMPTY,
  PACK_COMPOSER_LOADING,
} from "../projections/chatPackComposer";
import { PACK_TURN_HYDRATING, PACK_TURN_INCLUDED } from "../projections/chatPackTurn";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import {
  loadSession,
  partitionKey,
  reloadSessionsFromDisk,
  updatePackMembers,
} from "../lib/sessions";
import type { RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

const CHAT_ROOT = "C:\\Users\\qa\\.grokforge\\chat-sandbox";
const CHAT_PART = partitionKey("chat", CHAT_ROOT);
const HOME_A = "home-a";
const HOME_B = "home-b";
const RUN_ID = "np-run";

function resetBrowserState(): void {
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
      [CHAT_PART]: [
        {
          id: HOME_A,
          workspace: CHAT_PART,
          title: "Auto title",
          committedName: false,
          packMembers: { files: [], note: null },
          messages: [],
          updatedAt: Date.now(),
          status: "live",
          subagents: [],
          open: true,
        },
        {
          id: HOME_B,
          workspace: CHAT_PART,
          title: "Other",
          committedName: true,
          packMembers: { files: [], note: null },
          messages: [],
          updatedAt: Date.now() - 1000,
          status: "idle",
          subagents: [],
          open: true,
        },
      ],
    },
    activeId: { [CHAT_PART]: HOME_A },
    pinned: [CHAT_PART],
    expanded: [CHAT_PART],
  });
  FakeWebSocket.reset();
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: HOME_A,
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
    sessionId: HOME_A,
    runId: RUN_ID,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
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
});

beforeEach(() => {
  resetBrowserState();
});

afterEach(() => {
  cleanup();
});

describe("named-projects App journeys", () => {
  it("commits a home name before any turn and keeps auto-title from overwriting", async () => {
    const host = createFakeHost({
      mode: "chat",
      workspace: null,
      busy: false,
      chatRoot: CHAT_ROOT,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    const trigger = document.querySelector(".chat-home-name-trigger") as HTMLButtonElement;
    assert.ok(trigger);
    fireEvent.click(trigger);
    const nameInput = screen.getByLabelText(HOME_NAME_PLACEHOLDER);
    fireEvent.change(nameInput, { target: { value: "Atlas" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => assert.ok(document.querySelector("[data-chat-home='committed']")));
    assert.match(document.querySelector("[data-chat-home='committed']")?.textContent ?? "", /Atlas/);
    const stored = loadSession(CHAT_PART, HOME_A);
    assert.equal(stored?.committedName, true);
    assert.equal(stored?.title, "Atlas");
    assert.equal(stored?.messages.length, 0);
  });

  it("save-failed home name shows exact copy and does not claim success", async () => {
    const host = createFakeHost({
      mode: "chat",
      workspace: null,
      busy: false,
      chatRoot: CHAT_ROOT,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new Error("quota exceeded");
    };
    try {
      const trigger = document.querySelector(".chat-home-name-trigger") as HTMLButtonElement;
      assert.ok(trigger);
      fireEvent.click(trigger);
      fireEvent.change(screen.getByLabelText(HOME_NAME_PLACEHOLDER), {
        target: { value: "Will fail" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => assert.ok(screen.getByText(HOME_NAME_SAVE_FAILED)));
      assert.equal(screen.queryByRole("button", { name: /^Will fail$/ }) === null, true);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it("pin via confined picker arms without Included; send carries conversationId", async () => {
    const host = createFakeHost(
      {
        mode: "chat",
        workspace: null,
        busy: false,
        chatRoot: CHAT_ROOT,
        sessionId: "host-sess",
      },
      { files: { "notes/brief.md": "brief" } },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(screen.getByText(PACK_COMPOSER_EMPTY)));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: PACK_COMPOSER_EMPTY }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Pin notes/brief.md" })));
    await user.click(screen.getByRole("button", { name: "Pin notes/brief.md" }));
    await waitFor(() => assert.ok(screen.getByText("Pack · 1 files")));
    const chip = screen.getByRole("button", { name: "Pack · 1 files" });
    assert.equal(chip.getAttribute("title"), PACK_COMPOSER_ARMED_TOOLTIP);
    assert.equal(screen.queryByText(PACK_TURN_INCLUDED) === null, true);
    fireEvent.change(screen.getByLabelText("Pack note"), { target: { value: "ship notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => assert.ok(screen.getByText("Pack · 1 files · note")));
    assert.equal(loadSession(CHAT_PART, HOME_A)?.packMembers?.note, "ship notes");
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "go" } });
    const sendBtn = screen.getByRole("button", { name: "Send" });
    assert.equal(sendBtn.hasAttribute("disabled"), false, sendBtn.getAttribute("title") ?? "");
    fireEvent.click(sendBtn);
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    const prompt = host.callsTo("/api/prompt")[0];
    assert.equal(prompt?.body?.conversationId, HOME_A);
    assert.equal(loadSession(CHAT_PART, HOME_A)?.packMembers?.files[0]?.path, "notes/brief.md");
  });

  it("A→B switch never paints A members on B while B is unconfirmed", async () => {
    updatePackMembers(CHAT_PART, HOME_A, {
      files: [{ path: "from-a.md" }],
      note: "alpha",
    });
    const host = createFakeHost(
      {
        mode: "chat",
        workspace: null,
        busy: false,
        chatRoot: CHAT_ROOT,
      },
      { holdHydrate: true, files: { "from-a.md": "A" } },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(screen.getAllByText(PACK_COMPOSER_LOADING).length >= 1));
    host.completeHydrate();
    FakeWebSocket.latest()?.emit({ type: "state", state: { ...host.state } });
    await waitFor(() => assert.ok(screen.getByText("Pack · 1 files · note")));
    const user = userEvent.setup();
    // Switch homes via the sidebar's own session list. Home's "Chat homes"
    // column (Task 13, un-parked) now legitimately lists this same session
    // too — real data, not a bug — so an unscoped screen.getByText("Other")
    // is ambiguous between the two. The sidebar is the actual surface this
    // test means to exercise (switching sessions), so scope to it.
    const sidebar = screen.getByRole("complementary", { name: "Chat sessions" });
    await user.click(within(sidebar).getByText("Other"));
    await waitFor(() => {
      assert.ok(screen.getAllByText(PACK_COMPOSER_LOADING).length >= 1);
      assert.equal(screen.queryByText("from-a.md") === null, true);
      assert.equal(screen.queryByText("alpha") === null, true);
      assert.equal(screen.queryByText(PACK_TURN_INCLUDED) === null, true);
    });
  });

  it("Code empty view must not wipe Chat-home packMembers", async () => {
    updatePackMembers(CHAT_PART, HOME_A, {
      files: [{ path: "keep.md" }],
      note: "stay",
    });
    const host = createFakeHost(
      {
        mode: "chat",
        workspace: null,
        busy: false,
        chatRoot: CHAT_ROOT,
      },
      { files: { "keep.md": "x" } },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(screen.getByText("Pack · 1 files · note")));
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() => {
      assert.equal(screen.queryByText("Pack · 1 files · note") === null, true);
      assert.equal(screen.queryByText(PACK_COMPOSER_EMPTY) === null, true);
    });
    const durable = loadSession(CHAT_PART, HOME_A);
    assert.equal(durable?.packMembers?.files[0]?.path, "keep.md");
    assert.equal(durable?.packMembers?.note, "stay");
    await user.click(screen.getByRole("radio", { name: "Chat" }));
    await waitFor(() => assert.ok(screen.getByText("Pack · 1 files · note")));
  });

  it("unconfirmed turn paints Confirming… not empty; included only from voucher", async () => {
    const host = createFakeHost({
      mode: "chat",
      workspace: null,
      busy: false,
      chatRoot: CHAT_ROOT,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(
      envelope(
        {
          kind: "chat_pack",
          chatPack: {
            runId: RUN_ID,
            sessionId: HOME_A,
            conversationId: HOME_A,
            connectionGeneration: 1,
            inclusion: "unconfirmed",
            fault: null,
            files: [],
            noteIncluded: false,
          },
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.getByText(PACK_TURN_HYDRATING)));
    assert.equal(screen.queryByText(PACK_TURN_INCLUDED) === null, true);
    ws.emit(
      envelope(
        {
          kind: "chat_pack",
          chatPack: {
            runId: RUN_ID,
            sessionId: HOME_A,
            conversationId: HOME_A,
            connectionGeneration: 1,
            inclusion: "included",
            fault: null,
            files: [{ path: "a.md" }],
            noteIncluded: true,
          },
        },
        3,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => assert.ok(screen.getByText(PACK_TURN_INCLUDED)));
  });

  it("clear pack returns honest empty chrome", async () => {
    updatePackMembers(CHAT_PART, HOME_A, {
      files: [{ path: "notes/brief.md" }],
      note: "n",
    });
    const host = createFakeHost(
      {
        mode: "chat",
        workspace: null,
        busy: false,
        chatRoot: CHAT_ROOT,
      },
      { files: { "notes/brief.md": "brief" } },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(screen.getByText("Pack · 1 files · note")));
    const user = userEvent.setup();
    fireEvent.click(screen.getByRole("button", { name: "Pack · 1 files · note" }));
    await user.click(screen.getByRole("button", { name: "Clear pack" }));
    await waitFor(() => assert.ok(screen.getByText(PACK_COMPOSER_EMPTY)));
    assert.deepEqual(loadSession(CHAT_PART, HOME_A)?.packMembers, {
      files: [],
      note: null,
    });
  });
});
