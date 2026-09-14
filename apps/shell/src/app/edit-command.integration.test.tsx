import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import { GATE_EDIT_COMMAND } from "../lib/copyDock";

const WORKSPACE = "C:\\repo";
const COMMAND = "npm test -- src/dock/Gate.test.tsx";

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

function seedFirstRun(): void {
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
}

test("Edit command keeps the Gate and Allow posts the edited command (YOU 03:00)", async () => {
  seedFirstRun();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
  const host = createFakeHost({ mode: "code", workspace: WORKSPACE, workspaceName: "repo", busy: false });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  const composer = (await screen.findByLabelText("Message to agent")) as HTMLTextAreaElement;
  const user = userEvent.setup();
  await user.type(composer, "run the gate tests");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const socket = FakeWebSocket.latest();
  assert.ok(socket);
  socket!.emit({ type: "permission_request", id: "perm-edit-cmd", kind: "shell", detail: COMMAND });

  const dock = await screen.findByRole("region", { name: "Pending agent actions" });
  within(dock).getByRole("region", { name: "Grok wants to run a command" });
  assert.equal(composer.disabled, true, "composer is locked while the Gate owns settle");

  await user.click(within(dock).getByRole("button", { name: GATE_EDIT_COMMAND }));

  await waitFor(() => {
    assert.equal(screen.queryAllByRole("region", { name: "Grok wants to run a command" }).length, 1, "Gate stays");
    assert.equal(composer.disabled, true, "composer stays locked — edit is in-place on the Gate");
  });
  assert.equal(host.callsTo("/api/permission").length, 0, "Edit command must not deny");

  const input = within(dock).getByRole("textbox", { name: "Command to run" }) as HTMLTextAreaElement;
  assert.equal(input.value, COMMAND);
  await user.clear(input);
  await user.type(input, "node -e \"console.log('forge-edit-right')\"");
  await user.click(within(dock).getByRole("button", { name: "Allow" }));

  await waitFor(() => {
    const permCalls = host.callsTo("/api/permission");
    assert.ok(permCalls.length >= 1);
    assert.equal(permCalls[permCalls.length - 1]!.body?.decision, "allow_once");
    assert.equal(
      permCalls[permCalls.length - 1]!.body?.command,
      "node -e \"console.log('forge-edit-right')\"",
    );
  });
});
