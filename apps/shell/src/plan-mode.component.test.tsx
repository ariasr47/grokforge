import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ActionDock, PLAN_ACCEPT, PLAN_DOCK_EMPTY, PLAN_END_EMPTY, PLAN_KEEP, PLAN_SETTLING, planReadyTitle } from "./ActionDock";
import { CHANGES_DOCK_LABEL, ChangesDock } from "./ChangesDock";
import { PLAN_HEADER } from "./PlanSection";
import { PLAN_LIVE_FOOTER, PLAN_LIVE_STATUS } from "./planArm";
import { RunSurface } from "./RunSurface";
import { ThreadHeader } from "./ThreadHeader";
import type { ActivityRecord, PlanRecord, RunProjectionRun, RunSnapshot } from "./runReducer";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "plan the change",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 4,
  policy: { effectiveMode: "review" },
  model: { id: "grok-4.6" },
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  failure: null,
  executionPhase: "plan",
};

function run(overrides: Partial<RunProjectionRun> = {}): RunProjectionRun {
  return {
    ...snapshot,
    reasoning: {},
    message: {},
    answer: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: null,
    plan: null,
    ...overrides,
  };
}

function planRecord(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    runId: "r1",
    sessionId: "s1",
    connectionGeneration: 1,
    status: "ready",
    body: "Update two files",
    proposedMembers: [
      { path: "src/a.ts", summary: "Update helper" },
      { path: "src/b.ts", summary: "Create UI" },
    ],
    policy: { effectiveMode: "review" },
    executionPhase: "plan",
    ...overrides,
  };
}

function writeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a1",
    invocationId: "i1",
    name: "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: "--- a/a.txt\n+++ b/a.txt\n+A",
    path: "a.txt",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e1",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function verifyActivity(): ActivityRecord {
  return {
    activityId: "v1",
    invocationId: "vi1",
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: "ok",
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
    command: "npm test",
    editId: null,
    recovery: null,
  };
}

test("hierarchy: Plan before Activity", () => {
  // File changes / Verify moved out of RunSurface into the Changes dock
  // (Task 9) — they're a separate panel now, not orderable against Plan/
  // Activity inside one RunSurface render. Plan-before-Activity still is.
  render(
    <RunSurface
      run={run({
        executionPhase: "execute",
        plan: planRecord(),
        activities: {
          a1: writeActivity(),
          v1: verifyActivity(),
        },
      })}
    />,
  );
  const plan = screen.getByRole("region", { name: PLAN_HEADER });
  const activity = screen.getByLabelText("Activity");
  assert.ok(plan.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("live Planning chrome only when planOwned", () => {
  // Live Planning status moved into ThreadHeader (Task 9); PLAN_LIVE_FOOTER
  // is still App.tsx's own untouched run-footer ternary, not re-tested here.
  const { rerender } = render(
    <ThreadHeader
      title="t"
      liveStatusText={PLAN_LIVE_STATUS}
      overview={null}
      onExport={() => undefined}
      changesOpen={false}
      onToggleChanges={() => undefined}
      changesAvailable={false}
    />,
  );
  assert.ok(screen.getByText(PLAN_LIVE_STATUS));
  assert.equal(PLAN_LIVE_FOOTER, "Plan · no edits applied");
  rerender(
    <ThreadHeader
      title="t"
      liveStatusText={null}
      overview={null}
      onExport={() => undefined}
      changesOpen={false}
      onToggleChanges={() => undefined}
      changesAvailable={false}
    />,
  );
  assert.equal(screen.queryByText(PLAN_LIVE_STATUS), null);
});

test("non-empty plan_pending: Review plan + Accept plan + Keep planning; no Reject", () => {
  render(
    <ActionDock
      permissions={[]}
      oauth={null}
      onPermission={() => undefined}
      planDecision={{ empty: false }}
      onPlanAccept={() => undefined}
      onPlanKeepPlanning={() => undefined}
    />,
  );
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByText(planReadyTitle(0)));
  assert.ok(within(dock).getByRole("button", { name: PLAN_ACCEPT }));
  assert.ok(within(dock).getByRole("button", { name: PLAN_KEEP }));
  assert.equal(within(dock).queryByRole("button", { name: "Reject" }), null);
  assert.equal(within(dock).queryByRole("button", { name: /reject/i }), null);
});

test("empty plan_pending: Plan complete · no changes + End Plan · no changes proposed + Keep planning", () => {
  render(
    <ActionDock
      permissions={[]}
      oauth={null}
      onPermission={() => undefined}
      planDecision={{ empty: true }}
    />,
  );
  assert.ok(screen.getByText(PLAN_DOCK_EMPTY));
  assert.ok(screen.getByRole("button", { name: PLAN_END_EMPTY }));
  assert.ok(screen.getByRole("button", { name: PLAN_KEEP }));
  assert.equal(screen.queryByText(/Plan ready/), null);
  assert.equal(screen.queryByRole("button", { name: PLAN_ACCEPT }), null);
  assert.equal(screen.queryByRole("button", { name: /reject/i }), null);
});

test("settling shows Updating plan decision…", () => {
  render(
    <ActionDock
      permissions={[]}
      oauth={null}
      onPermission={() => undefined}
      planDecision={{ empty: false, settling: true }}
    />,
  );
  assert.ok(screen.getByText(PLAN_SETTLING));
  assert.equal(screen.getByRole("button", { name: PLAN_ACCEPT }).hasAttribute("disabled"), true);
});

test("plan gate keeps its own Accept plan / Keep planning labels alongside the Changes dock's Accept/Reject", () => {
  // DiffPanel moved out of ActionDock into the (separate-panel) Changes dock
  // in Task 9 — render both together, the same way a user would see them,
  // and confirm the labels still don't collide.
  render(
    <>
      <ActionDock
        permissions={[]}
        oauth={null}
        onPermission={() => undefined}
        planDecision={{ empty: false }}
      />
      <ChangesDock
        files={{
          state: "ready",
          members: [{
            editId: "e-1",
            path: "a.txt",
            kind: "content",
            fromPath: null,
            toPath: null,
            activityId: "a-1",
            invocationId: "i-1",
            requestId: "diff-1",
            diff: "+A",
            settlement: "pending",
            recoveryAvailable: false,
            diffUnavailable: false,
            runId: "r1",
          }],
        }}
        verify={{ state: "ready", members: [] }}
        git={{ state: "ready", members: [] }}
        diffQueue={[{ id: "diff-1", path: "a.txt", diff: "+A" }]}
        onAccept={() => undefined}
        onReject={() => undefined}
        onCollapse={() => undefined}
        onOpenReview={() => undefined}
      />
    </>,
  );
  const dock = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
  assert.ok(within(dock).getByRole("button", { name: "Accept" }));
  assert.ok(within(dock).getByRole("button", { name: "Reject" }));
  assert.ok(screen.getByRole("button", { name: PLAN_ACCEPT }));
  assert.ok(screen.getByRole("button", { name: PLAN_KEEP }));
  assert.equal(screen.queryByRole("button", { name: "Reject plan" }), null);
});

test("planning-only run has Plan section (File changes / Verify are not RunSurface's concern)", () => {
  render(
    <RunSurface
      run={run({
        plan: planRecord(),
        activities: {
          r1: {
            activityId: "r1",
            invocationId: "ri1",
            name: "write_file",
            lifecycle: "terminal",
            execution: "not_executed",
            status: "rejected",
            input: {},
            output: null,
            error: "Plan phase: edits and non-inspection shell are not executed",
            diff: null,
            path: null,
            policy: { effectiveMode: "review" },
            automaticEligibility: "not_eligible",
            autoApplied: false,
            command: null,
            editId: null,
            recovery: null,
          },
        },
        decisions: {
          "plan-1": {
            requestId: "plan-1",
            invocationId: "inv",
            kind: "plan",
            status: "pending",
            title: "Review plan",
            detail: "",
            expiresAt: null,
            policy: {},
          },
        },
      })}
    />,
  );
  assert.ok(screen.getByRole("region", { name: PLAN_HEADER }));
  assert.equal(screen.queryByRole("button", { name: "Reject" }), null);
});
