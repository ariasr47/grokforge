// AC2 — First launch with no Code history defaults to Chat (QA_REPORT
// "Amendments bounced to Frontend"). The host owns the actual first-launch
// default (config.ts `mode: "chat"`); the shell's honest half is to render
// whatever the host reports without ever letting a stale/local preference
// override it. Mocks the network boundary only (fetch + WebSocket); real
// App, real session store, real mode reducer, per
// spire-tech-flow-integration-tests.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";

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

describe("AC2 — first launch with no Code history defaults to Chat", () => {
  it("a true virgin install (no firstRun record, no sessions, host reports mode:chat, recent:[]) opens Chat, not Code", async () => {
    // Nothing in storage at all — this is what a fresh profile actually
    // looks like, not the "onboarding dismissed" fixture the other flow
    // tests use.
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();

    const host = createFakeHost({ mode: "chat", recent: [], workspace: null });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const chatSeg = await screen.findByRole("radio", { name: "Chat" });
    const codeSeg = await screen.findByRole("radio", { name: "Code" });
    assert.equal(chatSeg.getAttribute("aria-checked"), "true");
    assert.equal(codeSeg.getAttribute("aria-checked"), "false");

    // The rest of the chrome agrees — Chat sidebar, not Code's workspace
    // tree — and Onboarding's own mode step (rendered on a true first run,
    // before EmptyStates would be reachable) is highlighted on "Chat", not
    // "Code". A flipped default would show a Code sidebar here even though
    // the radio button text could still lie.
    assert.ok(screen.getByRole("complementary", { name: "Chat sessions" }));
    assert.equal(screen.queryByRole("complementary", { name: /workspace/i }) === null, true);
    const chatOnboardingBtn = screen.getByRole("button", { name: "Chat — everyday agent" });
    const codeOnboardingBtn = screen.getByRole("button", { name: "Code — repo agent" });
    assert.ok(chatOnboardingBtn.className.includes("primary"));
    assert.ok(!codeOnboardingBtn.className.includes("primary"));
  });

  it("a stale local 'lastMode: code' preference never overrides the host's authoritative first-launch mode", async () => {
    // This is the concrete way the default could flip silently: a future
    // change that reads productMode from the client-side pref instead of
    // trusting host state. Seed exactly that stale pref and prove the host
    // (fresh install => mode:"chat") still wins.
    localStorage.clear();
    localStorage.setItem(
      "grokforge.prefs.v1",
      JSON.stringify({
        density: "comfortable",
        theme: "aeon",
        motion: "full",
        lastMode: "code",
        effort: "auto",
        usedCode: true,
        showChatFiles: true,
        showSubagents: true,
      }),
    );
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();

    const host = createFakeHost({ mode: "chat", recent: [], workspace: null });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const chatSeg = await screen.findByRole("radio", { name: "Chat" });
    assert.equal(
      chatSeg.getAttribute("aria-checked"),
      "true",
      "host-reported first-launch mode must win over a stale local pref",
    );
  });

  it("contrast: when the host reports existing Code history (mode:code), the shell honestly opens Code", async () => {
    // Proves the previous two assertions are discriminating (would fail on
    // a hard-coded 'always render Chat'), not just tautologically true.
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();

    const host = createFakeHost({
      mode: "code",
      workspace: "C:\\repo",
      workspaceName: "repo",
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const codeSeg = await screen.findByRole("radio", { name: "Code" });
    assert.equal(codeSeg.getAttribute("aria-checked"), "true");
  });
});
