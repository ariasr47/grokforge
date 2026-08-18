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

import { derivePlanProposedMembers, bodyNamesIntendedChanges } from "./plan-record.js";

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
