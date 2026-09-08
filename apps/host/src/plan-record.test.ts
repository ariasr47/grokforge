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

test("a test run and a do-not-edit path are not WOULD CHANGE members", () => {
  const body = [
    "1. Use write_file to insert `// G10-PLAN` as the first line of docs/dogfood/acp-code/g1-fold/g9-other.txt (first mutation).",
    "2. Run `node --test docs/dogfood/acp-code/g1-fold/fold.test.js` via the host shell.",
    "3. Confirm no edits were made to docs/dogfood/ACP-A3.md and stop.",
  ].join("\n");
  const members = derivePlanProposedMembers(body);
  assert.deepEqual(
    members.map((m) => m.path),
    ["docs/dogfood/acp-code/g1-fold/g9-other.txt"],
    "live G10 listed fold.test.js and ACP-A3.md as WOULD CHANGE",
  );
  const parenthetical = [
    "1. Edit `docs/dogfood/acp-code/g1-fold/g9-other.txt` (write // G10-PLAN as first line only; never touch ACP-A3.md).",
    "2. Execute `node --test docs/dogfood/acp-code/g1-fold/fold.test.js` (verification only).",
    "3. Report outcome; await explicit \"Accept plan\" before any further action.",
  ].join("\n");
  assert.deepEqual(
    derivePlanProposedMembers(parenthetical).map((m) => m.path),
    ["docs/dogfood/acp-code/g1-fold/g9-other.txt"],
    "never-touch ACP-A3.md on an edit line is not WOULD CHANGE",
  );
  const leaveUntouched = [
    "1. Use write_file (or apply_patch) on docs/dogfood/acp-code/g1-fold/g9-other.txt to insert `// G10-PLAN` as the absolute first line.",
    "2. Execute `node --test docs/dogfood/acp-code/g1-fold/fold.test.js` via run_shell (after the file edit).",
    "3. Leave docs/dogfood/ACP-A3.md untouched (no read/write/rename/delete on it).",
  ].join("\n");
  assert.deepEqual(
    derivePlanProposedMembers(leaveUntouched).map((m) => m.path),
    ["docs/dogfood/acp-code/g1-fold/g9-other.txt"],
    "node --test after the file edit and leave-untouched are not WOULD CHANGE",
  );
});

test("code-fence identifiers and import basenames are not WOULD CHANGE", () => {
  const body = `**Plan (do not execute):**

1. Create \`docs/dogfood/acp-code/g1-fold/g11-clamp.js\` (new file) containing:
   \`\`\`js
   export function clamp(n, lo, hi) {
     return Math.min(Math.max(n, lo), hi);
   }
   \`\`\`

2. Create \`docs/dogfood/acp-code/g1-fold/g11-clamp.test.js\` (new file) containing a \`node:test\` suite with exactly the two required assertions:
   \`\`\`js
   import test from 'node:test';
   import assert from 'node:assert/strict';
   import { clamp } from './g11-clamp.js';

   test('clamp returns value inside range', () => {
     assert.strictEqual(clamp(5, 0, 10), 5);
     assert.strictEqual(clamp(-1, 0, 10), 0);
   });
   \`\`\`

3. After both files are confirmed to exist on disk, execute \`node --test docs/dogfood/acp-code/g1-fold/g11-clamp.test.js\` (and nothing else).

No other files (including \`docs/dogfood/ACP-A3.md\`) will be read or modified at any point.`;
  const paths = derivePlanProposedMembers(body).map((m) => m.path);
  assert.deepEqual(
    paths,
    [
      "docs/dogfood/acp-code/g1-fold/g11-clamp.js",
      "docs/dogfood/acp-code/g1-fold/g11-clamp.test.js",
    ],
    "live G11 listed Math.min, Math.max, and import g11-clamp.js as WOULD CHANGE (5 files)",
  );
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
