import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

async function openSettings() {
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
  const host = createFakeHost({ mode: "chat", workspace: null });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByText(/Grok · (live|reconnecting)/);
  const settings = screen
    .getAllByRole("button", { name: "Settings" })
    .find((button) => button.className.includes("ghost"));
  assert.ok(settings);
  await userEvent.setup().click(settings);
  await screen.findByRole("heading", { name: "Settings" });
}

// F6: this panel said `Ctrl+N` for "new chat", but Ctrl+N is bound to new
// *session* (App.tsx's tinykeys `$mod+KeyN`) — Ctrl+Shift+N is the real new
// chat binding (`$mod+Shift+KeyN`, and what HomeScreen's own hint shows). A
// kbd hint that names the wrong key is worse than none.
test("F6: the Shortcuts panel pairs Ctrl+N with new session and Ctrl+Shift+N with new chat, never the old wrong pairing", async () => {
  await openSettings();
  const hint = screen.getByText(/palette/).closest("p");
  assert.ok(hint);
  const text = hint!.textContent ?? "";
  assert.match(text, /Ctrl\+N\s*new session/);
  assert.match(text, /Ctrl\+Shift\+N\s*new chat/);
  // The defect this replaces: Ctrl+N labeled as if it opened a new chat.
  assert.doesNotMatch(text, /Ctrl\+N\s*new chat/);
});
