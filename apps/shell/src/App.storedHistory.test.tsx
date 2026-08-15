// F4 — launch failure with stored history: the conversations-are-saved
// promise (SPEC §4 flow 3 branch B, AC-U6, AC-U7).
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { failedStatus, installTauriGlobal, FakeWebSocket } from "./testFakeHost";
import { setDesktopBridge } from "./desktopBridge";
import { createSession, saveSessionMessages, reloadSessionsFromDisk } from "./sessions";

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
  setDesktopBridge(null);
});

function unreachableFetch(): typeof fetch {
  return (async () => {
    throw new Error("engine unreachable");
  }) as unknown as typeof fetch;
}

describe("F4 — stored-history branch of launch failure (AC-U6, AC-U7)", () => {
  it("with a stored session holding a message, the saved-conversations line renders above a failure card", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    const partition = "chat:__sandbox__";
    const s = createSession(partition, "Earlier chat");
    saveSessionMessages(partition, s.id, [
      { id: "u1", role: "user", content: "hello from before" },
    ]);
    FakeWebSocket.reset();

    const restoreTauri = installTauriGlobal();
    setDesktopBridge(async () => failedStatus({ reason: "crashed" }) as unknown as never);
    globalThis.fetch = unreachableFetch();
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")));

    // (a) the saved-conversations line renders
    assert.ok(
      screen.getByText(
        "Your conversations are saved and will be here when Forge starts.",
      ),
    );
    // (b) no empty transcript renders — the whole app is the boot screen,
    // not a blank transcript region.
    assert.equal(document.querySelector(".transcript"), null);
    // (c) no surface says the conversations are gone
    assert.equal(screen.queryByText(/gone|lost|deleted|cannot be recovered/i), null);
    // (d) no model/workspace/auth value from a previous session appears —
    // the failure card renders none of PublicState's engine-sourced fields.
    assert.equal(screen.queryByText(/grok-4|grok-3/i), null);

    restoreTauri();
  });

  it("with zero stored sessions, the saved-conversations line stays absent", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();

    const restoreTauri = installTauriGlobal();
    setDesktopBridge(async () => failedStatus({ reason: "crashed" }) as unknown as never);
    globalThis.fetch = unreachableFetch();
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")));

    assert.equal(
      screen.queryByText(
        "Your conversations are saved and will be here when Forge starts.",
      ),
      null,
    );

    restoreTauri();
  });
});
