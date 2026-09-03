// Review finding (Task 15, CRITICAL): binding a folder from the Pack
// section's Add action repoints the GLOBAL, persisted chat root
// (api.setChatRoot), not just the active home — so every private-sandbox
// chat became unreachable, with no frontend caller left for the backend's
// own setChatRoot(null) clear path. "Use private folder" is the way back.
// This proves it end to end through the real product (real App, real
// session store; mocks the network boundary only — fetch + WebSocket + the
// native-picker fallback endpoint), not just at the Sidebar component
// boundary (see Sidebar.chatHomes.test.tsx for the narrower prop-level
// coverage). Kept in its own file/process (Node's test runner isolates
// files, not tests within a file) rather than appended to App.ac5.test.tsx
// — that file's own bind+prompt+tool-run flow leaves an aria-hidden
// overlay artifact on document.body that made a second App render in the
// same process invisible to role queries; a fresh process sidesteps it
// without papering over that pre-existing harness quirk.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";

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

describe("Chat: the way back from a bound folder (Use private folder)", () => {
  it("is absent on a fresh private sandbox, appears once a folder is bound, and clears the root via POST /api/chat-root {path:null}", async () => {
    const host = createFakeHost(
      { mode: "chat", chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox", busy: false },
      { pickFolderPath: "D:\\docs" },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Nothing bound yet — the private-sandbox reset action has nothing to
    // do, so it must not be offered.
    const addBtn = await screen.findByRole("button", { name: "Add" });
    assert.equal(
      screen.queryByRole("button", { name: "Use private folder" }) === null,
      true,
    );

    await user.click(addBtn);
    await waitFor(() => {
      const calls = host.callsTo("/api/chat-root");
      assert.ok(calls.length >= 1);
      assert.equal(calls[calls.length - 1]!.body?.path, "D:\\docs");
    });

    // Bound — the way back must now be offered, and nothing about binding
    // silently deleted anything.
    const clearBtn = await screen.findByRole("button", { name: "Use private folder" });
    await user.click(clearBtn);

    await waitFor(() => {
      const calls = host.callsTo("/api/chat-root");
      assert.equal(calls[calls.length - 1]!.body?.path, null);
    });

    // Cleared — Chat is back on the private sandbox, so the action is
    // gone once more.
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("button", { name: "Use private folder" }) === null,
        true,
      ),
    );
  });
});
