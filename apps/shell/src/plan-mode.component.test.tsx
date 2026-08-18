import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ActionDock, PLAN_ACCEPT, PLAN_DOCK_EMPTY, PLAN_DOCK_REVIEW, PLAN_END_EMPTY, PLAN_KEEP, PLAN_SETTLING } from "./ActionDock";
import { FILE_CHANGES_HEADER } from "./FileChangesSection";
import { VERIFY_HEADER } from "./VerifySection";
import { PLAN_HEADER } from "./PlanSection";
import { PLAN_LIVE_FOOTER, PLAN_LIVE_STATUS } from "./planArm";
import { RunSurface } from "./RunSurface";
import { RunStatusBar } from "./RunStatusBar";
import type { ActivityRecord, DecisionRequest, PlanRecord, RunProjectionRun, RunSnapshot } from "./runReducer";

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

function diffDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "diff-1",
    invocationId: "i1",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "a.txt",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

test("hierarchy: Plan before File changes before Verify before Activity", () => {
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
  const files = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  const verify = screen.getByRole("region", { name: VERIFY_HEADER });
  const activity = screen.getByLabelText("Activity");
  assert.ok(plan.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(files.compareDocumentPosition(verify) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(verify.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("live Planning chrome only when executionPhase === plan", () => {
  const { rerender } = render(
    <RunStatusBar
      busy
      permissionPending={false}
      diffCount={0}
      planning
    />,
  );
  assert.ok(screen.getByText(PLAN_LIVE_STATUS));
  assert.ok(screen.getByText(PLAN_LIVE_FOOTER));
  rerender(
    <RunStatusBar
      busy
      permissionPending={false}
      diffCount={0}
      planning={false}
    />,
  );
  assert.equal(screen.queryByText(PLAN_LIVE_STATUS), null);
  assert.equal(screen.queryByText(PLAN_LIVE_FOOTER), null);
});

test("non-empty plan_pending: Review plan + Accept plan + Keep planning; no Reject", () => {
  render(
    <ActionDock
      permissions={[]}
      diffQueue={[]}
      activeDiffId={null}
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
      planDecision={{ empty: false }}
      onPlanAccept={() => undefined}
      onPlanKeepPlanning={() => undefined}
    />,
  );
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByText(PLAN_DOCK_REVIEW));
  assert.ok(within(dock).getByRole("button", { name: PLAN_ACCEPT }));
  assert.ok(within(dock).getByRole("button", { name: PLAN_KEEP }));
  assert.equal(within(dock).queryByRole("button", { name: "Reject" }), null);
  assert.equal(within(dock).queryByRole("button", { name: /reject/i }), null);
});

test("empty plan_pending: Plan complete · no changes + End Plan · no changes proposed + Keep planning", () => {
  render(
    <ActionDock
      permissions={[]}
      diffQueue={[]}
      activeDiffId={null}
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
      planDecision={{ empty: true }}
    />,
  );
  assert.ok(screen.getByText(PLAN_DOCK_EMPTY));
  assert.ok(screen.getByRole("button", { name: PLAN_END_EMPTY }));
  assert.ok(screen.getByRole("button", { name: PLAN_KEEP }));
  assert.equal(screen.queryByText(PLAN_DOCK_REVIEW), null);
  assert.equal(screen.queryByRole("button", { name: PLAN_ACCEPT }), null);
  assert.equal(screen.queryByRole("button", { name: /reject/i }), null);
});

test("settling shows Updating plan decision…", () => {
  render(
    <ActionDock
      permissions={[]}
      diffQueue={[]}
      activeDiffId={null}
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
      planDecision={{ empty: false, settling: true }}
    />,
  );
  assert.ok(screen.getByText(PLAN_SETTLING));
  assert.equal(screen.getByRole("button", { name: PLAN_ACCEPT }).hasAttribute("disabled"), true);
});

test("A/R shortcuts remain owned by Pending file edits when both present", () => {
  render(
    <ActionDock
      permissions={[]}
      diffQueue={[{ id: "diff-1", path: "a.txt", diff: "+A" }]}
      activeDiffId="diff-1"
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
      planDecision={{ empty: false }}
    />,
  );
  assert.ok(screen.getByRole("button", { name: "Accept" }));
  assert.ok(screen.getByRole("button", { name: "Reject" }));
  assert.ok(screen.getByRole("button", { name: PLAN_ACCEPT }));
  assert.ok(screen.getByRole("button", { name: PLAN_KEEP }));
  assert.equal(screen.queryByRole("button", { name: "Reject plan" }), null);
});

test("planning-only run has Plan section and no File changes / Verify members", () => {
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
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);
  assert.equal(screen.queryByRole("button", { name: "Reject" }), null);
});
