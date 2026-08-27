export type ChildAgentStatus = "running" | "done" | "failed";

export type ChildAgentMember = {
  childId: string;
  identityLabel: string;
  status: ChildAgentStatus;
  firstEventSeq: number;
};

export type ChildAgentsMembershipDisposition =
  | "absent_non_code_or_non_vendor"
  | "hydrating"
  | "ready"
  | "obtain_failed";

export type ChildAgentsMembershipFact = {
  disposition: ChildAgentsMembershipDisposition;
  members: ChildAgentMember[] | null;
};

export const ABSENT_NON_CODE_OR_NON_VENDOR: ChildAgentsMembershipFact = {
  disposition: "absent_non_code_or_non_vendor",
  members: null,
};

export function enterHydrating(prior: ChildAgentsMembershipFact): ChildAgentsMembershipFact {
  if (prior.disposition === "ready" && prior.members) {
    return { disposition: "hydrating", members: prior.members.slice() };
  }
  return { disposition: "hydrating", members: null };
}

export function markReady(
  _prior: ChildAgentsMembershipFact,
  members: ChildAgentMember[],
): ChildAgentsMembershipFact {
  return { disposition: "ready", members: members.slice() };
}

export function markObtainFailed(_prior: ChildAgentsMembershipFact): ChildAgentsMembershipFact {
  return { disposition: "obtain_failed", members: null };
}

export function clearToAbsent(_prior: ChildAgentsMembershipFact): ChildAgentsMembershipFact {
  return ABSENT_NON_CODE_OR_NON_VENDOR;
}

export function parseCompleteChildAgentFrame(raw: unknown): {
  childId: string;
  identityLabel: string;
  status: ChildAgentStatus;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const childId = o.childId;
  const identityLabel = o.identityLabel;
  const status = o.status;
  if (typeof childId !== "string" || !childId) return null;
  if (typeof identityLabel !== "string" || !identityLabel.trim()) return null;
  if (status !== "running" && status !== "done" && status !== "failed") return null;
  return { childId, identityLabel, status };
}

export function applyChildUpdate(
  prior: ChildAgentMember[],
  update: { childId: string; identityLabel: string; status: ChildAgentStatus; eventSeq: number },
): ChildAgentMember[] {
  const idx = prior.findIndex((m) => m.childId === update.childId);
  if (idx < 0) {
    const next = [
      ...prior,
      {
        childId: update.childId,
        identityLabel: update.identityLabel,
        status: update.status,
        firstEventSeq: update.eventSeq,
      },
    ];
    return next.sort((a, b) => a.firstEventSeq - b.firstEventSeq);
  }
  const copy = prior.slice();
  const prev = copy[idx]!;
  copy[idx] = {
    ...prev,
    identityLabel: update.identityLabel,
    status: update.status,
  };
  return copy.sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

export function foldMembersFromUpdates(
  updates: Array<{ childId: string; identityLabel: string; status: ChildAgentStatus; eventSeq: number }>,
): ChildAgentMember[] {
  let members: ChildAgentMember[] = [];
  for (const u of updates) members = applyChildUpdate(members, u);
  return members;
}
