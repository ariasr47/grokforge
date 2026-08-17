import type { PendingDiff } from "./DiffPanel";
import type { ActivityRecord, DecisionRequest, RunProjectionRun } from "./runReducer";

export type ChangeMemberSettlement =
  | "pending"
  | "applied"
  | "accepted"
  | "rejected"
  | "reverted"
  | "conflict";

export type RunChangeMember = {
  editId: string;
  path: string;
  activityId: string;
  invocationId: string;
  requestId: string | null;
  diff: string | null;
  settlement: ChangeMemberSettlement;
  recoveryAvailable: boolean;
  diffUnavailable: boolean;
};

export type CatchUpSignal =
  | { phase: "open" }
  | { phase: "failed"; message?: string }
  | { phase: "closed" };

export type RunChangeListProjection =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "absent" }
  | { state: "ready"; members: [RunChangeMember, ...RunChangeMember[]] };

export const CATCHUP_LOAD_FAILURE =
  "Couldn’t load this run’s file changes. Activity rows and diffs that already loaded stay available.";

function linkedDiffDecision(
  activity: ActivityRecord,
  decisions: Record<string, DecisionRequest>,
  status?: DecisionRequest["status"],
): DecisionRequest | undefined {
  return Object.values(decisions).find(
    (d) =>
      d.kind === "diff" &&
      (status == null || d.status === status) &&
      (d.invocationId === activity.invocationId || d.requestId === activity.editId),
  );
}

function isChangeListMember(
  activity: ActivityRecord,
  decisions: Record<string, DecisionRequest>,
): boolean {
  if (!activity.editId || !activity.path) return false;
  if (activity.automaticEligibility === "bypass") return false;
  if (activity.autoApplied === true && activity.automaticEligibility === "text_edit") return true;
  return Boolean(linkedDiffDecision(activity, decisions));
}

function settlementFor(
  activity: ActivityRecord,
  decisions: Record<string, DecisionRequest>,
): { settlement: ChangeMemberSettlement; recoveryAvailable: boolean; requestId: string | null } {
  const rec = activity.recovery;
  if (rec?.status === "reverted") return { settlement: "reverted", recoveryAvailable: false, requestId: null };
  if (rec?.status === "conflict") return { settlement: "conflict", recoveryAvailable: false, requestId: null };
  const pending = linkedDiffDecision(activity, decisions, "pending");
  if (pending) return { settlement: "pending", recoveryAvailable: false, requestId: pending.requestId };
  const accepted = linkedDiffDecision(activity, decisions, "accepted");
  if (accepted) return { settlement: "accepted", recoveryAvailable: false, requestId: null };
  const rejected = linkedDiffDecision(activity, decisions, "declined");
  if (rejected) return { settlement: "rejected", recoveryAvailable: false, requestId: null };
  const recoveryAvailable = rec != null && rec.status === "available" && rec.available === true;
  return { settlement: "applied", recoveryAvailable, requestId: null };
}

export function projectRunChangeList(
  run: RunProjectionRun,
  catchUp: CatchUpSignal,
): RunChangeListProjection {
  if (catchUp.phase === "open") return { state: "loading" };
  if (catchUp.phase === "failed") {
    return { state: "error", message: catchUp.message ?? CATCHUP_LOAD_FAILURE };
  }
  const byEdit = new Map<string, RunChangeMember>();
  const order: string[] = [];
  for (const activity of Object.values(run.activities)) {
    if (!isChangeListMember(activity, run.decisions)) continue;
    const editId = activity.editId!;
    const { settlement, recoveryAvailable, requestId } = settlementFor(activity, run.decisions);
    const diff = typeof activity.diff === "string" && activity.diff.length > 0 ? activity.diff : null;
    const member: RunChangeMember = {
      editId,
      path: activity.path!,
      activityId: activity.activityId,
      invocationId: activity.invocationId,
      requestId,
      diff,
      settlement,
      recoveryAvailable,
      diffUnavailable: diff == null,
    };
    if (!byEdit.has(editId)) order.push(editId);
    byEdit.set(editId, member);
  }
  const members = order.map((id) => byEdit.get(id)!);
  if (members.length === 0) return { state: "absent" };
  return { state: "ready", members: members as [RunChangeMember, ...RunChangeMember[]] };
}

export function pendingDiffsFromRun(run: RunProjectionRun): PendingDiff[] {
  const out: PendingDiff[] = [];
  for (const d of Object.values(run.decisions)) {
    if (d.kind !== "diff" || d.status !== "pending") continue;
    const activity = Object.values(run.activities).find(
      (a) => a.editId && (a.invocationId === d.invocationId || a.editId === d.requestId),
    );
    if (!activity?.path) continue;
    out.push({
      id: d.requestId,
      path: activity.path,
      diff: activity.diff ?? "",
    });
  }
  return out;
}

export function mergePendingDiffs(prev: PendingDiff[], run: RunProjectionRun): PendingDiff[] {
  const rebuilt = pendingDiffsFromRun(run);
  const durableIds = new Set(rebuilt.map((d) => d.id));
  const pendingIds = new Set(
    Object.values(run.decisions)
      .filter((d) => d.kind === "diff" && d.status === "pending")
      .map((d) => d.requestId),
  );
  const kept = prev.filter((d) => pendingIds.has(d.id) && !durableIds.has(d.id));
  return [...rebuilt, ...kept];
}
