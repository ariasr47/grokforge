import type {
  ChildAgentMember,
  ChildAgentStatus,
  ChildAgentsMembershipFact,
  CodeAgentFact,
} from "./api";

export const CHILD_AGENTS_HEADER = "Child agents";
export const CHILD_AGENTS_LOADING = "Loading child agents…";
export const CHILD_AGENTS_FAILED = "Couldn't load child agents.";
export const CHILD_AGENTS_OFFLINE =
  "Forge is offline. Child agents recorded on this run so far are still shown. Reconnect to confirm later updates.";
export const CHILD_AGENTS_RECONNECT_SHORT = "Reconnect to confirm child agent status.";
export const CHILD_AGENTS_LIVE_GROWING = "Updating as children appear…";
export const CHILD_AGENTS_HELPER =
  "Children spawned by Grok Code on this run — not Forge workers.";
export const CHILD_AGENTS_AVAILABLE_ANNOUNCE = "Child agents available";
export const CHILD_AGENTS_STATUS_RUNNING = "Running";
export const CHILD_AGENTS_STATUS_DONE = "Done";
export const CHILD_AGENTS_STATUS_FAILED = "Failed";
export const CHILD_AGENTS_TOOLTIP_RUNNING =
  "Vendor child agent is still working. Permissions still settle in the action dock.";
export const CHILD_AGENTS_TOOLTIP_DONE = "Vendor child agent finished.";
export const CHILD_AGENTS_TOOLTIP_FAILED = "Vendor child agent failed.";

export type ChildAgentsRow = {
  childId: string;
  identityLabel: string;
  /** Journal history status. */
  status: ChildAgentStatus;
  /** Paint live Running chip only when true. */
  showLiveRunningChip: boolean;
  firstEventSeq: number;
};

export type ChildAgentsProjection =
  | { state: "absent" }
  | { state: "loading"; members: ChildAgentsRow[] | null; reconnectCopy: string | null }
  | { state: "error"; message: string }
  | {
      state: "ready";
      members: ChildAgentsRow[];
      runningCount: number;
      doneCount: number;
      failedCount: number;
      liveGrowing: boolean;
      offlineCopy: string | null;
      reconnectCopy: string | null;
    };

const ABSENT: ChildAgentsProjection = { state: "absent" };

function isClosedStatus(value: unknown): value is ChildAgentStatus {
  return value === "running" || value === "done" || value === "failed";
}

export function isCompleteChildAgentMember(raw: unknown): raw is ChildAgentMember {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Partial<ChildAgentMember>;
  if (typeof o.childId !== "string" || !o.childId) return false;
  if (typeof o.identityLabel !== "string" || !o.identityLabel.trim()) return false;
  if (!isClosedStatus(o.status)) return false;
  if (typeof o.firstEventSeq !== "number" || !Number.isFinite(o.firstEventSeq)) return false;
  return true;
}

function sortByFirstEventSeq(members: ChildAgentMember[]): ChildAgentMember[] {
  return members.slice().sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

function completeList(list: ChildAgentMember[] | null | undefined): ChildAgentMember[] {
  return (list ?? []).filter(isCompleteChildAgentMember);
}

/**
 * Journal is member authority when ready. Host members fill catch-up when
 * the journal fold is still empty. Ready + both empty is quiet absent.
 */
function sourceMembers(
  fact: ChildAgentsMembershipFact,
  journalMembers: ChildAgentMember[] | null | undefined,
): ChildAgentMember[] | null {
  const journal = sortByFirstEventSeq(completeList(journalMembers));
  const host = sortByFirstEventSeq(completeList(fact.members));
  if (fact.disposition === "hydrating") {
    if (journal.length > 0) return journal;
    if (host.length > 0) return host;
    return fact.members == null ? null : [];
  }
  if (fact.disposition === "ready") {
    if (journal.length > 0) return journal;
    if (host.length > 0) return host;
    return [];
  }
  return null;
}

function hasCurrentVoucher(input: {
  connected: boolean;
  parentTerminal: boolean;
  ownershipLost?: boolean;
}): boolean {
  return input.connected && !input.parentTerminal && !input.ownershipLost;
}

function currencyCopy(input: {
  connected: boolean;
  parentTerminal: boolean;
  ownershipLost?: boolean;
}): { offlineCopy: string | null; reconnectCopy: string | null } {
  if (!input.connected) {
    return { offlineCopy: CHILD_AGENTS_OFFLINE, reconnectCopy: null };
  }
  if (input.parentTerminal || input.ownershipLost) {
    return { offlineCopy: null, reconnectCopy: CHILD_AGENTS_RECONNECT_SHORT };
  }
  return { offlineCopy: null, reconnectCopy: null };
}

function mapRows(members: ChildAgentMember[], voucher: boolean): ChildAgentsRow[] {
  return members.map((m) => ({
    childId: m.childId,
    identityLabel: m.identityLabel,
    status: m.status,
    showLiveRunningChip: m.status === "running" && voucher,
    firstEventSeq: m.firstEventSeq,
  }));
}

function counts(rows: ChildAgentsRow[]): {
  runningCount: number;
  doneCount: number;
  failedCount: number;
} {
  let runningCount = 0;
  let doneCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    if (row.showLiveRunningChip) runningCount += 1;
    if (row.status === "done") doneCount += 1;
    if (row.status === "failed") failedCount += 1;
  }
  return { runningCount, doneCount, failedCount };
}

export function projectChildAgents(input: {
  mode?: string | null;
  codeAgent?: { identity?: string | null } | CodeAgentFact | null;
  childAgents?: ChildAgentsMembershipFact | null;
  journalMembers?: ChildAgentMember[] | null;
  connected: boolean;
  parentTerminal: boolean;
  ownershipLost?: boolean;
  runNonTerminal: boolean;
}): ChildAgentsProjection {
  if (input.mode !== "code" || input.codeAgent?.identity !== "vendor") return ABSENT;
  const fact = input.childAgents;
  if (!fact) return ABSENT;
  if (fact.disposition === "absent_non_code_or_non_vendor") return ABSENT;
  if (fact.disposition === "obtain_failed") {
    return { state: "error", message: CHILD_AGENTS_FAILED };
  }

  const voucher = hasCurrentVoucher(input);
  const copy = currencyCopy(input);
  const members = sourceMembers(fact, input.journalMembers);

  if (fact.disposition === "hydrating") {
    return {
      state: "loading",
      members: members == null ? null : mapRows(members, voucher),
      reconnectCopy: copy.offlineCopy ?? copy.reconnectCopy,
    };
  }

  if (fact.disposition !== "ready") return ABSENT;
  if (!members || members.length === 0) return ABSENT;

  const rows = mapRows(members, voucher);
  return {
    state: "ready",
    members: rows,
    ...counts(rows),
    liveGrowing: Boolean(input.runNonTerminal && voucher),
    offlineCopy: copy.offlineCopy,
    reconnectCopy: copy.reconnectCopy,
  };
}
