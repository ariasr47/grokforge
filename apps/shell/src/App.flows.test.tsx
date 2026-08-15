// Flow-integration coverage for the automation-gap bounce (QA_REPORT §4):
// AC3 (Chat send + stream reply, no folder gate) and AC1 (mode switch keeps
// each mode's own session list; nothing merges/wipes on switch). Mocks the
// network boundary only (fetch + WebSocket); real App, real session store.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { listSessions, reloadSessionsFromDisk } from "./sessions";

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
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
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

describe("AC3 — Chat send + stream reply without a folder gate", () => {
  it("sends on the default sandbox (no workspace bound) and renders the streamed reply", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const composer = await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.type(composer, "Hello Grok");

    const sendBtn = screen.getByRole("button", { name: "Send" });
    assert.equal(
      sendBtn.hasAttribute("disabled"),
      false,
      "Chat send must not be gated behind an open project folder",
    );
    await user.click(sendBtn);

    await waitFor(() => {
      assert.ok(host.callsTo("/api/prompt").length >= 1);
    });
    // No "open a project folder first" banner in Chat.
    assert.equal(screen.queryByText(/open a project folder first/i), null);

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit({ type: "text_delta", text: "Hi there" });
    ws.emit({ type: "done", reason: "stop" });

    await waitFor(() => {
      assert.ok(screen.getByText(/Hi there/));
    });
  });
});

describe("AC7 — effort control visible in both modes, next send uses it", () => {
  it("persists the selected effort across a mode switch and sends it on the next turn", async () => {
    const host = createFakeHost({ mode: "chat", workspace: "C:\\repo", busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Visible in Chat.
    const expertChipChat = await screen.findByRole("radio", { name: "Expert" });
    await user.click(expertChipChat);
    await waitFor(() => assert.ok(host.callsTo("/api/effort").length >= 1));
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Expert" }).getAttribute("aria-checked"), "true");
    });

    // Survives a mode switch (one global control, not per-mode).
    await user.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"), "true");
    });
    const expertChipCode = screen.getByRole("radio", { name: "Expert" });
    assert.equal(expertChipCode.getAttribute("aria-checked"), "true");

    // Next send in the new mode carries the selected effort.
    await user.keyboard("{Control>}n{/Control}");
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "use expert effort please");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const promptCalls = host.callsTo("/api/prompt");
      assert.ok(promptCalls.length >= 1);
      assert.equal(promptCalls[promptCalls.length - 1]!.body?.effort, "expert");
    });
  });
});

describe("AC1 — mode switch Chat<->Code keeps separate session lists", () => {
  it("does not merge or wipe the other mode's sessions on switch", async () => {
    const host = createFakeHost({
      mode: "chat",
      workspace: "C:\\repo",
      chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

render(<App />);

    const user = userEvent.setup();
    // Real virgin-profile flow: no "New chat" click first — Chat backs the
    // transcript with a session as soon as it boots (GATE Z round 3 fix),
    // so typing straight into the composer must already be persisted.
    const composer = await screen.findByLabelText("Message to agent");
    await user.type(composer, "Chat-only message");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    let ws = FakeWebSocket.latest()!;
    ws.emit({ type: "text_delta", text: "Chat reply" });
    ws.emit({ type: "done", reason: "stop" });
    await waitFor(() => assert.ok(screen.getByText(/Chat reply/)));

    const chatPartitionKey = "chat:__sandbox__";
    await waitFor(() => {
      const sessions = listSessions(chatPartitionKey);
      assert.equal(sessions.length, 1);
      assert.ok(sessions[0]!.messages.some((m) => m.content.includes("Chat-only message")));
    });

    // Switch to Code.
    const codeSeg = screen.getByRole("radio", { name: "Code" });
    await user.click(codeSeg);
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"), "true");
    });

    // Code chrome starts idle — the Chat transcript must not leak in.
    assert.equal(screen.queryByText(/Chat-only message/), null);
    assert.equal(screen.queryByText(/Chat reply/), null);

    // Code: start its own session (Ctrl+N — global shortcut, works without
    // expanding the workspace tree) and send its own turn.
    await user.keyboard("{Control>}n{/Control}");
    const composer2 = screen.getByLabelText("Message to agent");
    await user.type(composer2, "Code-only message");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 2));
    ws = FakeWebSocket.latest()!;
    ws.emit({ type: "text_delta", text: "Code reply" });
    ws.emit({ type: "done", reason: "stop" });
    await waitFor(() => assert.ok(screen.getByText(/Code reply/)));

    const codePartitionKey = "C:\\repo";
    await waitFor(() => {
      // Switching modes ensures an idle active session first (SPEC §4:
      // "the target mode opens with an idle dock"); Ctrl+N then starts a
      // second, so assert containment rather than an exact count.
      const sessions = listSessions(codePartitionKey);
      assert.ok(
        sessions.some((s) => s.messages.some((m) => m.content.includes("Code-only message"))),
      );
    });

    // Switch back to Chat — its own history is intact, Code's did not merge in.
    const chatSeg = screen.getByRole("radio", { name: "Chat" });
    await user.click(chatSeg);
    await waitFor(() => {
      assert.equal(screen.getByRole("radio", { name: "Chat" }).getAttribute("aria-checked"), "true");
    });
    await waitFor(() => assert.ok(screen.getAllByText(/Chat-only message/).length > 0));
    assert.equal(screen.queryByText(/Code-only message/), null);

    // Nothing merged or wiped: each partition still holds only its own turn.
    const chatSessionsAfter = listSessions(chatPartitionKey);
    const codeSessionsAfter = listSessions(codePartitionKey);
    assert.ok(
      chatSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Chat-only message"))),
    );
    assert.ok(
      !chatSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Code-only message"))),
    );
    assert.ok(
      codeSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Code-only message"))),
    );
    assert.ok(
      !codeSessionsAfter.some((s) => s.messages.some((m) => m.content.includes("Chat-only message"))),
    );
  });
});
