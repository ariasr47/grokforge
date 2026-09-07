import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import {
  HOME_NAME_PLACEHOLDER,
  PACK_COMPOSER_ARMED_TOOLTIP,
  PACK_COMPOSER_EMPTY,
  PACK_COMPOSER_HYDRATE_PATH,
  PACK_COMPOSER_LOADING,
  PACK_COMPOSER_PIN_FAILED,
} from "../projections/chatPackComposer";
import { PACK_TURN_INCLUDED } from "../projections/chatPackTurn";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { partitionKey, reloadSessionsFromDisk, updatePackMembers } from "../lib/sessions";

const CHAT_ROOT = "C:\\Users\\qa\\.grokforge\\chat-sandbox";
const CHAT_PART = partitionKey("chat", CHAT_ROOT);
const HOME_A = "home-a";
const WORKSPACE = "C:\\repo";

function resetBrowserState(homeId = HOME_A): void {
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
      [CHAT_PART]: [{
        id: homeId,
        workspace: CHAT_PART,
        title: "Auto title",
        committedName: false,
        packMembers: { files: [], note: null },
        messages: [],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [CHAT_PART]: homeId },
    pinned: [CHAT_PART],
    expanded: [CHAT_PART],
  });
  FakeWebSocket.reset();
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

test("Chat footer: pack chip before composer-meta; placeholder name", async () => {
  const host = createFakeHost({
    mode: "chat",
    workspace: null,
    workspaceName: null,
    busy: false,
    chatRoot: CHAT_ROOT,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  // This case is about the *placeholder*, and chatListTitle only shows it
  // "while the home has no auto-title yet" (its own doc): with committedName
  // false it returns any title that isn't the "New chat" default, and only
  // falls through to the placeholder when there is none. The shared
  // resetBrowserState fixture seeds "Auto title", which is exactly the
  // condition that suppresses the placeholder — so this test asserted a state
  // its own setup made unreachable. Re-seed the same home with no title.
  reloadSessionsFromDisk({
    byWorkspace: {
      [CHAT_PART]: [{
        id: HOME_A,
        workspace: CHAT_PART,
        title: "",
        committedName: false,
        packMembers: { files: [], note: null },
        messages: [],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [CHAT_PART]: HOME_A },
    pinned: [CHAT_PART],
    expanded: [CHAT_PART],
  });
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(screen.getByText(PACK_COMPOSER_EMPTY)));
  assert.ok(screen.getByRole("button", { name: new RegExp(`^${HOME_NAME_PLACEHOLDER}$`) }));
  // Task 11 retired .composer-footer for chips beside the field (.composer
  // .bar, where the Pack chip now lives) plus a single .cmeta meta line —
  // .composer-wrap still wraps both, in that same order, so "pack before
  // meta" still holds.
  const footer = document.querySelector(".composer-wrap");
  assert.ok(footer);
  const text = footer.textContent ?? "";
  const pack = text.indexOf(PACK_COMPOSER_EMPTY);
  const meta = text.indexOf("Chat");
  assert.ok(pack >= 0 && meta >= 0 && pack < meta);
  assert.equal(screen.queryByText(PACK_TURN_INCLUDED) === null, true);
});

test("Code renders no Chat pack chrome", async () => {
  reloadSessionsFromDisk({
    byWorkspace: {
      [WORKSPACE]: [{
        id: "code-1",
        workspace: WORKSPACE,
        title: "Code home",
        messages: [],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [WORKSPACE]: "code-1" },
    pinned: [WORKSPACE],
    expanded: [WORKSPACE],
  });
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  assert.equal(screen.queryByText(PACK_COMPOSER_EMPTY) === null, true);
  assert.equal(screen.queryByText(PACK_COMPOSER_LOADING) === null, true);
  assert.equal(screen.queryByText(HOME_NAME_PLACEHOLDER) === null, true);
  assert.equal(screen.queryByText("Pack ·") === null, true);
});

test("Code with a pinned workspace shows the gradient New session CTA, not Open folder", async () => {
  reloadSessionsFromDisk({
    byWorkspace: {
      [WORKSPACE]: [{
        id: "code-1",
        workspace: WORKSPACE,
        title: "Code home",
        messages: [],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [WORKSPACE]: "code-1" },
    pinned: [WORKSPACE],
    expanded: [WORKSPACE],
  });
  const host = createFakeHost({
    mode: "code",
    workspace: WORKSPACE,
    workspaceName: "repo",
    busy: false,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");

  // Folder opening moves off the sidebar entirely once a workspace is
  // pinned (command palette / Ctrl+O instead) — no compact icon button.
  assert.equal(screen.queryByRole("button", { name: "Open folder…" }) === null, true);
  // DEAD-4: the class-based check here used to look for
  // ".open-folder-btn-compact", which exists nowhere — it could never fail.
  // Cast a wider net so a differently-classed compact/icon-only variant
  // would still be caught: nothing in the rendered sidebar may claim to
  // open a folder, under any name.
  const openFolderIsh = screen.queryAllByRole("button").find((b) =>
    /open folder/i.test(b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || ""),
  );
  assert.equal(openFolderIsh === undefined, true);

  const newSession = screen.getByRole("button", { name: "New session" });
  assert.ok(newSession.className.includes("cta"));
  assert.equal(newSession.className.includes("ghost"), false);
});

test("armed chip is not Included; hydrate drop is not empty", async () => {
  updatePackMembers(CHAT_PART, HOME_A, {
    files: [{ path: "notes/ok.md" }, { path: "notes/gone.md" }],
    note: null,
  });
  const host = createFakeHost(
    {
      mode: "chat",
      workspace: null,
      busy: false,
      chatRoot: CHAT_ROOT,
    },
    { files: { "notes/ok.md": "hello" } },
  );
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(screen.getAllByText(PACK_COMPOSER_HYDRATE_PATH).length >= 1));
  assert.ok(screen.getByText("notes/ok.md"));
  assert.equal(screen.queryByText(PACK_COMPOSER_EMPTY) === null, true);
  assert.equal(screen.queryByText(PACK_TURN_INCLUDED) === null, true);
  const chip = screen.getByRole("button", { name: PACK_COMPOSER_HYDRATE_PATH });
  assert.notEqual(chip.getAttribute("title"), PACK_COMPOSER_ARMED_TOOLTIP);
});

test("pin refuse from WS is not empty and keeps prior members", async () => {
  const host = createFakeHost(
    {
      mode: "chat",
      workspace: null,
      busy: false,
      chatRoot: CHAT_ROOT,
    },
    { files: { "notes/ok.md": "hello", "notes/other.md": "x" } },
  );
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() => assert.ok(screen.getByText(PACK_COMPOSER_EMPTY)));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: PACK_COMPOSER_EMPTY }));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Pin notes/ok.md" })));
  await user.click(screen.getByRole("button", { name: "Pin notes/ok.md" }));
  await waitFor(() => assert.ok(screen.getByText("Pack · 1 files")));
  host.nextChatPackRefuse = {
    code: "chat_pack_pin_refused",
    error: "outside",
    lastAttempt: "pin_failed",
  };
  await user.click(screen.getByRole("button", { name: "Pin notes/other.md" }));
  FakeWebSocket.latest()?.emit({ type: "state", state: { ...host.state } });
  await waitFor(() => assert.ok(screen.getAllByText(PACK_COMPOSER_PIN_FAILED).length >= 1));
  assert.ok(screen.getByText("notes/ok.md"));
  assert.equal(screen.queryByText(PACK_COMPOSER_EMPTY) === null, true);
});
