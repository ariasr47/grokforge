/** GATE-named MCP advertisement pin — do not invent; update only from GATE_SPIKE_DISCRIMINANT.md */
export const NAMED_MCP_SESSION_UPDATE = "_x.ai/mcp/server_status";

/** Live wire is a JSON-RPC notification method, not a sessionUpdate discriminant. */
export const NAMED_MCP_JSONRPC_STATUS = "_x.ai/mcp/server_status";
export const NAMED_MCP_JSONRPC_SERVERS_UPDATED = "_x.ai/mcp/servers_updated";

export const MCP_IDENTITY_KEYS = ["name"] as const;
export const MCP_NAME_KEYS = ["name"] as const;
export const MCP_STATUS_KEYS = ["status"] as const;

export type McpJournalStatus = "connected" | "idle" | "error";

/** Live token → closed journal status. Unknown → null (incomplete). */
export function mapVendorMcpStatus(raw: unknown): McpJournalStatus | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "ready" || s === "connected") return "connected";
  if (s === "idle") return "idle";
  if (
    s === "unavailable" ||
    s === "error" ||
    s === "failed" ||
    s === "disconnected"
  ) {
    return "error";
  }
  return null;
}

function firstString(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function parseVendorMcpStatusParams(raw: unknown): {
  serverId: string;
  name: string | null;
  status: McpJournalStatus;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const serverId = firstString(o, MCP_IDENTITY_KEYS);
  if (!serverId) return null;
  let statusRaw: unknown;
  for (const k of MCP_STATUS_KEYS) {
    if (k in o) {
      statusRaw = o[k];
      break;
    }
  }
  const status = mapVendorMcpStatus(statusRaw);
  if (!status) return null;
  const name = firstString(o, MCP_NAME_KEYS);
  return { serverId, name, status };
}
