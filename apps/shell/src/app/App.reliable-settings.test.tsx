import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
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

afterEach(() => cleanup());

test("Settings reports that a workspace is required before choosing a permission policy", async () => {
  localStorage.clear();
  localStorage.setItem("grokforge.firstRun", JSON.stringify({ dismissed: true, openedFolder: true, signedIn: true, sentMessage: true, pickedMode: true, seenAt: new Date().toISOString() }));
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
  const host = createFakeHost({ mode: "chat", workspace: null, workspaceName: null });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  const user = userEvent.setup();
  await screen.findByText(/Grok · (live|reconnecting)/);
  const settings = screen.getAllByRole("button", { name: "Settings" }).find(button => button.className.includes("ghost"));
  assert.ok(settings);
  await user.click(settings);
  assert.ok(await screen.findByText("Open a workspace to choose its permission policy."));
});
