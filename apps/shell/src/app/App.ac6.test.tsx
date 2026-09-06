// AC6 — Code: workspace + tools + permission + staged diff still work. The
// regression-protection centerpiece named by the conductor: this path is
// what the Code dogfood depends on and had zero automated coverage before
// this bounce. Mocks the network boundary only (fetch + WebSocket); real
// App, real session store, real permission/diff wiring.
//
// Rewritten onto the modern run-envelope protocol (schemaVersion + eventSeq).
// This test used to drive App.tsx's raw tool_request/permission_request/
// file_edit handlers directly — App.tsx's own comment marks those as
// "legacy transcript events ... for older hosts during migration", and
// apps/host/src/session.ts already translates ACP's file_edit/tool_run into
// envelope decision_request/activity_update before anything reaches the
// shell. Task 9's Changes dock is built against that envelope-derived
// run.activities (via runChangeList.ts), not the legacy flat-diffQueue-only
// path, so a diff decision now needs a paired activity_update — exactly what
// a real host sends — to show up with Accept/Reject.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import { CHANGES_DOCK_LABEL } from "../dock/ChangesDock";
import type { ActivityRecord, DecisionRequest, RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

// Reassigned in the test itself to the App's own client-generated session id
// (read back from the captured /api/prompt request body) once Ctrl+N creates
// a real session — envelope() and runSnapshot() below close over these as
// live bindings, so every event constructed after that point carries the
// real id the App is actually scoped to.
let SESSION_ID = "ac6-session";
const RUN_ID = "ac6-run";

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

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "add a README section",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "review" },
    model: { id: "grok-4.6" },
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    ...overrides,
  };
}

function envelope(payload: RunEventEnvelope["payload"], seq: number): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

function readActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "act-read",
    invocationId: "inv-read",
    name: "read_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { path: "README.md" },
    output: "# repo",
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "review" },
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    ...overrides,
  };
}

function writePermission(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "perm-1",
    invocationId: "inv-write",
    kind: "permission",
    status: "pending",
    title: "Write file",
    detail: "Write README.md",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

const README_DIFF = [
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1,2 @@",
  " # repo",
  "+New section",
  "",
].join("\n");

function writeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "act-write",
    invocationId: "inv-write",
    name: "write_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "README.md" },
    output: null,
    error: null,
    diff: README_DIFF,
    path: "README.md",
    policy: { effectiveMode: "review" },
    automaticEligibility: "not_eligible",
    autoApplied: false,
    command: null,
    editId: "edit-readme",
    recovery: null,
    ...overrides,
  };
}

function diffDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "diff-1",
    invocationId: "inv-write",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "README.md",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
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

describe("AC6 — Code: workspace + tools + permission + staged diff", () => {
  it("runs a tool, decides a permission, and accepts a staged diff end to end", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: "C:\\repo",
      workspaceName: "repo",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Workspace chrome present (SPEC AC6's "workspace" clause).
    await waitFor(() => {
      assert.ok(document.querySelector('.ws[title="C:\\\\repo"]'));
      assert.ok(screen.getAllByText(/repo/).length > 0);
    });

    await user.keyboard("{Control>}n{/Control}");
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "add a README section");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));

    // The App generates its own session id on Ctrl+N and sends it as part of
    // /api/prompt's body — read it back so the WS envelopes below are scoped
    // to the session the App actually has active (run.sessionId gates which
    // runs App.tsx treats as "this session's", including the Changes dock).
    const promptBody = host.callsTo("/api/prompt")[0]!.body as { sessionId?: string } | undefined;
    assert.ok(promptBody?.sessionId, "captured /api/prompt call must carry a sessionId");
    SESSION_ID = promptBody!.sessionId!;

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;

    ws.emit(envelope({ kind: "run_started", run: runSnapshot() }, 1) as unknown as Record<string, unknown>);

    // 1) Tool call — a read that succeeds.
    ws.emit(envelope({ kind: "activity_update", activity: readActivity() }, 2) as unknown as Record<string, unknown>);

    // 2) Permission — a write needs the user's decision before it can stage.
    ws.emit(envelope({ kind: "decision_request", request: writePermission() }, 3) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(screen.getByRole("region", { name: "Grok wants to write a file" }));
    });
    await user.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      const permCalls = host.callsTo("/api/permission");
      assert.ok(permCalls.length >= 1);
      assert.equal(permCalls[permCalls.length - 1]!.body?.decision, "allow_once");
    });
    // A real host confirms the decision over the run's own event stream —
    // App.tsx's decidePermission re-adds the card if the durable
    // run.decisions entry is still "pending" once the API call resolves
    // (never trusting the optimistic local removal alone), so the gate only
    // clears for good once this arrives.
    ws.emit(envelope({ kind: "decision_request", request: writePermission({ status: "accepted" }) }, 4) as unknown as Record<string, unknown>);
    // Dock clears the decided permission. queryAllByRole (never throws, even
    // transiently past a single match) rather than queryByRole — jsdom's
    // prettyDOM over the full App tree hangs on a query-failure message (see
    // testEnv.ts's getElementError comment), and a bare queryByRole throws on
    // more than one match, not just on zero.
    await waitFor(() => {
      assert.equal(screen.queryAllByRole("region", { name: "Grok wants to write a file" }).length, 0);
    });

    // 3) Staged diff — proposed after the permission is granted. A real host
    // always pairs an activity_update (carrying editId/diff/path) with the
    // decision_request for the same edit; the Changes dock reads the former.
    ws.emit(envelope({ kind: "activity_update", activity: writeActivity() }, 5) as unknown as Record<string, unknown>);
    ws.emit(envelope({ kind: "decision_request", request: diffDecision() }, 6) as unknown as Record<string, unknown>);

    await waitFor(() => {
      const diffRegion = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
      assert.ok(within(diffRegion).getAllByText(/README\.md/).length > 0);
    });

    // Diff staged, not yet applied.
    assert.equal(host.callsTo("/api/diff").length, 0);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      const diffCalls = host.callsTo("/api/diff");
      assert.ok(diffCalls.length >= 1);
      assert.equal(diffCalls[diffCalls.length - 1]!.body?.action, "accept");
    });
    // Same reasoning as the permission above — confirm over the event stream
    // before expecting the Accept control to be gone for good.
    ws.emit(envelope({ kind: "decision_request", request: diffDecision({ status: "accepted" }) }, 7) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.equal(screen.queryAllByRole("button", { name: "Accept" }).length, 0);
    });

    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "Added the README section.",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 8) as unknown as Record<string, unknown>);

    await waitFor(() => assert.ok(screen.getByText(/Added the README section\./)));
  });
});
