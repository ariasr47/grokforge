import type {
  CodeAgentFact,
  McpServerMember,
  McpServerStatus,
  McpServersMembershipFact,
} from "./api";

export const MCP_HEADER = "MCP";
export const MCP_LOADING = "Loading MCP…";
export const MCP_FAILED = "Couldn't load MCP.";
export const MCP_OFFLINE =
  "Forge is offline. MCP recorded on this session so far is still shown. Reconnect to confirm later updates.";
export const MCP_RECONNECT_SHORT = "Reconnect to confirm MCP status.";
export const MCP_LIVE_GROWING = "Updating as MCP appears…";
export const MCP_HELPER =
  "MCP servers Grok Code advertised on this session — Forge chrome, not a Forge MCP host.";
export const MCP_AVAILABLE_ANNOUNCE = "MCP available";
export const MCP_STATUS_CONNECTED = "Connected";
export const MCP_STATUS_IDLE = "Idle";
export const MCP_STATUS_ERROR = "Error";
export const MCP_UNAVAILABLE = "Unavailable";
export const MCP_GENERIC_IDENTITY = "MCP server";
export const MCP_TOOLTIP_CONNECTED =
  "Vendor-advertised MCP server is connected. Permissions still settle in the action dock.";
export const MCP_TOOLTIP_IDLE = "Vendor-advertised MCP server is idle.";
export const MCP_TOOLTIP_ERROR = "Vendor-advertised MCP server reported an error.";

export type McpServerRow = {
  serverId: string;
  identityLabel: string;
  status: McpServerStatus | null;
  showLiveConnectedChip: boolean;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

export type McpServersProjection =
  | { state: "absent" }
  | {
      state: "loading";
      members: McpServerRow[] | null;
      sectionCopy: typeof MCP_LOADING;
      reconnectCopy: null;
    }
  | {
      state: "error";
      message: typeof MCP_FAILED;
      /** keep-visible last-ready rows when host retained them */
      members: McpServerRow[] | null;
    }
  | {
      state: "ready";
      members: McpServerRow[];
      /** membership size — includes Unavailable; header {N} */
      totalCount: number;
      /** live Connected chips only */
      connectedCount: number;
      idleCount: number;
      errorCount: number;
      liveGrowing: boolean;
      offlineCopy: string | null;
      reconnectCopy: string | null;
    };

const ABSENT: McpServersProjection = { state: "absent" };

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isChipStatus(value: unknown): value is McpServerStatus {
  return value === "connected" || value === "idle" || value === "error";
}

export function isCompleteMcpServerMember(raw: unknown): raw is McpServerMember {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Partial<McpServerMember>;
  if (typeof o.serverId !== "string" || !o.serverId) return false;
  if (typeof o.firstEventSeq !== "number" || !Number.isFinite(o.firstEventSeq)) return false;
  if (o.restore !== "restored" && o.restore !== "unrestorable") return false;
  if (o.restore === "unrestorable") return true;
  return isChipStatus(o.status);
}

function sortByFirstEventSeq(members: McpServerMember[]): McpServerMember[] {
  return members.slice().sort((a, b) => a.firstEventSeq - b.firstEventSeq);
}

function completeList(list: McpServerMember[] | null | undefined): McpServerMember[] {
  return (list ?? []).filter(isCompleteMcpServerMember);
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
    return { offlineCopy: MCP_OFFLINE, reconnectCopy: null };
  }
  if (input.parentTerminal || input.ownershipLost) {
    return { offlineCopy: null, reconnectCopy: MCP_RECONNECT_SHORT };
  }
  return { offlineCopy: null, reconnectCopy: null };
}

function mapRows(members: McpServerMember[], voucher: boolean): McpServerRow[] {
  return members.map((m) => {
    const unrestorable = m.restore === "unrestorable";
    const status = unrestorable ? null : isChipStatus(m.status) ? m.status : null;
    const name = unrestorable ? null : nonemptyString(m.name);
    return {
      serverId: m.serverId,
      identityLabel: name ?? MCP_GENERIC_IDENTITY,
      status,
      showLiveConnectedChip: !unrestorable && status === "connected" && voucher,
      restore: unrestorable ? "unrestorable" : "restored",
      firstEventSeq: m.firstEventSeq,
    };
  });
}

function counts(rows: McpServerRow[]): {
  totalCount: number;
  connectedCount: number;
  idleCount: number;
  errorCount: number;
} {
  let connectedCount = 0;
  let idleCount = 0;
  let errorCount = 0;
  for (const row of rows) {
    if (row.showLiveConnectedChip) connectedCount += 1;
    if (row.status === "idle") idleCount += 1;
    if (row.status === "error") errorCount += 1;
  }
  return { totalCount: rows.length, connectedCount, idleCount, errorCount };
}

export function projectMcpServers(input: {
  mode?: string | null;
  codeAgent?: { identity?: string | null } | CodeAgentFact | null;
  mcpServers?: McpServersMembershipFact | null;
  connected: boolean;
  parentTerminal: boolean;
  ownershipLost?: boolean;
  runNonTerminal: boolean;
  hostRosterEligible?: boolean;
}): McpServersProjection {
  if (input.mode !== "code" || input.codeAgent?.identity !== "vendor") return ABSENT;
  if (input.hostRosterEligible === false) return ABSENT;
  const fact = input.mcpServers;
  if (!fact) return ABSENT;
  if (fact.disposition === "absent_for_non_code_or_non_vendor") return ABSENT;

  const voucher = hasCurrentVoucher(input);

  if (fact.disposition === "obtain_failed") {
    return {
      state: "error",
      message: MCP_FAILED,
      members: fact.members == null ? null : mapRows(sortByFirstEventSeq(completeList(fact.members)), voucher),
    };
  }

  if (fact.disposition === "hydrating") {
    const prior = fact.members == null ? null : sortByFirstEventSeq(completeList(fact.members));
    return {
      state: "loading",
      members: prior == null ? null : mapRows(prior, voucher),
      sectionCopy: MCP_LOADING,
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
