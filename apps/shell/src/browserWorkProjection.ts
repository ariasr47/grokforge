import type {
  BrowserWorkChipStatus,
  BrowserWorkMember,
  BrowserWorkMembershipFact,
  CodeAgentFact,
} from "./api";

export const BROWSER_HEADER = "Browser";
export const BROWSER_LOADING = "Loading browser work…";
export const BROWSER_FAILED = "Couldn't load browser work.";
export const BROWSER_OFFLINE =
  "Forge is offline. Browser work recorded on this run so far is still shown. Reconnect to confirm later updates.";
export const BROWSER_RECONNECT_SHORT = "Reconnect to confirm browser status.";
export const BROWSER_LIVE_GROWING = "Updating as browser work appears…";
export const BROWSER_HELPER =
  "Vendor browser / web-fetch on this run — Forge chrome, not a second Chrome.";
export const BROWSER_AVAILABLE_ANNOUNCE = "Browser work available";
export const BROWSER_STATUS_RUNNING = "Running";
export const BROWSER_STATUS_DONE = "Done";
export const BROWSER_STATUS_FAILED = "Failed";
export const BROWSER_UNAVAILABLE = "Unavailable";
export const BROWSER_GENERIC_IDENTITY = "Browser work";
export const BROWSER_SNAPSHOT = "Snapshot";
export const BROWSER_SNAPSHOT_MUTED = "Journaled snapshot";
export const BROWSER_TOOLTIP_RUNNING =
  "Vendor browser / web-fetch work is still running. Permissions still settle in the action dock.";
export const BROWSER_TOOLTIP_DONE = "Vendor browser / web-fetch work finished.";
export const BROWSER_TOOLTIP_FAILED = "Vendor browser / web-fetch work failed.";
export const BROWSER_TOOLTIP_SNAPSHOT =
  "Journaled snapshot caption from this run — not a live page.";

export type BrowserWorkRow = {
  toolCallId: string;
  identityLabel: string;
  url: string | null;
  title: string | null;
  status: BrowserWorkChipStatus | null;
  showLiveRunningChip: boolean;
  snapshotJournaled: boolean;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

export type BrowserWorkProjection =
  | { state: "absent" }
  | {
      state: "loading";
      members: BrowserWorkRow[] | null;
      /** When hydrating, Loading wins — do not surface offline reconnect as section lead. */
      sectionCopy: typeof BROWSER_LOADING;
      reconnectCopy: null;
    }
  | { state: "error"; message: string }
  | {
      state: "ready";
      members: BrowserWorkRow[];
      totalCount: number;
      runningCount: number;
      doneCount: number;
      failedCount: number;
      liveGrowing: boolean;
      offlineCopy: string | null;
      reconnectCopy: string | null;
    };

const ABSENT: BrowserWorkProjection = { state: "absent" };

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isChipStatus(value: unknown): value is BrowserWorkChipStatus {
  return value === "running" || value === "done" || value === "failed";
}

export function isCompleteBrowserWorkMember(raw: unknown): raw is BrowserWorkMember {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Partial<BrowserWorkMember>;
  if (typeof o.toolCallId !== "string" || !o.toolCallId) return false;
  if (o.acpToolKind !== "fetch") return false;
  if (typeof o.firstEventSeq !== "number" || !Number.isFinite(o.firstEventSeq)) return false;
  if (o.restore !== "restored" && o.restore !== "unrestorable") return false;
  if (o.status != null && !isChipStatus(o.status)) return false;
  return true;
}

function sortByFirstEventSeq(members: BrowserWorkMember[]): BrowserWorkMember[] {
  return members.slice().sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

function completeList(list: BrowserWorkMember[] | null | undefined): BrowserWorkMember[] {
  return (list ?? []).filter(isCompleteBrowserWorkMember);
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
    return { offlineCopy: BROWSER_OFFLINE, reconnectCopy: null };
  }
  if (input.parentTerminal || input.ownershipLost) {
    return { offlineCopy: null, reconnectCopy: BROWSER_RECONNECT_SHORT };
  }
  return { offlineCopy: null, reconnectCopy: null };
}

function identityFields(member: BrowserWorkMember): {
  identityLabel: string;
  url: string | null;
  title: string | null;
} {
  if (member.restore === "unrestorable") {
    return { identityLabel: BROWSER_GENERIC_IDENTITY, url: null, title: null };
  }
  const title = nonemptyString(member.title);
  const url = nonemptyString(member.url);
  if (title && url) return { identityLabel: title, url, title };
  if (title) return { identityLabel: title, url: null, title };
  if (url) return { identityLabel: url, url, title: null };
  return { identityLabel: BROWSER_GENERIC_IDENTITY, url: null, title: null };
}

function mapRows(members: BrowserWorkMember[], voucher: boolean): BrowserWorkRow[] {
  return members.map((m) => {
    const unrestorable = m.restore === "unrestorable";
    const ident = identityFields(m);
    const status = unrestorable ? null : isChipStatus(m.status) ? m.status : null;
    return {
      toolCallId: m.toolCallId,
      identityLabel: ident.identityLabel,
      url: ident.url,
      title: ident.title,
      status,
      showLiveRunningChip: !unrestorable && status === "running" && voucher,
      snapshotJournaled: unrestorable ? false : m.snapshotJournaled === true,
      restore: unrestorable ? "unrestorable" : "restored",
      firstEventSeq: m.firstEventSeq,
    };
  });
}

function counts(rows: BrowserWorkRow[]): {
  totalCount: number;
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
  return { totalCount: rows.length, runningCount, doneCount, failedCount };
}

export function projectBrowserWork(input: {
  mode?: string | null;
  codeAgent?: { identity?: string | null } | CodeAgentFact | null;
  browserWork?: BrowserWorkMembershipFact | null;
  connected: boolean;
  parentTerminal: boolean;
  ownershipLost?: boolean;
  runNonTerminal: boolean;
}): BrowserWorkProjection {
  if (input.mode !== "code" || input.codeAgent?.identity !== "vendor") return ABSENT;
  const fact = input.browserWork;
  if (!fact) return ABSENT;
  if (fact.disposition === "absent_for_non_code_or_non_vendor") return ABSENT;
  if (fact.disposition === "obtain_failed") {
    return { state: "error", message: BROWSER_FAILED };
  }

  const voucher = hasCurrentVoucher(input);

  if (fact.disposition === "hydrating") {
    const prior = fact.members == null ? null : sortByFirstEventSeq(completeList(fact.members));
    return {
      state: "loading",
      members: prior == null ? null : mapRows(prior, voucher),
      sectionCopy: BROWSER_LOADING,
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
