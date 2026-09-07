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
import { reloadSessionsFromDisk } from "../lib/sessions";
import type { ActivityRecord, RunEventEnvelope } from "../projections/runReducer";

/**
 * A Contract v1 run-scoped envelope addressed at the exact run/session the
 * app just bound via bindNormalizedRun (see testFakeHost.ts's own
 * `lastPromptRun` doc). Once a real send admits through POST /api/prompt,
 * App.tsx's onServerEvent only reduces this shape — a bare unscoped
 * `{type, ...}` frame is deliberately ignored post-bind.
 */
function envelope(
  target: { runId: string; sessionId: string },
  seq: number,
  payload: RunEventEnvelope["payload"],
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: target.sessionId,
    runId: target.runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

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
  it("binds via the Pack section's Add action and opens a file the agent touched", async () => {
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

    // Task 15 — the old dedicated "Local files" panel (Open/Change folder…,
    // "Tools can use: <folder>") is gone; folder choice now lives behind
    // the sidebar's Pack section "Add" action.
    const addBtn = await screen.findByRole("button", { name: "Add" });
    await user.click(addBtn);

    await waitFor(() => assert.ok(host.callsTo("/api/pick-folder").length >= 1));
    await waitFor(() => {
      const chatRootCalls = host.callsTo("/api/chat-root");
      assert.ok(chatRootCalls.length >= 1);
      assert.equal(chatRootCalls[chatRootCalls.length - 1]!.body?.path, "D:\\docs");
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
    await waitFor(() => assert.ok(host.lastPromptRun));
    const target = host.lastPromptRun!;

    const pendingActivity: ActivityRecord = {
      activityId: "activity-1",
      invocationId: "t1",
      name: "read_file",
      lifecycle: "pending",
      execution: null,
      status: "running",
      input: { path: "D:\\docs\\notes.txt" },
      output: null,
      error: null,
      diff: null,
      path: null,
      policy: {},
      automaticEligibility: "not_eligible",
      autoApplied: false,
      command: null,
      editId: null,
      recovery: null,
      summary: null,
    };
    const succeededActivity: ActivityRecord = {
      ...pendingActivity,
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      input: { path: "notes.txt" },
      output: "Q3 plan: ship dual-mode.",
      summary: "D:\\docs\\notes.txt",
    };
    ws.emit(envelope(target, 1, { kind: "activity_update", activity: pendingActivity }) as unknown as Record<string, unknown>);
    ws.emit(envelope(target, 2, { kind: "activity_update", activity: succeededActivity }) as unknown as Record<string, unknown>);
    ws.emit(envelope(target, 3, {
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "Here's what's in the file.",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }) as unknown as Record<string, unknown>);

    // Receipts group may start open or collapsed depending on groupKey —
    // make sure it's open, then expand the row itself to reach its
    // "Open <path>" action.
    const toolHead = await screen.findByRole("button", { name: /action/i });
    if (toolHead.getAttribute("aria-expanded") !== "true") {
      await user.click(toolHead);
    }
    const rowHeads = await screen.findAllByRole("button", { name: /notes\.txt/i });
    await user.click(rowHeads[rowHeads.length - 1]!);

    // KNOWN FAILURE (confirmed, not a transport bug): the row now paints
    // correctly (Read / D:\docs\notes.txt / "Q3 plan: ship dual-mode." all
    // render — verified by DOM dump), but no "Open " button appears.
    // RunSurface.tsx's own <Receipts> call (around its "activity-output"
    // section) never passes an `onOpenPath` prop, unlike TranscriptBody.tsx's
    // <Receipts onOpenPath={(p) => void openToolPath(p)}> for the legacy,
    // un-projected message pipeline. Pre-fix, this test passed only because
    // the fixture's admission threw (see testFakeHost.ts's own /api/prompt
    // comment), bindNormalizedRun never ran, and the scripted bare tool_run
    // frames painted through the legacy pipeline instead — where onOpenPath
    // *is* wired. Once a real send binds a Contract v1 run, this activity
    // renders exclusively via RunSurface (the legacy copy is filtered out of
    // visibleMessages by its own projectedRunId), which has no Open action.
    // Fixing this requires wiring onOpenPath through RunSurface — an App.tsx/
    // RunSurface.tsx change, out of this branch's scope. Left failing rather
    // than weakened.
    const openBtn = screen.getByRole("button", { name: /^Open /i });
    await user.click(openBtn);
    await waitFor(() => assert.ok(host.callsTo("/api/workspace/read").length >= 1));
    await waitFor(() => assert.ok(screen.getAllByText(/notes\.txt/i).length >= 1));
  });
});
