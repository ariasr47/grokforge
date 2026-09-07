// Task 6 characterization test for `TranscriptBody`'s ladder — the five
// mutually-exclusive states the transcript can show (conversations-not-found,
// onboarding, signed-out/Home, host-offline, the run stream + MessageList).
// This used to be a `{...}` ternary inline in `App()`'s JSX; it is now
// `TranscriptBody.tsx`. The ladder is easy to reorder by accident because
// several of its conditions genuinely overlap (e.g. `showConversationsNotFound`
// and the raw `messages.length === 0 && !normalizedRunVisible && hostOk` check
// that also gates the Home screen can both be true at once) — only the
// ternary's *order* decides which one wins. This file exercises the real
// `<App />` (mocking only the network boundary, per SPEC §7 /
// spire-tech-flow-integration-tests) and asserts, for each precedence pair
// that can genuinely co-occur, that the higher-precedence branch renders and
// the lower one's marker text is absent — not just that the expected branch
// is present, which alone would not catch a swapped ternary arm.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "../app/App";
import { createFakeHost, FakeWebSocket } from "../app/testFakeHost";
import { reloadSessionsFromDisk, saveSessionMessages, createSession } from "../lib/sessions";
import { setHealthPollTestScheduler } from "../lib/healthPollTestClock";

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

afterEach(() => {
  cleanup();
});

async function eventually(check: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      last = error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw last instanceof Error ? last : new Error("condition not met before timeout");
}

function resetBrowserState(firstRun: {
  dismissed: boolean;
  openedFolder: boolean;
  signedIn: boolean;
  sentMessage: boolean;
  pickedMode: boolean;
} | null = { dismissed: true, openedFolder: true, signedIn: true, sentMessage: true, pickedMode: true }): void {
  localStorage.clear();
  if (firstRun) {
    localStorage.setItem(
      "grokforge.firstRun",
      JSON.stringify({ ...firstRun, seenAt: new Date().toISOString() }),
    );
  }
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

describe("Task 6 — TranscriptBody ladder precedence", () => {
  it("conversations-not-found wins over the Home screen, even signed in with a healthy host", async () => {
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
    assert.equal(screen.queryByPlaceholderText("Search sessions…") === null, true);
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
    assert.equal(screen.queryByText("Sign in to chat.") === null, true);
  });

  it("the first-run welcome wins over the Home screen for a genuinely new, signed-in operator", async () => {
    resetBrowserState(null); // no firstRun record at all: a genuine first run
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
    assert.equal(screen.queryByPlaceholderText("Search sessions…") === null, true);
    assert.equal(screen.queryByText("Forge didn't find your earlier conversations.") === null, true);
    assert.equal(screen.queryByText("Sign in to chat.") === null, true);
  });

  it("the signed-out gate renders, not the Home screen, when no credential is present", async () => {
    resetBrowserState();
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: false,
      workspace: null,
      priorConversations: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    assert.ok(await screen.findByText("Sign in to chat."));
    assert.equal(screen.queryByPlaceholderText("Search sessions…") === null, true);
  });

  it("the Home screen renders, not the signed-out gate, once a credential is present", async () => {
    resetBrowserState();
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    assert.ok(await screen.findByPlaceholderText("Search sessions…"));
    assert.equal(screen.queryByText("Sign in to chat.") === null, true);
  });

  it(
    "the engine-stopped empty state renders once the host drops before any message is sent, even though the operator is signed in",
    { timeout: 30000 },
    async () => {
      resetBrowserState();
      const host = createFakeHost({
        mode: "chat",
        hasApiKey: true,
        workspace: null,
        priorConversations: false,
      });
      let healthPoll: (() => void) | undefined;
      setHealthPollTestScheduler((poll) => {
        healthPoll = poll;
        return () => {
          healthPoll = undefined;
        };
      });
      globalThis.fetch = host.fetchImpl;
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

      render(<App />);

      // Reach steady state (boot ready, hostOk true, signed-in Home) with
      // zero messages sent — the precondition the host-offline branch needs
      // (`messages.length === 0 && !normalizedRunVisible && !hostOk`).
      assert.ok(await screen.findByPlaceholderText("Search sessions…"));

      // Two consecutive failed health polls flips hostOk false (same
      // debounce F5 / App.engineDeath.test.tsx exercises with messages
      // present — this is the zero-message counterpart, which lands in the
      // ladder's EmptyStates("host-offline") branch instead of the
      // `.transcript-offline` band inside the stream branch).
      host.healthFail = true;
      assert.ok(healthPoll, "expected the live health-poll test hook to be installed");
      healthPoll!();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      healthPoll!();

      // Scoped to the heading role: `AppBanners.tsx`'s (pre-existing,
      // untouched by this task) topbar `EngineStoppedBanner` reacts to the
      // same `!hostOk` signal with the same words in a `<strong>`, so a bare
      // text query would match both — the heading is unique to
      // `EmptyStates(kind="host-offline")` inside `.transcript`.
      await eventually(() =>
        assert.ok(screen.getByRole("heading", { name: "Forge's engine stopped." })),
      );
      assert.equal(screen.queryByPlaceholderText("Search sessions…") === null, true);
    },
  );

  it("the run stream renders instead of the first-run welcome once the active session already has messages", async () => {
    resetBrowserState({ dismissed: false, openedFolder: false, signedIn: false, sentMessage: false, pickedMode: true });
    const partition = "chat:__sandbox__";
    const s = createSession(partition, "Earlier chat");
    saveSessionMessages(partition, s.id, [
      { id: "u1", role: "user", content: "the ladder should not welcome me again" },
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

    // findAllByText (not findByText): MessageList's virtualizer can paint
    // the same row more than once in this harness — the ladder claim under
    // test is only that the stream (not the welcome) is what's showing.
    const found = await screen.findAllByText(/the ladder should not welcome me again/);
    assert.equal(found.length >= 1, true);
    assert.equal(screen.queryByText("Welcome to Forge") === null, true);
    assert.equal(screen.queryByPlaceholderText("Search sessions…") === null, true);
  });
});
