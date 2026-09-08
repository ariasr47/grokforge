import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import { useDecisions, type UseDecisionsParams } from "./useDecisions";
import {
  initialRunProjection,
  reduceRunEvent,
  type ActivityRecord,
  type DecisionRequest,
  type RunEventEnvelope,
  type RunProjection,
  type RunSnapshot,
} from "../projections/runReducer";
import type { PendingDiff, PermissionReq } from "../projections/runChangeList";
import type { PublicState } from "../lib/api";
import type { ToastKind } from "../thread/Toast";
import { PLAN_DECISION_FAILURE } from "../dock/ActionDock";

// Same fixture idiom as useChangesProjections.test.ts / runChangeList.test.ts
// (snap -> event -> reduce).
const SESSION = "sess-a";
const RUN = "run-a";
const WORKSPACE = "C:\\repo";

function snap(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION,
    runId: RUN,
    connectionGeneration: 7,
    state: "running",
    acceptedPrompt: "prompt",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 0,
    policy: {},
    model: {},
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    ...overrides,
  };
}

function startedEvent(s: RunSnapshot, seq = 1): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "run_started",
    sessionId: s.sessionId,
    runId: s.runId,
    eventSeq: seq,
    connectionGeneration: s.connectionGeneration,
    occurredAt: "",
    payload: { kind: "run_started", run: s },
  };
}

function decisionEvent(
  decision: DecisionRequest,
  seq: number,
  opts: { sessionId?: string; runId?: string } = {},
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "decision_request",
    sessionId: opts.sessionId ?? SESSION,
    runId: opts.runId ?? RUN,
    eventSeq: seq,
    connectionGeneration: 7,
    occurredAt: "",
    payload: { kind: "decision_request", request: decision },
  };
}

function activityEvent(activity: ActivityRecord, seq: number): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "activity_update",
    sessionId: SESSION,
    runId: RUN,
    eventSeq: seq,
    connectionGeneration: 7,
    occurredAt: "",
    payload: { kind: "activity_update", activity },
  };
}

function planDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "plan-1",
    invocationId: "inv-plan-1",
    kind: "plan",
    status: "pending",
    title: "Plan ready",
    detail: "",
    expiresAt: null,
    policy: {},
    ...overrides,
  };
}

function recoveryDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "rec-1",
    invocationId: "inv-rec-1",
    kind: "recovery_confirmation",
    status: "pending",
    title: "Restore?",
    detail: "Restore the file to its state before the last write?",
    expiresAt: null,
    policy: {},
    ...overrides,
  };
}

function recoveryActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "act-1",
    invocationId: "inv-rec-1",
    name: "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: null,
    path: "src/a.ts",
    policy: {},
    automaticEligibility: "none",
    autoApplied: false,
    command: null,
    editId: "edit-1",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function ref<T>(value: T): RefObject<T> {
  return { current: value };
}

function noop(): void {}

function fakeToast() {
  const calls: Array<{ message: string; kind?: ToastKind }> = [];
  return {
    calls,
    api: {
      push: (message: string, kind?: ToastKind) => {
        calls.push({ message, kind });
      },
      dismiss: (_id: string) => {},
    },
  };
}

function permission(overrides: Partial<PermissionReq> = {}): PermissionReq {
  return {
    id: "perm-1",
    kind: "shell",
    detail: "npm test",
    sessionId: SESSION,
    runId: RUN,
    invocationId: "inv-perm-1",
    ...overrides,
  };
}

function calls() {
  const write: boolean[] = [];
  const shell: boolean[] = [];
  return {
    write,
    shell,
    setSessionWrite: (v: boolean) => write.push(v),
    setSessionShell: (v: boolean) => shell.push(v),
  };
}

// Mirrors how App.tsx actually calls the hook: permissions/planDecisionError
// are real useState (so decidePermission's setPermissions(...) and
// settlePlan's/the reset effect's setPlanDecisionError(...) calls are
// observable) — matching useSkillsPalette.test.ts's/useChangesProjections
// .test.ts's own useHarness idiom (draft/diffQueue as real state there).
function useHarness(props: {
  initialPermissions?: PermissionReq[];
  diffQueue?: PendingDiff[];
  oauth?: UseDecisionsParams["oauth"];
  runProjection: RunProjection;
  sessionId: string | null;
  stateRef?: RefObject<PublicState | null>;
  applyState?: (payload: PublicState) => void;
  reportError?: (message: string, meta?: Record<string, unknown>) => void;
  setSessionWrite?: (v: boolean) => void;
  setSessionShell?: (v: boolean) => void;
  productMode?: UseDecisionsParams["productMode"];
  connected?: boolean;
  activeRun?: UseDecisionsParams["activeRun"];
  workspace?: string | null;
  planEngagement?: UseDecisionsParams["planEngagement"];
  planArmError?: string | null;
  toast?: UseDecisionsParams["toast"];
}) {
  const [permissions, setPermissions] = useState(props.initialPermissions ?? []);
  const [planDecisionError, setPlanDecisionError] = useState<string | null>(null);
  const [runProjection, setRunProjection] = useState(props.runProjection);
  const runProjectionRef = useRef(runProjection);
  runProjectionRef.current = runProjection;
  const hook = useDecisions({
    permissions,
    setPermissions,
    diffQueue: props.diffQueue ?? [],
    oauth: props.oauth ?? null,
    runProjection,
    runProjectionRef,
    sessionId: props.sessionId,
    stateRef: props.stateRef ?? ref(null),
    applyState: props.applyState ?? noop,
    toast: props.toast ?? fakeToast().api,
    reportError: props.reportError ?? noop,
    setSessionWrite: props.setSessionWrite ?? noop,
    setSessionShell: props.setSessionShell ?? noop,
    productMode: props.productMode ?? "code",
    connected: props.connected ?? true,
    activeRun: props.activeRun ?? null,
    workspace: props.workspace ?? null,
    planEngagement: props.planEngagement,
    planArmError: props.planArmError ?? null,
    setPlanDecisionError,
    commitRunProjection: (next) => {
      runProjectionRef.current = next;
      setRunProjection(next);
    },
  });
  return { ...hook, permissions, planDecisionError };
}

describe("useDecisions", () => {
  it("decidePermission(allow_once) POSTs the decision and clears the queue", async () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() =>
        useHarness({
          initialPermissions: [permission()],
          runProjection: initialRunProjection(),
          sessionId: SESSION,
        }),
      );

      assert.equal(result.current.permissions.length, 1);
      await act(async () => {
        await result.current.decidePermission("allow_once");
      });

      assert.equal(seen.length, 1);
      assert.ok(seen[0]!.url.endsWith("/api/permission"), seen[0]!.url);
      assert.deepEqual(seen[0]!.body, {
        sessionId: SESSION,
        runId: RUN,
        requestId: "perm-1",
        invocationId: "inv-perm-1",
        decision: "allow_once",
      });
      // Empty projection -> no owner still pending -> the queue clears.
      assert.equal(result.current.permissions.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("decidePermission(allow_session) sets the session flag matching the permission's own kind, not the other one", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

    try {
      const writeCalls = calls();
      const { result: writeResult } = renderHook(() =>
        useHarness({
          initialPermissions: [permission({ id: "p-write", kind: "write" })],
          runProjection: initialRunProjection(),
          sessionId: SESSION,
          setSessionWrite: writeCalls.setSessionWrite,
          setSessionShell: writeCalls.setSessionShell,
        }),
      );
      await act(async () => {
        await writeResult.current.decidePermission("allow_session");
      });
      assert.deepEqual(writeCalls.write, [true]);
      assert.deepEqual(writeCalls.shell, []);

      const shellCalls = calls();
      const { result: shellResult } = renderHook(() =>
        useHarness({
          initialPermissions: [permission({ id: "p-shell", kind: "shell" })],
          runProjection: initialRunProjection(),
          sessionId: SESSION,
          setSessionWrite: shellCalls.setSessionWrite,
          setSessionShell: shellCalls.setSessionShell,
        }),
      );
      await act(async () => {
        await shellResult.current.decidePermission("allow_session");
      });
      assert.deepEqual(shellCalls.shell, [true]);
      assert.deepEqual(shellCalls.write, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("trustFolder saves the workspace policy, applies it, then allows the pending permission once — never allow_session", async () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/api/workspace-policy")) {
        return new Response(JSON.stringify({ policy: { effectiveMode: "trusted_workspace" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const applied: PublicState[] = [];
      const fakeState = { workspace: WORKSPACE } as unknown as PublicState;
      const { result } = renderHook(() =>
        useHarness({
          initialPermissions: [permission({ id: "p-write", kind: "write" })],
          runProjection: initialRunProjection(),
          sessionId: SESSION,
          stateRef: ref(fakeState),
          applyState: (payload) => applied.push(payload),
          workspace: WORKSPACE,
        }),
      );

      await act(async () => {
        await result.current.trustFolder();
      });

      assert.equal(seen.length, 2);
      assert.ok(seen[0]!.url.endsWith("/api/workspace-policy"), seen[0]!.url);
      assert.deepEqual(seen[0]!.body, { sessionId: SESSION, workspace: WORKSPACE, mode: "trusted_workspace" });
      assert.ok(seen[1]!.url.endsWith("/api/permission"), seen[1]!.url);
      // Trusting the folder settles the *current* card via allow_once —
      // allow_session would wrongly skip diffs for binary writes too.
      assert.equal((seen[1]!.body as { decision: string }).decision, "allow_once");
      assert.equal(applied.length, 1);
      assert.equal(
        (applied[0] as unknown as { permissionPolicy: { effectiveMode: string } }).permissionPolicy.effectiveMode,
        "trusted_workspace",
      );
      assert.equal(result.current.permissions.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("settlePlan posts the pending plan decision's own ids and clears planDecisionError up front", async () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap()));
    state = reduceRunEvent(state, decisionEvent(planDecision(), 2));

    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/api/runs/")) {
        return new Response(JSON.stringify({ run: snap(), events: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() =>
        useHarness({ runProjection: state, sessionId: SESSION }),
      );

      assert.ok(result.current.pendingPlanDecision);
      assert.equal(result.current.planSettling, false);

      await act(async () => {
        await result.current.settlePlan("accept");
      });

      const planPost = seen.find((s) => s.url.endsWith("/api/plan"));
      assert.ok(planPost, "expected POST /api/plan");
      assert.deepEqual(planPost!.body, {
        sessionId: SESSION,
        runId: RUN,
        requestId: "plan-1",
        invocationId: "inv-plan-1",
        connectionGeneration: 7,
        action: "accept",
      });
      assert.ok(
        seen.some((s) => s.url.includes(`/api/runs/${RUN}`)),
        "successful Accept still folds the journal so a missed WS frame cannot keep the dock",
      );
      assert.equal(result.current.planSettling, false, "settling clears once the call resolves");
      assert.equal(result.current.planDecisionError, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("settlePlan after agent-done folds journal Accept so a 404 does not keep the dock pending", async () => {
    // Live G4: host already appended post-terminal plan_record + decision
    // accepted (seq 286–287) while the shell still showed pending. Try again
    // POSTed 404 decision_not_found and painted PLAN_DECISION_FAILURE.
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap({ state: "running" })));
    state = reduceRunEvent(state, decisionEvent(planDecision(), 2));
    state = reduceRunEvent(
      state,
      {
        schemaVersion: 1,
        type: "run_terminal",
        sessionId: SESSION,
        runId: RUN,
        eventSeq: 3,
        connectionGeneration: 7,
        occurredAt: "",
        payload: {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: "1. Edit README.md",
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
      },
    );
    assert.equal(state.runsById[RUN]?.state, "terminal");
    assert.equal(state.runsById[RUN]?.decisions["plan-1"]?.status, "pending");
    assert.equal(state.runsById[RUN]?.lastEventSeq, 3);

    const accepted = planDecision({ status: "accepted" });
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/api/plan")) {
        return new Response(
          JSON.stringify({ error: "decision not found", code: "decision_not_found" }),
          { status: 404 },
        );
      }
      if (url.includes(`/api/runs/${RUN}`)) {
        assert.match(url, /after=3/);
        return new Response(
          JSON.stringify({
            run: snap({ state: "terminal", lastEventSeq: 5, terminalKind: "answered" }),
            events: [
              decisionEvent(accepted, 4),
              {
                schemaVersion: 1,
                type: "plan_record",
                sessionId: SESSION,
                runId: RUN,
                eventSeq: 5,
                connectionGeneration: 7,
                occurredAt: "",
                payload: {
                  kind: "plan_record",
                  plan: {
                    runId: RUN,
                    sessionId: SESSION,
                    connectionGeneration: 7,
                    status: "accepted",
                    body: "1. Edit README.md",
                    proposedMembers: [],
                    policy: {},
                    executionPhase: "plan",
                  },
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() =>
        useHarness({ runProjection: state, sessionId: SESSION }),
      );
      assert.ok(result.current.pendingPlanDecision);

      await act(async () => {
        await result.current.settlePlan("accept");
      });

      assert.ok(
        seen.some((url) => url.includes(`/api/runs/${RUN}`)),
        `expected journal catch-up after agent-done, got ${seen.join(" | ")}`,
      );
      assert.equal(result.current.planSettling, false);
      assert.equal(result.current.planDecisionError, null);
      assert.equal(result.current.pendingPlanDecision, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("a failed settlePlan sets planDecisionError to the shared failure copy and still clears planSettling", async () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap()));
    state = reduceRunEvent(state, decisionEvent(planDecision(), 2));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as typeof fetch;

    try {
      const { result } = renderHook(() =>
        useHarness({ runProjection: state, sessionId: SESSION }),
      );

      await act(async () => {
        await result.current.settlePlan("accept");
      });

      assert.equal(result.current.planSettling, false);
      assert.equal(result.current.planDecisionError, PLAN_DECISION_FAILURE);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("chooseAskOption(0) recovers the pending recovery decision; 1 and 2 are no-ops (only one option exists today)", async () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap()));
    state = reduceRunEvent(state, activityEvent(recoveryActivity(), 2));
    state = reduceRunEvent(state, decisionEvent(recoveryDecision(), 3));

    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true, activity: {} }), { status: 200 });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() =>
        useHarness({ runProjection: state, sessionId: SESSION }),
      );

      assert.ok(result.current.pendingRecoveryDecision);
      assert.equal(result.current.pendingRecoveryDecision?.editId, "edit-1");

      act(() => result.current.chooseAskOption(1));
      act(() => result.current.chooseAskOption(2));
      assert.equal(seen.length, 0, "only option 0 exists today — 1/2 must stay inert");

      await act(async () => {
        result.current.chooseAskOption(0);
      });
      assert.equal(seen.length, 1);
      assert.ok(seen[0]!.url.endsWith("/api/edit-recovery"), seen[0]!.url);
      assert.deepEqual(seen[0]!.body, { sessionId: SESSION, runId: RUN, editId: "edit-1" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("anyDecisionPending tracks oauth, permissions, diffQueue, and pendingPlanDecision independently (the tinykeys/sendText formula)", () => {
    const empty = initialRunProjection();

    // All four falsy/empty -> false.
    const { result: r0 } = renderHook(() => useHarness({ runProjection: empty, sessionId: SESSION }));
    assert.equal(r0.current.anyDecisionPending, false);

    // oauth alone.
    const { result: r1 } = renderHook(() =>
      useHarness({ runProjection: empty, sessionId: SESSION, oauth: { user_code: "ABCD-1234", verification_uri: "https://x.ai/device" } }),
    );
    assert.equal(r1.current.anyDecisionPending, true);

    // permissions alone.
    const { result: r2 } = renderHook(() =>
      useHarness({ runProjection: empty, sessionId: SESSION, initialPermissions: [permission()] }),
    );
    assert.equal(r2.current.anyDecisionPending, true);

    // diffQueue alone.
    const { result: r3 } = renderHook(() =>
      useHarness({ runProjection: empty, sessionId: SESSION, diffQueue: [{ id: "d1", path: "a.ts", diff: "d" }] }),
    );
    assert.equal(r3.current.anyDecisionPending, true);

    // pendingPlanDecision alone, for the current session.
    let withPlan = initialRunProjection();
    withPlan = reduceRunEvent(withPlan, startedEvent(snap()));
    withPlan = reduceRunEvent(withPlan, decisionEvent(planDecision(), 2));
    const { result: r4 } = renderHook(() => useHarness({ runProjection: withPlan, sessionId: SESSION }));
    assert.equal(r4.current.anyDecisionPending, true);

    // The same plan decision, but for a *different* session — session-scoped
    // exactly like pendingPlanDecision's own memo, so it must not count.
    const { result: r5 } = renderHook(() => useHarness({ runProjection: withPlan, sessionId: "other-session" }));
    assert.equal(r5.current.anyDecisionPending, false);

    // A pending recovery_confirmation decision is NOT one of the four terms
    // (pendingRecoveryDecision is a separate field the brief's formula never
    // named) — confirms anyDecisionPending does not over-fire on it.
    let withRecovery = initialRunProjection();
    withRecovery = reduceRunEvent(withRecovery, startedEvent(snap()));
    withRecovery = reduceRunEvent(withRecovery, activityEvent(recoveryActivity(), 2));
    withRecovery = reduceRunEvent(withRecovery, decisionEvent(recoveryDecision(), 3));
    const { result: r6 } = renderHook(() => useHarness({ runProjection: withRecovery, sessionId: SESSION }));
    assert.equal(r6.current.anyDecisionPending, false);
  });

  it("planArm wires productMode/workspace/connected/planEngagement/armError straight into projectPlanArm", () => {
    // Lightweight wiring check only — projectPlanArm's own state machine is
    // already exhaustively covered by planArm.test.ts; this just pins that
    // the hook feeds it the right parameters under the right names.
    const empty = initialRunProjection();
    const { result: offline } = renderHook(() =>
      useHarness({ runProjection: empty, sessionId: SESSION, productMode: "code", connected: false }),
    );
    assert.deepEqual(offline.current.planArm, { state: "offline" });

    const { result: errored } = renderHook(() =>
      useHarness({
        runProjection: empty,
        sessionId: SESSION,
        productMode: "code",
        connected: true,
        planEngagement: { engaged: false, vouched: true },
        planArmError: "could not save",
      }),
    );
    assert.deepEqual(errored.current.planArm, { state: "error", message: "could not save" });
  });
});
