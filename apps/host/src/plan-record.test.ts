import test from "node:test";
import assert from "node:assert/strict";
import type {
  DecisionKind,
  DecisionRequest,
  ExecutionPhase,
  PlanRecord,
  RunEventPayload,
  RunSnapshot,
} from "./run-types.js";

test("plan-mode additive type shapes are exportable", () => {
  const phase: ExecutionPhase = "plan";
  const snap = { executionPhase: phase } as Pick<RunSnapshot, "executionPhase">;
  assert.equal(snap.executionPhase, "plan");
  const kind: DecisionKind = "plan";
  const req = {
    kind,
    status: "pending",
    expiresAt: null,
  } as Pick<DecisionRequest, "kind" | "status" | "expiresAt">;
  assert.equal(req.expiresAt, null);
  const plan: Pick<PlanRecord, "status" | "proposedMembers" | "executionPhase"> = {
    status: "ready",
    proposedMembers: [],
    executionPhase: "plan",
  };
  assert.equal(plan.proposedMembers.length, 0);
  const payload: Extract<RunEventPayload, { kind: "plan_record" }> = {
    kind: "plan_record",
    plan: {
      runId: "r",
      sessionId: "s",
      connectionGeneration: 1,
      status: "exploring",
      body: null,
      proposedMembers: [],
      policy: {
        workspace: "",
        storedMode: null,
        effectiveMode: "review",
        source: "fallback",
        revision: "fallback",
        fallbackReason: "missing",
        snapshottedAt: new Date().toISOString(),
      },
      executionPhase: "plan",
    },
  };
  assert.equal(payload.kind, "plan_record");
});

import { derivePlanProposedMembers, bodyNamesIntendedChanges, isVendorPlanExitTool, planBodyFromVendorExit, planReadyIsEmpty, planDecisionTitle } from "./plan-record.js";

test("derive multi-path members from markdown bullets", () => {
  const body = `- Update \`src/a.ts\` to export helper\n- Create apps/shell/src/b.tsx for UI`;
  const members = derivePlanProposedMembers(body);
  assert.equal(members.length, 2);
  assert.equal(members[0]!.path, "src/a.ts");
  assert.equal(members[1]!.path, "apps/shell/src/b.tsx");
});

test("honest empty: commentary without paths → zero members", () => {
  assert.deepEqual(derivePlanProposedMembers("Nothing to change in this workspace."), []);
  assert.equal(bodyNamesIntendedChanges("Nothing to change in this workspace."), false);
});

test("body names changes without extractable paths → incomplete, not empty", () => {
  assert.equal(bodyNamesIntendedChanges("I will edit three modules and rewrite the router."), true);
  assert.equal(derivePlanProposedMembers("I will edit three modules and rewrite the router.").length, 0);
});

test("singleton path still yields one member", () => {
  assert.equal(derivePlanProposedMembers("Update `only.ts`.").length, 1);
});

test("vendor TUI exit plan mode is the plan-dock trigger", () => {
  assert.equal(isVendorPlanExitTool("exit_plan_mode"), true);
  assert.equal(isVendorPlanExitTool("exit plan mode"), true);
  assert.equal(isVendorPlanExitTool("enter_plan_mode"), false);
  assert.equal(isVendorPlanExitTool("run_terminal_command"), false);
});

test("vendor exit body prefers planContent / plan.md over early narration", () => {
  const plan = "- Update `src/a.ts`\n- Create apps/shell/src/b.tsx";
  assert.equal(planBodyFromVendorExit("Plan: Exit", plan), plan);
  assert.equal(planBodyFromVendorExit("Plan: Exit", "  "), null);
  assert.equal(planBodyFromVendorExit("exit", ""), null);
  assert.equal(planBodyFromVendorExit("- Update `only.ts`.", ""), "- Update `only.ts`.");
  assert.equal(
    planBodyFromVendorExit(plan, "I'll inspect apps/shell TypeScript config."),
    plan,
  );
  assert.equal(
    planBodyFromVendorExit("Plan: Exit", "I'll inspect apps/shell.", plan),
    plan,
  );
});

test("a three-step plan is Review plan even with no file members", () => {
  const body = "Three-step plan for apps/shell typecheck.\n\n1. Set-Location apps/shell\n2. npx tsc --noEmit\n3. Read the result.";
  assert.equal(planReadyIsEmpty(body, 0), false);
  assert.equal(planDecisionTitle([], body), "Review plan");
  assert.equal(planReadyIsEmpty("Nothing to change in this workspace.", 0), true);
  assert.equal(planDecisionTitle([], "Nothing to change in this workspace."), "Plan complete · no changes");
  assert.equal(planReadyIsEmpty(null, 0), true);
  assert.equal(planReadyIsEmpty(body, 1), false);
});

test("empty Plan: Exit is not a zero-member ready body", () => {
  assert.equal(planBodyFromVendorExit("Plan: Exit", null), null);
  assert.equal(planBodyFromVendorExit("Plan: Exit", undefined), null);
});
