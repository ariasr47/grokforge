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

afterEach(() => cleanup());

/**
 * Task 5 characterization test: the Settings panel used to be inline JSX in
 * `App()`; it is now `SettingsView.tsx`, rendered through `<SettingsView>`
 * with ~39 props threaded from `App()`'s own state/closures. This test
 * exercises the real `<App />` (mocking only the network boundary, per
 * SPEC §7 / spire-tech-flow-integration-tests) and asserts on the same
 * visible copy the pre-extraction JSX rendered, for every section the brief
 * names: auth, policy controls (Task 4's PolicyControls), trusted command
 * classes, model presets, appearance, the shortcuts help list, app update,
 * and export/import. It must pass unchanged whether App.tsx renders the
 * Settings JSX inline or delegates to SettingsView — proving the move
 * didn't alter what a user sees.
 */
test("Settings still renders every section (auth, policy, trusted classes, models, appearance, shortcuts, updates, export/import) after the SettingsView extraction", async () => {
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
  const workspace = "C:\\repo";
  const host = createFakeHost(
    {
      mode: "chat",
      workspace,
      workspaceName: "repo",
      permissionPolicy: {
        status: "confirmed",
        workspace,
        storedMode: "review",
        effectiveMode: "review",
        source: "saved",
        revision: "pol-1",
        fallbackReason: null,
        savedForWorkspace: true,
      },
    },
    {
      trustedClasses: {
        status: "confirmed",
        workspace,
        classes: ["npm"],
        revision: "r1",
        source: "saved",
        fallbackReason: null,
        savedForWorkspace: true,
        catalog: [{ id: "npm", label: "npm" }],
      },
    },
  );
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  render(<App />);
  const user = userEvent.setup();
  await screen.findByText(/Grok · (live|reconnecting)/);
  const settingsToggle = screen
    .getAllByRole("button", { name: "Settings" })
    .find((button) => button.className.includes("ghost"));
  assert.ok(settingsToggle, "expected the topbar Settings toggle");
  await user.click(settingsToggle);
  await screen.findByRole("heading", { name: "Settings" });

  // Auth section
  assert.ok(screen.getByRole("button", { name: "Sign in with Grok" }));
  assert.ok(screen.getByRole("button", { name: "Sign out" }));
  assert.ok(screen.getByText("Auth priority"));
  assert.ok(screen.getByText(/Active:/));

  // Policy controls (Task 4's PolicyControls, still wired the same way)
  assert.ok(screen.getByText("Permission policy"));
  assert.ok(await screen.findByText("Policy: Review"));

  // Trusted command classes (rendered inside PolicyControls' children slot)
  assert.ok(screen.getByText("Trusted command classes"));

  // Model presets
  assert.ok(screen.getByLabelText("Model"));
  assert.ok(screen.getByRole("button", { name: "grok-4" }));

  // Appearance (theme / density / motion / background)
  assert.ok(screen.getByRole("button", { name: "Theme: Voidglass" }));
  assert.ok(screen.getByRole("button", { name: "Density: comfortable" }));
  assert.ok(screen.getByRole("button", { name: "Motion: Full" }));
  assert.ok(screen.getByRole("button", { name: "Background: Aurora" }));

  // Shortcuts help list
  assert.ok(screen.getByText(/palette/));
  assert.ok(screen.getByText(/new session/));

  // App update
  assert.ok(screen.getByRole("button", { name: "Check for updates" }));

  // Export/import (and the neighboring diagnostics/connection actions)
  assert.ok(screen.getByRole("button", { name: "Export sessions" }));
  assert.ok(screen.getByRole("button", { name: "Import sessions" }));
  assert.ok(screen.getByRole("button", { name: "Export diagnostics" }));
  assert.ok(screen.getByRole("button", { name: "Test connection" }));
  assert.ok(screen.getByRole("button", { name: "Open logs folder" }));
  assert.ok(screen.getByRole("button", { name: "Clear saved key" }));
});
