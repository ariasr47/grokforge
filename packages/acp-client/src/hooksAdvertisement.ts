/** GATE-named hooks advertisement pin — do not invent; update only from GATE_SPIKE_DISCRIMINANT.md */

/** Complete execution member: JSON-RPC notification, not session/update. */
// Advertised hooks are vendor JSON-RPC, not a Forge skills/hooks engine.
export const NAMED_HOOKS_JSONRPC_METHOD = "_x.ai/session_notification";
/** Roster obtain (advertised-not-firing). Extra `result` wrap on the JSON-RPC result. */
export const NAMED_HOOKS_JSONRPC_LIST = "_x.ai/hooks/list";
/** Empty: hooks are not a session/update discriminant. */
export const NAMED_HOOKS_SESSION_UPDATE = "";

export const NAMED_HOOKS_EXECUTION_KIND = "hook_execution";
export const NAMED_HOOKS_CHANGED_KIND = "hooks_changed";

export const HOOK_IDENTITY_KEYS = ["name"] as const;
export const HOOK_NAME_KEYS = ["name"] as const;
export const HOOK_STATUS_KEYS = ["status", "disabled"] as const;

export type HookJournalStatus = "running" | "idle" | "done" | "failed";

/** Live token → closed journal status. Unknown → null (incomplete). Spike table only. */
export function mapVendorHookStatus(raw: unknown): HookJournalStatus | null {
  if (typeof raw === "boolean") return "idle";
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "success") return "done";
  if (s === "failed") return "failed";
  if (s === "skipped") return "idle";
  return null;
}

function firstString(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function statusFromHookObject(o: Record<string, unknown>): HookJournalStatus | null {
  if (typeof o.disabled === "boolean") return "idle";
  const tagged = o.status;
  if (tagged && typeof tagged === "object" && !Array.isArray(tagged)) {
    return mapVendorHookStatus((tagged as { status?: unknown }).status);
  }
  if ("status" in o) return mapVendorHookStatus(o.status);
  return null;
}

export function parseVendorHookMember(raw: unknown): {
  hookId: string;
  name: string | null;
  status: HookJournalStatus;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const hookId = firstString(o, HOOK_IDENTITY_KEYS);
  if (!hookId) return null;
  const status = statusFromHookObject(o);
  if (!status) return null;
  const name = firstString(o, HOOK_NAME_KEYS);
  return { hookId, name, status };
}

function hooksArrayFromUnknown(raw: unknown): unknown[] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.hooks)) return o.hooks;
  const inner = o.result;
  if (inner && typeof inner === "object" && Array.isArray((inner as { hooks?: unknown }).hooks)) {
    return (inner as { hooks: unknown[] }).hooks;
  }
  return null;
}

export function parseVendorHooksListResult(raw: unknown): Array<{
  hookId: string;
  name: string | null;
  status: HookJournalStatus;
}> | null {
  const hooks = hooksArrayFromUnknown(raw);
  if (!hooks) return null;
  const out: Array<{ hookId: string; name: string | null; status: HookJournalStatus }> = [];
  for (const item of hooks) {
    const parsed = parseVendorHookMember(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseVendorHookExecutionParams(raw: unknown): Array<{
  hookId: string;
  name: string | null;
  status: HookJournalStatus;
}> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const update = (o.update && typeof o.update === "object" ? o.update : o) as Record<string, unknown>;
  const kind = String(update.sessionUpdate ?? "");
  if (kind === NAMED_HOOKS_CHANGED_KIND) {
    const list = parseVendorHooksListResult(update);
    return list;
  }
  if (kind !== NAMED_HOOKS_EXECUTION_KIND) return null;
  const runs = update.runs;
  if (!Array.isArray(runs)) return null;
  const out: Array<{ hookId: string; name: string | null; status: HookJournalStatus }> = [];
  for (const run of runs) {
    const parsed = parseVendorHookMember(run);
    if (parsed) out.push(parsed);
  }
  return out;
}
