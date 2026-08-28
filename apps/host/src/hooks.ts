export type HookStatus = "running" | "idle" | "done" | "failed";

export type HookMember = {
  hookId: string;
  name: string | null;
  status: HookStatus | null;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

export type HooksMembershipDisposition =
  | "absent_for_non_code_or_non_vendor"
  | "hydrating"
  | "ready"
  | "obtain_failed";

export type HooksMembershipFact = {
  disposition: HooksMembershipDisposition;
  members: HookMember[] | null;
};

export const ABSENT_FOR_NON_CODE_OR_NON_VENDOR: HooksMembershipFact = {
  disposition: "absent_for_non_code_or_non_vendor",
  members: null,
};

export function enterHydrating(prior: HooksMembershipFact): HooksMembershipFact {
  if (prior.disposition === "ready" && prior.members) {
    return { disposition: "hydrating", members: prior.members.slice() };
  }
  return { disposition: "hydrating", members: null };
}

export function markReady(
  _prior: HooksMembershipFact,
  members: HookMember[],
): HooksMembershipFact {
  return { disposition: "ready", members: members.slice() };
}

/** PM keep-visible: retain last-ready/hydrating members under obtain_failed. */
export function markObtainFailed(prior: HooksMembershipFact): HooksMembershipFact {
  const keep =
    (prior.disposition === "ready" || prior.disposition === "hydrating") && prior.members
      ? prior.members.slice()
      : null;
  return { disposition: "obtain_failed", members: keep };
}

export function clearToAbsent(_prior: HooksMembershipFact): HooksMembershipFact {
  return ABSENT_FOR_NON_CODE_OR_NON_VENDOR;
}

export type HookUpdateInput = {
  hookId: string;
  name: string | null;
  status: HookStatus | null;
  eventSeq: number;
  unrestorable?: boolean;
};

export function parseCompleteHookFrame(raw: unknown): {
  hookId: string;
  name: string | null;
  status: HookStatus;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const hookId = o.hookId;
  if (typeof hookId !== "string" || !hookId) return null;
  const status = o.status;
  if (
    status !== "running" &&
    status !== "idle" &&
    status !== "done" &&
    status !== "failed"
  ) {
    return null;
  }
  const name = o.name == null ? null : typeof o.name === "string" ? o.name : null;
  return { hookId, name, status };
}

export function memberFromUpdate(input: HookUpdateInput): HookMember | null {
  if (!input.hookId) return null;
  if (input.unrestorable) {
    return {
      hookId: input.hookId,
      name: null,
      status: null,
      restore: "unrestorable",
      firstEventSeq: input.eventSeq,
    };
  }
  if (
    input.status !== "running" &&
    input.status !== "idle" &&
    input.status !== "done" &&
    input.status !== "failed"
  ) {
    return null;
  }
  return {
    hookId: input.hookId,
    name: input.name,
    status: input.status,
    restore: "restored",
    firstEventSeq: input.eventSeq,
  };
}

export function applyHookMember(prior: HookMember[], update: HookMember): HookMember[] {
  const idx = prior.findIndex((m) => m.hookId === update.hookId);
  if (idx < 0) {
    return [...prior, update].sort((a, b) => a.firstEventSeq - b.firstEventSeq);
  }
  const copy = prior.slice();
  const prev = copy[idx]!;
  copy[idx] = {
    ...prev,
    name: update.restore === "unrestorable" ? null : update.name,
    status: update.restore === "unrestorable" ? null : update.status,
    restore: update.restore,
  };
  return copy.sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

export function foldMembersFromUpdates(inputs: HookUpdateInput[]): HookMember[] {
  let members: HookMember[] = [];
  for (const input of inputs) {
    const m = memberFromUpdate(input);
    if (!m) continue;
    members = applyHookMember(members, m);
  }
  return members;
}
