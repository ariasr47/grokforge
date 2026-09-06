// F7 — priorConversations: not-found state instead of the first-run welcome
// (AC12b, SPEC §4 flow 5). This row is a shell-REACTION row (SPEC §7) — it
// proves the shell reacts correctly to the signal, not that the engine
// produces it (that's AC12d/AC12e, review-only, out of this lane's reach).
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { commitHomeName, createSession, saveSessionMessages, reloadSessionsFromDisk } from "./sessions";

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

afterEach(() => {
  cleanup();
});

/**
 * Assert the transcript itself carries `text`, not merely that the document
 * does somewhere.
 *
 * A chat home with no committed name takes its label from the first user
 * message (f5dbb64, "Chat named home"), so a message's own words also paint in
 * the sidebar row, the panel header, the home-name trigger and the composer
 * meta. A document-wide `findByText` therefore matches five elements — it
 * throws on the ambiguity, and even the loosest version of it would pass on
 * the chrome alone, without the transcript ever rendering.
 */
async function transcriptShows(text: string): Promise<void> {
  await waitFor(() => {
    const transcript = document.querySelector(".transcript");
    assert.ok(transcript, "the transcript must render");
    assert.ok(
      (transcript.textContent ?? "").includes(text),
      `the transcript must show ${JSON.stringify(text)}`,
    );
  });
}

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

describe("F7 — conversations-not-found vs. welcome (AC12b)", () => {
  it("priorConversations:true + a named empty Chat session -> the ordinary Home screen, not the not-found alarm", async () => {
    resetBrowserState();
    const partition = "chat:__sandbox__";
    const s = createSession(partition, "New chat");
    commitHomeName(partition, s.id, "C6-HOME");
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Task 13 — "Chat with Grok" (the old ready-kind EmptyStates heading) is
    // gone; the Home screen renders instead.
    assert.ok(
      await screen.findByPlaceholderText("Search sessions…"),
    );
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
  });

  it("priorConversations:true + empty partition -> the not-found state, never the welcome", async () => {
    resetBrowserState();
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    assert.ok(await screen.findByText("Forge didn't find your earlier conversations."));
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
  });

  it("priorConversations:false + empty partition -> the first-run welcome (genuine first run)", async () => {
    resetBrowserState();
    localStorage.removeItem("grokforge.firstRun"); // genuine first run: no dismissal record
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    assert.ok(await screen.findByText("Welcome to Forge"));
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
  });

  it("priorConversations:true but the partition already has messages -> renders the transcript, not the not-found state", async () => {
    resetBrowserState();
    const partition = "chat:__sandbox__";
    const s = createSession(partition, "Earlier chat");
    saveSessionMessages(partition, s.id, [
      { id: "u1", role: "user", content: "already have history" },
    ]);
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    await transcriptShows("already have history");
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
  });

  it("priorConversations:false and the partition already has messages -> renders the transcript", async () => {
    resetBrowserState();
    const partition = "chat:__sandbox__";
    const s = createSession(partition, "Earlier chat");
    saveSessionMessages(partition, s.id, [
      { id: "u1", role: "user", content: "already have history too" },
    ]);
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    await transcriptShows("already have history too");
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
  });

  it("priorConversations:true never hides a restored owned run with no legacy messages", async () => {
    resetBrowserState();
    const partition = "chat:__sandbox__";
    const sessionId = "restored-session";
    reloadSessionsFromDisk({
      byWorkspace: { [partition]: [{ id: sessionId, workspace: partition, title: "Restored run", messages: [], updatedAt: Date.now(), status: "live", subagents: [], open: true }] },
      activeId: { [partition]: sessionId },
      pinned: [partition],
      expanded: [partition],
    });
    localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
      runs: [{
        sessionId, runId: "restored-run", connectionGeneration: 1, state: "terminal",
        acceptedPrompt: "restored prompt", admittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastEventSeq: 3,
        policy: { effectiveMode: "review" }, model: { appliedModel: "grok-4.6", selectionProvenance: "inherited" },
        terminalKind: "answered", finalAnswer: "restored answer", answerVouched: true, failure: null,
        reasoning: {}, answer: { answer: "restored answer" }, activities: {}, decisions: {}, seenEventSeq: [1, 2, 3], terminalEventSeq: 3,
      }],
      cursors: { [sessionId]: 3 },
    }));
    const host = createFakeHost({ mode: "chat", hasApiKey: true, workspace: null, priorConversations: true });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    await waitFor(() => assert.ok(document.querySelector(".node--done")));
    assert.ok(screen.getByText("restored answer"));
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
  });
});

// GATE Q finding N-6 (2026-08-14) — INTERFACE_CONTRACT.md `priorConversations`
// property 3, SPEC §2.8 property 3, §4 flow 5, AC12f. The signal is scoped to
// this shell's WHOLE conversation store (every mode, every folder, one
// `grokforge.sessions.v2` key); the guard must be weighed at that same
// granularity, never against the mode/folder slice on screen. Both halves of
// AC12f are exercised here, in the exact journey the finding names: a shell
// with Chat history opening Code for the first time.
describe("AC12f — whole-store granularity (GATE Q N-6)", () => {
  it("Chat history exists + Code opened for the first time -> Code's ordinary empty state, never the not-found alarm", async () => {
    resetBrowserState();
    const chatPartition = "chat:__sandbox__";
    const s = createSession(chatPartition, "Earlier chat");
    saveSessionMessages(chatPartition, s.id, [
      { id: "u1", role: "user", content: "chat history lives here" },
    ]);
    // Code's own partition ("__no_workspace__") has never been touched —
    // this is the exact granularity mismatch N-6 named: per-mode slice empty,
    // whole store non-empty.
    const host = createFakeHost({
      mode: "code",
      hasApiKey: true,
      workspace: null,
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Task 13 — "Open a project" (the old no-workspace EmptyStates heading)
    // is gone; the Home screen's search field is the stable, mode-agnostic
    // signal that Code's ordinary (non-alarm, non-welcome) empty state is
    // showing.
    assert.ok(
      await screen.findByPlaceholderText("Search sessions…"),
    );
    assert.equal(
      screen.queryByText("Forge didn't find your earlier conversations.") === null, true,
    );
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
  });

  it("Chat history exists + onboarding undismissed + Code opened for the first time -> ordinary empty state, never the welcome", async () => {
    resetBrowserState();
    // Unlike resetBrowserState()'s default (onboarding dismissed), this
    // exercises the first-run welcome directly: signed in and has sent a
    // message before (in Chat), but never opened a folder in Code — the
    // per-mode onboarding gate (`isOnboardingDone`) would, on its own,
    // welcome this experienced user back into Code as if new.
    localStorage.setItem(
      "grokforge.firstRun",
      JSON.stringify({
        dismissed: false,
        openedFolder: false,
        signedIn: true,
        sentMessage: true,
        pickedMode: true,
        seenAt: new Date().toISOString(),
      }),
    );
    const chatPartition = "chat:__sandbox__";
    const s = createSession(chatPartition, "Earlier chat");
    saveSessionMessages(chatPartition, s.id, [
      { id: "u1", role: "user", content: "chat history lives here" },
    ]);
    const host = createFakeHost({
      mode: "code",
      hasApiKey: true,
      workspace: null,
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Task 13 — "Open a project" (the old no-workspace EmptyStates heading)
    // is gone; the Home screen's search field is the stable, mode-agnostic
    // signal that Code's ordinary (non-alarm, non-welcome) empty state is
    // showing.
    assert.ok(
      await screen.findByPlaceholderText("Search sessions…"),
    );
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
    assert.equal(
      screen.queryByText("Forge didn't find your earlier conversations.") === null, true,
    );
  });

  it("whole store emptied -> the not-found alarm still renders, even in a mode that never held conversations", async () => {
    resetBrowserState();
    // The store is fully empty (resetBrowserState's reloadSessionsFromDisk
    // call), and Code's own partition never held anything either — the
    // opposite failure mode from the two tests above: widening the guard to
    // the whole store must not hide a real loss (AC12f, second half; §9.12
    // rejects narrowing the signal for exactly this reason).
    const host = createFakeHost({
      mode: "code",
      hasApiKey: true,
      workspace: null,
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    assert.ok(await screen.findByText("Forge didn't find your earlier conversations."));
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
    assert.equal(screen.queryByText("Open a project") === null, true);
  });

  it("Start a new conversation dismisses the not-found alarm so Code's ordinary empty state can show", async () => {
    resetBrowserState();
    const host = createFakeHost({
      mode: "code",
      hasApiKey: true,
      workspace: "C:\\qa-start-new",
      workspaceName: "qa-start-new",
      priorConversations: true,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    assert.ok(await screen.findByText("Forge didn't find your earlier conversations."));
    await userEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
    // Task 13 — "Code continuum" (the old ready-kind EmptyStates heading) is
    // gone; the Home screen renders instead, regardless of product mode.
    assert.ok(screen.getByPlaceholderText("Search sessions…"));
    assert.equal(screen.getAllByText("New session").length >= 1, true);
    assert.equal(screen.queryByText("New chat") === null, true);
  });
});
