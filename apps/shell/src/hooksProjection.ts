import type {
  CodeAgentFact,
  HookMember,
  HookStatus,
  HooksMembershipFact,
} from "./api";

export const HOOKS_HEADER = "Hooks";
export const HOOKS_LOADING = "Loading hooks…";
export const HOOKS_FAILED = "Couldn't load hooks.";
export const HOOKS_OFFLINE =
  "Forge is offline. Hooks recorded on this session so far are still shown. Reconnect to confirm later updates.";
export const HOOKS_RECONNECT_SHORT = "Reconnect to confirm hooks status.";
export const HOOKS_LIVE_GROWING = "Updating as hooks appear…";
export const HOOKS_HELPER =
  "Hooks and plugins Grok Code advertised on this session — Forge chrome, not a Forge hooks engine.";
export const HOOKS_AVAILABLE_ANNOUNCE = "Hooks available";
export const HOOKS_STATUS_RUNNING = "Running";
export const HOOKS_STATUS_IDLE = "Idle";
export const HOOKS_STATUS_DONE = "Done";
export const HOOKS_STATUS_FAILED = "Failed";
export const HOOKS_UNAVAILABLE = "Unavailable";
export const HOOKS_GENERIC_IDENTITY = "Hook";
export const HOOKS_TOOLTIP_RUNNING =
  "Vendor-advertised hook is running. Permissions still settle in the action dock.";
export const HOOKS_TOOLTIP_IDLE =
  "Vendor-advertised hook is idle — advertised but not firing.";
export const HOOKS_TOOLTIP_DONE = "Vendor-advertised hook finished.";
export const HOOKS_TOOLTIP_FAILED = "Vendor-advertised hook failed.";

export type HookRow = {
  hookId: string;
  identityLabel: string;
  status: HookStatus | null;
  showLiveRunningChip: boolean;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

export type HooksProjection =
  | { state: "absent" }
  | {
      state: "loading";
      members: HookRow[] | null;
      sectionCopy: typeof HOOKS_LOADING;
      reconnectCopy: null;
    }
  | {
      state: "error";
      message: typeof HOOKS_FAILED;
      /** keep-visible last-ready rows when host retained them */
      members: HookRow[] | null;
    }
  | {
      state: "ready";
      members: HookRow[];
      /** membership size — includes Unavailable + Idle; header {N} */
      totalCount: number;
      /** live Running chips only */
      runningCount: number;
      idleCount: number;
      doneCount: number;
      failedCount: number;
      liveGrowing: boolean;
      offlineCopy: string | null;
      reconnectCopy: string | null;
    };

const ABSENT: HooksProjection = { state: "absent" };

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isChipStatus(value: unknown): value is HookStatus {
  return value === "running" || value === "idle" || value === "done" || value === "failed";
}

export function isCompleteHookMember(raw: unknown): raw is HookMember {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Partial<HookMember>;
  if (typeof o.hookId !== "string" || !o.hookId) return false;
  if (typeof o.firstEventSeq !== "number" || !Number.isFinite(o.firstEventSeq)) return false;
  if (o.restore !== "restored" && o.restore !== "unrestorable") return false;
  if (o.restore === "unrestorable") return true;
  return isChipStatus(o.status);
}

function sortByFirstEventSeq(members: HookMember[]): HookMember[] {
  return members.slice().sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

function completeList(list: HookMember[] | null | undefined): HookMember[] {
  return (list ?? []).filter(isCompleteHookMember);
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
    return { offlineCopy: HOOKS_OFFLINE, reconnectCopy: null };
  }
  if (input.parentTerminal || input.ownershipLost) {
    return { offlineCopy: null, reconnectCopy: HOOKS_RECONNECT_SHORT };
  }
  return { offlineCopy: null, reconnectCopy: null };
}

function mapRows(members: HookMember[], voucher: boolean): HookRow[] {
  return members.map((m) => {
    const unrestorable = m.restore === "unrestorable";
    const status = unrestorable ? null : isChipStatus(m.status) ? m.status : null;
    const name = unrestorable ? null : nonemptyString(m.name);
    return {
      hookId: m.hookId,
      identityLabel: name ?? HOOKS_GENERIC_IDENTITY,
      status,
      showLiveRunningChip: !unrestorable && status === "running" && voucher,
      restore: unrestorable ? "unrestorable" : "restored",
      firstEventSeq: m.firstEventSeq,
    };
  });
}

function counts(rows: HookRow[]): {
  totalCount: number;
  runningCount: number;
  idleCount: number;
  doneCount: number;
  failedCount: number;
} {
  let runningCount = 0;
  let idleCount = 0;
  let doneCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    if (row.showLiveRunningChip) runningCount += 1;
    if (row.status === "idle") idleCount += 1;
    if (row.status === "done") doneCount += 1;
    if (row.status === "failed") failedCount += 1;
  }
  return { totalCount: rows.length, runningCount, idleCount, doneCount, failedCount };
}

export function projectHooks(input: {
  mode?: string | null;
  codeAgent?: { identity?: string | null } | CodeAgentFact | null;
  hooks?: HooksMembershipFact | null;
  connected: boolean;
  parentTerminal: boolean;
  ownershipLost?: boolean;
  runNonTerminal: boolean;
  hostRosterEligible?: boolean;
}): HooksProjection {
  if (input.mode !== "code" || input.codeAgent?.identity !== "vendor") return ABSENT;
  if (input.hostRosterEligible === false) return ABSENT;
  const fact = input.hooks;
  if (!fact) return ABSENT;
  if (fact.disposition === "absent_for_non_code_or_non_vendor") return ABSENT;

  const voucher = hasCurrentVoucher(input);

  if (fact.disposition === "obtain_failed") {
    return {
      state: "error",
      message: HOOKS_FAILED,
      members: fact.members == null ? null : mapRows(sortByFirstEventSeq(completeList(fact.members)), voucher),
    };
  }

  if (fact.disposition === "hydrating") {
    const prior = fact.members == null ? null : sortByFirstEventSeq(completeList(fact.members));
    // Settled turn with no advertised hooks: don't leave a Loading hooks… band.
    if (input.parentTerminal && (prior == null || prior.length === 0)) return ABSENT;
    return {
      state: "loading",
      members: prior == null ? null : mapRows(prior, voucher),
      sectionCopy: HOOKS_LOADING,
      reconnectCopy: null,
    };
  }

  if (fact.disposition !== "ready") return ABSENT;
  const members = sortByFirstEventSeq(completeList(fact.members));
  if (members.length === 0) return ABSENT;

  const rows = mapRows(members, voucher);
  const copy = currencyCopy(input);
  return {
    state: "ready",
    members: rows,
    ...counts(rows),
    liveGrowing: Boolean(input.runNonTerminal && voucher),
    offlineCopy: copy.offlineCopy,
    reconnectCopy: copy.reconnectCopy,
  };
}
