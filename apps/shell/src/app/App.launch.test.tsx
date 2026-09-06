// F2 — launch state machine and the starting card (AC-U1, AC3). Mocks the
// network boundary (fetch/WebSocket) and the IPC boundary (desktopBridge)
// only; real App, real session store, per spire-tech-flow-integration-tests.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";
import { createFakeHost, FakeWebSocket, installTauriGlobal } from "./testFakeHost";
import { setDesktopBridge } from "../lib/desktopBridge";
import { reloadSessionsFromDisk } from "../lib/sessions";

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

describe("F2 — AC-U1/AC3: starting card while the launcher is still deciding", () => {
  it("shows brand + one phase line + spinner — never a transcript, empty state or blank surface", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();

    const restoreTauri = installTauriGlobal();
    // A bridge that never resolves: startup stays "still deciding" forever,
    // which is exactly the window AC-U1/AC3 assert chrome for.
    setDesktopBridge(() => new Promise(() => {}));
    const host = createFakeHost();
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Brand + phase line + spinner.
    assert.ok(await screen.findByText("Forge"));
    assert.ok(screen.getByText("Starting Forge…"));
    assert.ok(document.querySelector(".boot-spinner"));

    // Never a transcript, empty state, or blank surface.
    assert.equal(screen.queryByRole("status") === null, true); // no EmptyStates
    assert.equal(document.querySelector(".transcript"), null);
    assert.equal(document.querySelector(".app"), null);
    assert.ok(document.querySelector(".boot-screen"));

    restoreTauri();
  });

  it("phase line follows the launcher's own status (AC-U2) — never 'Almost ready…'", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();

    const restoreTauri = installTauriGlobal();
    setDesktopBridge(() => new Promise(() => {}));
    const host = createFakeHost();
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    await screen.findByText("Forge");
    assert.equal(screen.queryByText("Almost ready…") === null, true);

    restoreTauri();
  });
});
