export type McpServerStatus = "connected" | "idle" | "error";

export type McpServerMember = {
  serverId: string;
  name: string | null;
  status: McpServerStatus | null;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

export type McpServersMembershipDisposition =
  | "absent_for_non_code_or_non_vendor"
  | "hydrating"
  | "ready"
  | "obtain_failed";

export type McpServersMembershipFact = {
  disposition: McpServersMembershipDisposition;
  members: McpServerMember[] | null;
};

export const ABSENT_FOR_NON_CODE_OR_NON_VENDOR: McpServersMembershipFact = {
  disposition: "absent_for_non_code_or_non_vendor",
  members: null,
};

export function enterHydrating(prior: McpServersMembershipFact): McpServersMembershipFact {
  if (prior.disposition === "ready" && prior.members) {
    return { disposition: "hydrating", members: prior.members.slice() };
  }
  return { disposition: "hydrating", members: null };
}

export function markReady(
  _prior: McpServersMembershipFact,
  members: McpServerMember[],
): McpServersMembershipFact {
  return { disposition: "ready", members: members.slice() };
}

/** PM keep-visible: retain last-ready/hydrating members under obtain_failed. */
export function markObtainFailed(prior: McpServersMembershipFact): McpServersMembershipFact {
  const keep =
    (prior.disposition === "ready" || prior.disposition === "hydrating") && prior.members
      ? prior.members.slice()
      : null;
  return { disposition: "obtain_failed", members: keep };
}

export function clearToAbsent(_prior: McpServersMembershipFact): McpServersMembershipFact {
  return ABSENT_FOR_NON_CODE_OR_NON_VENDOR;
}

export type McpUpdateInput = {
  serverId: string;
  name: string | null;
  status: McpServerStatus | null;
  eventSeq: number;
  unrestorable?: boolean;
};

export function parseCompleteMcpFrame(raw: unknown): {
  serverId: string;
  name: string | null;
  status: McpServerStatus;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const serverId = o.serverId;
  if (typeof serverId !== "string" || !serverId) return null;
  const status = o.status;
  if (status !== "connected" && status !== "idle" && status !== "error") return null;
  const name = o.name == null ? null : typeof o.name === "string" ? o.name : null;
  return { serverId, name, status };
}

export function memberFromUpdate(input: McpUpdateInput): McpServerMember | null {
  if (!input.serverId) return null;
  if (input.unrestorable) {
    return {
      serverId: input.serverId,
      name: null,
      status: null,
      restore: "unrestorable",
      firstEventSeq: input.eventSeq,
    };
  }
  if (input.status !== "connected" && input.status !== "idle" && input.status !== "error") {
    return null;
  }
  return {
    serverId: input.serverId,
    name: input.name,
    status: input.status,
    restore: "restored",
    firstEventSeq: input.eventSeq,
  };
}

export function applyMcpMember(prior: McpServerMember[], update: McpServerMember): McpServerMember[] {
  const idx = prior.findIndex((m) => m.serverId === update.serverId);
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

export function foldMembersFromUpdates(inputs: McpUpdateInput[]): McpServerMember[] {
  let members: McpServerMember[] = [];
  for (const input of inputs) {
    const m = memberFromUpdate(input);
    if (!m) continue;
    members = applyMcpMember(members, m);
  }
  return members;
}
