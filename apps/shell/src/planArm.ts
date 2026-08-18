import type { PlanEngagementView, ProductMode } from "./api";

export type PlanArmProjection =
  | { state: "absent_chat" }
  | { state: "default"; engaged: false; vouched: true }
  | { state: "armed"; engaged: true; vouched: true }
  | { state: "disabled_no_workspace" }
  | { state: "disabled_busy_other" }
  | { state: "error"; message: string }
  | { state: "blocked_unvouched" }
  | { state: "offline" };

export type PlanArmInput = {
  mode?: ProductMode | string | null;
  workspace?: string | null;
  connected: boolean;
  planEngagement?: PlanEngagementView;
  busyOther?: boolean;
  armError?: string | null;
};

export const PLAN_ARM_HELPER_ARMED = "Explore and propose without applying edits.";
export const PLAN_ARM_BLOCKED_UNVOUCHED =
  "Can’t confirm Plan engagement. Send is blocked — not switched to ordinary Code.";
export const PLAN_ARM_OFFLINE = "Forge is offline. Reconnect before changing Plan.";
export const PLAN_ARM_FAILURE_PREFIX = "Couldn’t turn Plan on.";
export const PLAN_LIVE_STATUS = "Planning";
export const PLAN_LIVE_FOOTER = "Plan · no edits applied";

export function planArmFailureCopy(previous: string): string {
  return `Couldn’t turn Plan on. ${previous} remains active.`;
}

/**
 * Closed Plan arming machine. Missing `planEngagement` is unvouched — never
 * invented as `{ engaged: false, vouched: true }`. Offline wins over
 * blocked_unvouched when disconnected.
 */
export function projectPlanArm(input: PlanArmInput): PlanArmProjection {
  if (input.mode !== "code") return { state: "absent_chat" };
  if (!input.connected) return { state: "offline" };
  if (!input.planEngagement || input.planEngagement.vouched !== true) {
    return { state: "blocked_unvouched" };
  }
  if (input.armError) return { state: "error", message: input.armError };
  if (!input.workspace) return { state: "disabled_no_workspace" };
  if (input.busyOther) return { state: "disabled_busy_other" };
  if (input.planEngagement.engaged) {
    return { state: "armed", engaged: true, vouched: true };
  }
  return { state: "default", engaged: false, vouched: true };
}
