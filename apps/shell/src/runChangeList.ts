import type { PendingDiff } from "./DiffPanel";
import type { PermissionReq } from "./PermissionCard";
import type { ActivityRecord, DecisionRequest, MutationKind, RunProjectionRun } from "./runReducer";
export type { MutationKind };

export type PermissionTitle = "Run shell" | "Write file";

export function permissionChromeFromTitle(title: string): {
  kind: "shell" | "write";
  question: string;
  rail: string;
} | null {
  if (title === "Run shell") {
    return { kind: "shell", question: "Allow running a command?", rail: "Permission requested: shell" };
  }
  if (title === "Write file") {
    return { kind: "write", question: "Allow saving a file?", rail: "Permission requested: write" };
  }
  return null;
}

function isLiveEnvelopeDecision(run: RunProjectionRun, d: DecisionRequest): boolean {
  if (d.status !== "pending") return false;
  if (d.kind === "plan" || d.kind === "recovery_confirmation") return true;
  if (run.state === "terminal") return false;
  return d.kind === "permission" || d.kind === "diff";
}

export function pendingPermissionsFromRun(run: RunProjectionRun): PermissionReq[] {
  const out: PermissionReq[] = [];
  for (const d of Object.values(run.decisions)) {
    if (d.kind !== "permission" || d.status !== "pending") continue;
    if (run.state === "terminal") continue;
    const chrome = permissionChromeFromTitle(d.title);
    if (!chrome) continue; // out of contract for card chrome; still counted by hasDockOwnedPending
    out.push({
      id: d.requestId,
      kind: chrome.kind,
      detail: d.detail, // pass-through as-is — do not parse
      sessionId: run.sessionId,
      runId: run.runId,
      invocationId: d.invocationId,
    });
  }
  return out;
}

export function mergePendingPermissions(prev: PermissionReq[], run: RunProjectionRun): PermissionReq[] {
  const rebuilt = pendingPermissionsFromRun(run);
  const durableIds = new Set(rebuilt.map((p) => p.id));
  const pendingIds = new Set(
    Object.values(run.decisions)
      .filter((d) => d.kind === "permission" && d.status === "pending" && run.state !== "terminal")
      .map((d) => d.requestId),
  );
  const kept = prev.filter((p) => pendingIds.has(p.id) && !durableIds.has(p.id));
  return [...rebuilt, ...kept];
}

export function hasDockOwnedPending(run: RunProjectionRun): boolean {
  return Object.values(run.decisions).some((d) => isLiveEnvelopeDecision(run, d));
}

export type RailEvidence = { identity: string; content: string };

export function railEvidenceFromRun(run: RunProjectionRun): RailEvidence[] {
  const out: RailEvidence[] = [];
  for (const d of Object.values(run.decisions)) {
    if (d.status !== "pending") continue;
    if (d.kind === "permission") {
      const chrome = permissionChromeFromTitle(d.title);
      if (chrome) out.push({ identity: `permission:${d.requestId}`, content: chrome.rail });
      continue;
    }
    if (d.kind === "diff") {
      const activity = Object.values(run.activities).find(
        (a) => a.editId && (a.invocationId === d.invocationId || a.editId === d.requestId),
      );
      const path = activity?.kind === "rename"
        ? nonemptyRelPath(activity.fromPath) ?? nonemptyRelPath(activity.path) ?? (d.detail || null)
        : nonemptyRelPath(activity?.path) ?? (d.detail || null);
      if (path) out.push({ identity: `diff:${d.requestId}`, content: `Diff proposed: ${path}` });
    }
  }
  return out;
}

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
  kind: MutationKind;
  fromPath: string | null;
  toPath: string | null;
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

function nonemptyRelPath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Vouched kind only. Legacy content when kind is omitted; never invent delete/rename. */
function resolvedKind(activity: ActivityRecord): MutationKind | null {
  if (activity.kind === "delete" || activity.kind === "rename" || activity.kind === "content") {
    return activity.kind;
  }
  if (activity.editId && nonemptyRelPath(activity.path)) return "content";
  return null;
}

function isChangeListMember(
  activity: ActivityRecord,
  decisions: Record<string, DecisionRequest>,
): boolean {
  if (!activity.editId) return false;
  if (activity.automaticEligibility === "bypass") return false;
  const kind = resolvedKind(activity);
  if (kind == null) return false;
  if (kind === "rename") {
    if (!nonemptyRelPath(activity.fromPath) || !nonemptyRelPath(activity.toPath)) return false;
  } else if (!nonemptyRelPath(activity.path)) {
    return false;
  }
  const trusted = activity.autoApplied === true && activity.automaticEligibility === "text_edit";
  const review = Boolean(linkedDiffDecision(activity, decisions));
  return trusted || review;
}

function displayPathFor(
  kind: MutationKind,
  activity: ActivityRecord,
  settlement: ChangeMemberSettlement,
): string {
  if (kind === "rename") {
    if (settlement === "pending" || settlement === "rejected") {
      return nonemptyRelPath(activity.fromPath) ?? nonemptyRelPath(activity.path) ?? "";
    }
    return nonemptyRelPath(activity.toPath) ?? nonemptyRelPath(activity.path) ?? "";
  }
  return nonemptyRelPath(activity.path) ?? "";
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
    const kind = resolvedKind(activity)!;
    const { settlement, recoveryAvailable, requestId } = settlementFor(activity, run.decisions);
    const diff = typeof activity.diff === "string" && activity.diff.length > 0 ? activity.diff : null;
    const member: RunChangeMember = {
      editId,
      path: displayPathFor(kind, activity, settlement),
      kind,
      fromPath: kind === "rename" ? nonemptyRelPath(activity.fromPath) : null,
      toPath: kind === "rename" ? nonemptyRelPath(activity.toPath) : null,
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
    if (run.state === "terminal") continue;
    const activity = Object.values(run.activities).find(
      (a) => a.editId && (a.invocationId === d.invocationId || a.editId === d.requestId),
    );
    if (!activity) continue;
    const path = activity.kind === "rename"
      ? nonemptyRelPath(activity.fromPath) ?? nonemptyRelPath(activity.path)
      : nonemptyRelPath(activity.path);
    if (!path) continue;
    out.push({
      id: d.requestId,
      path,
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
      .filter((d) => d.kind === "diff" && d.status === "pending" && run.state !== "terminal")
      .map((d) => d.requestId),
  );
  const kept = prev.filter((d) => pendingIds.has(d.id) && !durableIds.has(d.id));
  return [...rebuilt, ...kept];
}
