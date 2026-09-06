import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import { PLAN_ARM_BLOCKED_UNVOUCHED, PLAN_ARM_HELPER_ARMED, PLAN_LIVE_FOOTER, PLAN_LIVE_STATUS } from "../projections/planArm";
import { PLAN_EMPTY, PLAN_HEADER } from "../sections/PlanSection";
import { PLAN_ACCEPT, PLAN_DECISION_FAILURE, PLAN_DOCK_EMPTY, PLAN_END_EMPTY, PLAN_KEEP, planReadyTitle } from "../dock/ActionDock";
import type { DecisionRequest, PlanRecord, RunEventEnvelope, RunSnapshot } from "../projections/runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "plan-session";
const RUN_ID = "plan-run";

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
  reloadSessionsFromDisk({
    byWorkspace: {
      [WORKSPACE]: [{
        id: SESSION_ID,
        workspace: WORKSPACE,
        title: "Plan stretch",
        messages: [{ id: "u1", role: "user", content: "propose a change" }],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [WORKSPACE]: SESSION_ID },
    pinned: [WORKSPACE],
    expanded: [WORKSPACE],
  });
  FakeWebSocket.reset();
}

function planSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "waiting_for_decision",
    acceptedPrompt: "propose a change",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "review" },
    model: { id: "grok-4.6" },
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    executionPhase: "plan",
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

function readyPlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    runId: RUN_ID,
    sessionId: SESSION_ID,
    connectionGeneration: 1,
    status: "ready",
    body: "Nothing to change in this workspace.",
    proposedMembers: [],
    policy: { effectiveMode: "review" },
    executionPhase: "plan",
    ...overrides,
  };
}

function planDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "plan-req",
    invocationId: "plan-inv",
    kind: "plan",
    status: "pending",
    title: "Plan complete · no changes",
    detail: "",
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

describe("plan-mode App journeys", () => {
  it("Chat has no Plan control and send is ungated by Plan", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    assert.equal(screen.queryByLabelText("Plan") === null, true);
    fireEvent.change(screen.getByLabelText("Message to agent"), { target: { value: "Hello" } });
    assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), false);
  });

  it("missing planEngagement blocks Send with blocked_unvouched chrome (AC-28)", async () => {
    const host = createFakeHost(
      { mode: "code", workspace: WORKSPACE, workspaceName: "repo", busy: false, planEngagement: undefined },
      { omitPlanEngagement: true },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(PLAN_ARM_BLOCKED_UNVOUCHED));
    });
    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.hasAttribute("disabled"), true);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), "please mutate");
    assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), true);
    assert.equal(host.callsTo("/api/prompt").length, 0);
  });

  it("arming Plan POSTs engagement and shows exact helper (AC-01)", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: false, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Plan" }));
    await waitFor(() => {
      assert.ok(host.callsTo("/api/plan-engagement").length >= 1);
    });
    await waitFor(() => {
      assert.ok(screen.getByText(PLAN_ARM_HELPER_ARMED));
    });
    assert.equal(host.state.planEngagement?.engaged, true);
  });

  it("E1 Plan chip POST includes the prompting sessionId", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: false, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Plan" }));
    await waitFor(() => {
      const calls = host.callsTo("/api/plan-engagement");
      assert.ok(calls.length >= 1);
      const body = calls[calls.length - 1]?.body as { engaged?: boolean; sessionId?: string };
      assert.equal(body.engaged, true);
      assert.equal(body.sessionId, SESSION_ID);
    });
  });

  it("E1 New session does not POST Plan off — Plan stays composer-scoped", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(PLAN_ARM_HELPER_ARMED));
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New session" }));
    await waitFor(() => {
      const offs = host.callsTo("/api/plan-engagement").filter((c) => {
        try {
          return JSON.parse(String(c.body ?? "{}")).engaged === false;
        } catch {
          return false;
        }
      });
      assert.equal(offs.length, 0);
    });
    assert.equal(host.state.planEngagement?.engaged, true);
    assert.ok(screen.getByText(PLAN_ARM_HELPER_ARMED));
  });

  it("empty ready plan shows No changes proposed and empty dock copy (AC-12)", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    const snap = planSnapshot({ lastEventSeq: 1, state: "running" });
    ws.emit(envelope({ kind: "run_started", run: snap }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "plan_record",
      plan: readyPlan(),
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "decision_request",
      request: planDecision(),
    }, 3) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(screen.getByRole("region", { name: PLAN_HEADER }));
      assert.ok(screen.getByText(PLAN_EMPTY));
    });
    const dock = screen.getByRole("region", { name: "Pending agent actions" });
    assert.ok(within(dock).getByText(PLAN_DOCK_EMPTY));
    assert.ok(within(dock).getByRole("button", { name: PLAN_END_EMPTY }));
    assert.ok(within(dock).getByRole("button", { name: PLAN_KEEP }));
    assert.equal(within(dock).queryByRole("button", { name: /reject/i }) === null, true);
    assert.equal(within(dock).queryByText(/Plan ready/) === null, true);
  });

  it("non-empty ready dock is Review plan + Accept plan + Keep planning; no Reject (AC-30)", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: planSnapshot({ state: "running" }) }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "plan_record",
      plan: readyPlan({
        body: "Would change two files",
        proposedMembers: [
          { path: "src/a.ts", summary: "Update helper" },
          { path: "src/b.ts", summary: "Create UI" },
        ],
      }),
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "decision_request",
      request: planDecision({ title: "Review plan" }),
    }, 3) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(screen.getByText("src/a.ts"));
      assert.ok(screen.getByText("src/b.ts"));
    });
    const dock = screen.getByRole("region", { name: "Pending agent actions" });
    assert.ok(within(dock).getByText(planReadyTitle(2)));
    assert.ok(within(dock).getByRole("button", { name: PLAN_ACCEPT }));
    assert.ok(within(dock).getByRole("button", { name: PLAN_KEEP }));
    assert.equal(within(dock).queryByRole("button", { name: /reject/i }) === null, true);

    const user = userEvent.setup();
    await user.click(within(dock).getByRole("button", { name: PLAN_ACCEPT }));
    await waitFor(() => {
      assert.ok(host.callsTo("/api/plan").length >= 1);
    });
    assert.equal(host.callsTo("/api/plan")[0]?.body?.action, "accept");
  });

  it("live Planning chrome only when the live run executionPhase is plan (AC-29)", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({
      kind: "run_started",
      run: planSnapshot({ state: "running", executionPhase: "execute" }),
    }, 1) as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByLabelText("Run propose a change"));
    });
    assert.equal(screen.queryByText(PLAN_LIVE_STATUS) === null, true);

    ws.emit(envelope({
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "done",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    }, 2) as unknown as Record<string, unknown>);
    ws.emit({
      ...envelope({
        kind: "run_started",
        run: planSnapshot({ runId: "plan-live", state: "running", executionPhase: "plan", lastEventSeq: 1 }),
      }, 1),
      runId: "plan-live",
    } as unknown as Record<string, unknown>);
    await waitFor(() => {
      assert.ok(screen.getByText(PLAN_LIVE_STATUS));
      assert.ok(screen.getAllByText(PLAN_LIVE_FOOTER).length >= 1);
    });
  });

  it("reconnect catch-up restores the same ready plan (AC-17)", async () => {
    localStorage.setItem("grokforge.runProjection.v1", JSON.stringify({
      runs: [{
        ...planSnapshot({ lastEventSeq: 1, state: "waiting_for_decision" }),
        reasoning: {},
        answer: {},
        activities: {},
        decisions: {},
        seenEventSeq: [1],
        terminalEventSeq: null,
        plan: null,
      }],
      cursors: { [SESSION_ID]: 1 },
    }));
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    }, {
      runJournals: {
        [RUN_ID]: {
          run: planSnapshot({ lastEventSeq: 3, state: "waiting_for_decision" }),
          events: [
            envelope({
              kind: "plan_record",
              plan: readyPlan({
                body: "Would change src/a.ts",
                proposedMembers: [{ path: "src/a.ts", summary: "Update helper" }],
              }),
            }, 2),
            envelope({
              kind: "decision_request",
              request: planDecision({ title: "Review plan" }),
            }, 3),
          ],
        },
      },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByText("src/a.ts"));
      assert.ok(screen.getByRole("button", { name: PLAN_ACCEPT }));
    });
    assert.ok(host.callsTo("/api/runs").length >= 1);
  });

  it("F0 a new plan request clears a failed Accept dock so Accept plan returns", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      planEngagement: { engaged: true, vouched: true },
    });
    host.nextPlanError = {
      status: 404,
      error: "no pending plan",
      code: "decision_not_found",
    };
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(envelope({ kind: "run_started", run: planSnapshot() }, 1) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "plan_record",
      plan: readyPlan({
        body: "Would change src/a.ts",
        proposedMembers: [{ path: "src/a.ts", summary: "Update helper" }],
      }),
    }, 2) as unknown as Record<string, unknown>);
    ws.emit(envelope({
      kind: "decision_request",
      request: planDecision({ title: "Review plan" }),
    }, 3) as unknown as Record<string, unknown>);
    const user = userEvent.setup();
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: PLAN_ACCEPT }));
    });
    await user.click(screen.getByRole("button", { name: PLAN_ACCEPT }));
    await waitFor(() => {
      assert.ok(screen.getByText(PLAN_DECISION_FAILURE));
    });
    assert.equal(screen.queryByRole("button", { name: PLAN_ACCEPT }) === null, true);
    await user.click(screen.getByRole("button", { name: "New session" }));
    await waitFor(() => {
      assert.equal(screen.queryByText(PLAN_DECISION_FAILURE) === null, true);
    });
  });
});
