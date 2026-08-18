import type { CatchUpSignal } from "./runChangeList";
import type {
  PlanProposedMember,
  PlanRecord,
  RunProjectionRun,
} from "./runReducer";

export type PlanSectionProjection =
  | { state: "absent" }
  | { state: "loading" }
  | { state: "exploring" }
  | {
      state: "ready";
      proposedMembers: PlanProposedMember[];
      body: string | null;
      decisionPending: boolean;
      empty: boolean;
    }
  | { state: "accepted"; policyLabel: string; bypassActive: boolean }
  | { state: "kept_planning" }
  | { state: "cancelled" }
  | { state: "failed" }
  | { state: "superseded" }
  | { state: "error"; message: string }
  | { state: "offline" };

export const PLAN_HEADER = "Plan";
export const PLAN_EXPLORING = "Exploring the workspace… Edits are not applied in Plan.";
export const PLAN_RESTORING = "Restoring this run’s plan…";
export const PLAN_READY_HELPER = "Accept or keep planning in the action dock.";
export const PLAN_CHIP_PROPOSED = "Proposed";
export const PLAN_CHIP_WOULD_CHANGE = "Would change";
export const PLAN_EMPTY = "No changes proposed.";
export const PLAN_ACCEPTED_TITLE = "Plan accepted";
export const PLAN_KEPT_TITLE = "Keeping plan open";
export const PLAN_KEPT_HELPER = "Proposed edits were not applied.";
export const PLAN_CANCELLED = "Planning cancelled";
export const PLAN_FAILED = "Planning didn’t finish";
export const PLAN_SUPERSEDED = "Superseded by a newer plan";
export const PLAN_LOAD_FAILURE =
  "Couldn’t load this run’s plan. Activity rows that already loaded stay available.";
export const PLAN_OFFLINE_SECTION =
  "Forge is offline. This run’s plan so far is still shown. Reconnect to confirm plan status.";
export const PLAN_READY_ANNOUNCE = "Plan ready to review";

export type PlanSectionOptions = {
  connected?: boolean;
  bypassActive?: boolean;
};

export function isLivePlanning(
  run: Pick<RunProjectionRun, "state" | "executionPhase">,
): boolean {
  return run.state !== "terminal" && run.executionPhase === "plan";
}

function policyLabelFrom(plan: PlanRecord): string {
  const mode = plan.policy?.effectiveMode;
  return mode === "trusted_workspace" ? "Trusted workspace" : "Review";
}

export function acceptedHelper(policyLabel: string, bypassActive: boolean): string {
  const base = `Plan accepted. Your next Code send continues under Policy: ${policyLabel}.`;
  return bypassActive ? `${base} Bypass permissions active` : base;
}

export function projectRunPlanSection(
  run: RunProjectionRun,
  catchUp: CatchUpSignal,
  opts: PlanSectionOptions = {},
): PlanSectionProjection {
  if (catchUp.phase === "open") return { state: "loading" };
  if (catchUp.phase === "failed") {
    return { state: "error", message: catchUp.message ?? PLAN_LOAD_FAILURE };
  }

  const plan = run.plan ?? null;
  const connected = opts.connected !== false;
  if (!connected && (plan || isLivePlanning(run))) {
    return { state: "offline" };
  }

  if (!plan) {
    if (isLivePlanning(run)) return { state: "exploring" };
    return { state: "absent" };
  }

  switch (plan.status) {
    case "exploring":
      return { state: "exploring" };
    case "ready": {
      const proposedMembers = plan.proposedMembers ?? [];
      return {
        state: "ready",
        proposedMembers,
        body: plan.body,
        decisionPending: Object.values(run.decisions).some(
          (d) => d.kind === "plan" && d.status === "pending",
        ),
        empty: proposedMembers.length === 0,
      };
    }
    case "accepted":
      return {
        state: "accepted",
        policyLabel: policyLabelFrom(plan),
        bypassActive: opts.bypassActive === true,
      };
    case "kept_planning":
      return { state: "kept_planning" };
    case "cancelled":
      return { state: "cancelled" };
    case "failed":
      return { state: "failed" };
    case "superseded":
      return { state: "superseded" };
    default:
      return { state: "absent" };
  }
}
