export type BrowserWorkChipStatus = "running" | "done" | "failed";

export type BrowserWorkMember = {
  toolCallId: string;
  acpToolKind: "fetch";
  url: string | null;
  title: string | null;
  status: BrowserWorkChipStatus | null;
  snapshotJournaled: boolean;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

export type BrowserWorkMembershipDisposition =
  | "absent_for_non_code_or_non_vendor"
  | "hydrating"
  | "ready"
  | "obtain_failed";

export type BrowserWorkMembershipFact = {
  disposition: BrowserWorkMembershipDisposition;
  members: BrowserWorkMember[] | null;
};

export const ABSENT_FOR_NON_CODE_OR_NON_VENDOR: BrowserWorkMembershipFact = {
  disposition: "absent_for_non_code_or_non_vendor",
  members: null,
};

export function enterHydrating(prior: BrowserWorkMembershipFact): BrowserWorkMembershipFact {
  if (prior.disposition === "ready" && prior.members) {
    return { disposition: "hydrating", members: prior.members.slice() };
  }
  return { disposition: "hydrating", members: null };
}

export function markReady(
  _prior: BrowserWorkMembershipFact,
  members: BrowserWorkMember[],
): BrowserWorkMembershipFact {
  return { disposition: "ready", members: members.slice() };
}

export function markObtainFailed(_prior: BrowserWorkMembershipFact): BrowserWorkMembershipFact {
  return { disposition: "obtain_failed", members: null };
}

export function clearToAbsent(_prior: BrowserWorkMembershipFact): BrowserWorkMembershipFact {
  return ABSENT_FOR_NON_CODE_OR_NON_VENDOR;
}

export function chipStatusFromActivity(
  status: "running" | "succeeded" | "failed" | "rejected",
): BrowserWorkChipStatus | null {
  if (status === "running") return "running";
  if (status === "succeeded") return "done";
  if (status === "failed") return "failed";
  return null; // rejected → withhold
}

export type FetchActivityInput = {
  toolCallId: string;
  acpToolKind: string | null;
  status: "running" | "succeeded" | "failed" | "rejected";
  execution: null | "executed" | "not_executed";
  title: string | null;
  url: string | null;
  snapshotJournaled: boolean;
  eventSeq: number;
  unrestorable?: boolean;
};

function isWithheldFetch(input: FetchActivityInput): boolean {
  return (
    Boolean(input.toolCallId) &&
    input.acpToolKind === "fetch" &&
    (input.execution === "not_executed" || input.status === "rejected")
  );
}

export function memberFromFetchActivity(input: FetchActivityInput): BrowserWorkMember | null {
  if (!input.toolCallId) return null;
  if (input.acpToolKind !== "fetch") return null;
  if (input.execution === "not_executed" || input.status === "rejected") return null;
  if (input.unrestorable) {
    return {
      toolCallId: input.toolCallId,
      acpToolKind: "fetch",
      url: null,
      title: null,
      status: null,
      snapshotJournaled: false,
      restore: "unrestorable",
      firstEventSeq: input.eventSeq,
    };
  }
  const chip = chipStatusFromActivity(input.status);
  if (!chip) return null;
  return {
    toolCallId: input.toolCallId,
    acpToolKind: "fetch",
    url: input.url,
    title: input.title,
    status: chip,
    snapshotJournaled: input.snapshotJournaled === true,
    restore: "restored",
    firstEventSeq: input.eventSeq,
  };
}

export function applyFetchMember(
  prior: BrowserWorkMember[],
  update: BrowserWorkMember,
): BrowserWorkMember[] {
  const idx = prior.findIndex((m) => m.toolCallId === update.toolCallId);
  if (idx < 0) {
    return [...prior, update].sort((a, b) => a.firstEventSeq - b.firstEventSeq);
  }
  const copy = prior.slice();
  const prev = copy[idx]!;
  copy[idx] = {
    ...prev,
    acpToolKind: "fetch",
    url: update.restore === "unrestorable" ? null : update.url ?? prev.url,
    title: update.restore === "unrestorable" ? null : update.title ?? prev.title,
    status: update.restore === "unrestorable" ? null : update.status ?? prev.status,
    snapshotJournaled:
      update.restore === "unrestorable" ? false : update.snapshotJournaled || prev.snapshotJournaled,
    restore: update.restore,
  };
  return copy.sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

export function foldMembersFromActivities(inputs: FetchActivityInput[]): BrowserWorkMember[] {
  let members: BrowserWorkMember[] = [];
  for (const input of inputs) {
    if (isWithheldFetch(input)) {
      members = members.filter((m) => m.toolCallId !== input.toolCallId);
      continue;
    }
    const m = memberFromFetchActivity(input);
    if (!m) continue;
    members = applyFetchMember(members, m);
  }
  return members;
}
