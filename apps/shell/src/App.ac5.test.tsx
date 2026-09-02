// AC5 — Chat: user can bind a folder and open/attach a file under it
// ("test" half; QA does the "review" half by live observation). Mocks the
// network boundary only (fetch + WebSocket + the native-picker fallback
// endpoint); real App, real session store.
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

describe("AC5 — Chat: bind a folder, then open a file under it", () => {
  it("binds via the folder picker, shows the bound label, and opens a file the agent touched", async () => {
    const host = createFakeHost(
      { mode: "chat", chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox", busy: false },
      {
        pickFolderPath: "D:\\docs",
        files: { "notes.txt": "Q3 plan: ship dual-mode." },
      },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Before binding: sandbox path stays hidden, button offers "Open folder…".
    const openFolderBtn = await screen.findByRole("button", { name: "Open folder…" });
    await user.click(openFolderBtn);

    await waitFor(() => assert.ok(host.callsTo("/api/pick-folder").length >= 1));
    await waitFor(() => {
      const chatRootCalls = host.callsTo("/api/chat-root");
      assert.ok(chatRootCalls.length >= 1);
      assert.equal(chatRootCalls[chatRootCalls.length - 1]!.body?.path, "D:\\docs");
    });

    // Chrome flips to the bound state (SPEC §4: "folder bound label").
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: "Change folder…" }));
      assert.ok(screen.getByText(/Tools can use: docs/));
    });

    // Start a session and let the agent touch a file under the newly-bound
    // root, then open it through the transcript's "Peek path" action —
    // exercising the same GET /api/workspace/read the mention picker uses.
    await user.click(screen.getByRole("button", { name: "New chat" }));
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "read notes.txt");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit({
      schemaVersion: 2,
      type: "tool_run",
      activityId: "activity-1",
      toolCallId: "t1",
      lifecycle: "pending",
      execution: null,
      status: "running",
      name: "read_file",
      input: { path: "D:\\docs\\notes.txt" },
      summary: null,
      command: null,
      output: null,
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: false,
    });
    ws.emit({
      schemaVersion: 2,
      type: "tool_run",
      activityId: "activity-1",
      toolCallId: "t1",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      name: "read_file",
      input: { path: "notes.txt" },
      summary: "D:\\docs\\notes.txt",
      command: null,
      output: "Q3 plan: ship dual-mode.",
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
    });
    ws.emit({ type: "text_delta", text: "Here's what's in the file." });
    ws.emit({ type: "done", reason: "stop" });

    // Receipts group may start open or collapsed depending on groupKey —
    // make sure it's open, then expand the row itself to reach its
    // "Open <path>" action.
    const toolHead = await screen.findByRole("button", { name: /action/i });
    if (toolHead.getAttribute("aria-expanded") !== "true") {
      await user.click(toolHead);
    }
    const rowHeads = await screen.findAllByRole("button", { name: /notes\.txt/i });
    await user.click(rowHeads[rowHeads.length - 1]!);

    const openBtn = screen.getByRole("button", { name: /^Open /i });
    await user.click(openBtn);
    await waitFor(() => assert.ok(host.callsTo("/api/workspace/read").length >= 1));
    await waitFor(() => assert.ok(screen.getAllByText(/notes\.txt/i).length >= 1));
  });
});
