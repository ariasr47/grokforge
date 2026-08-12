/**
 * Export / import session stores for backup and migration.
 */
import {
  flushSessions,
  reloadSessionsFromDisk,
  type ChatSession,
  type StoredMessage,
} from "./sessions";

const STORE_KEY = "grokforge.sessions.v2";
const EXPORT_VERSION = 1;

export interface SessionExportBundle {
  version: number;
  exportedAt: string;
  app: "grokforge";
  store: unknown;
}

export function exportSessionsJson(): string {
  flushSessions();
  let store: unknown = { byWorkspace: {}, activeId: {}, pinned: [], expanded: [] };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) store = JSON.parse(raw);
  } catch {
    /* empty */
  }
  const bundle: SessionExportBundle = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "grokforge",
    store,
  };
  return JSON.stringify(bundle, null, 2);
}

export function downloadSessionsExport(): string {
  const text = exportSessionsJson();
  const name = `grokforge-sessions-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19)}.json`;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export type ImportResult =
  | { ok: true; partitions: number; sessions: number; mode: "merge" | "replace" }
  | { ok: false; error: string };

function countStore(store: {
  byWorkspace?: Record<string, ChatSession[]>;
}): { partitions: number; sessions: number } {
  const keys = Object.keys(store.byWorkspace ?? {});
  let sessions = 0;
  for (const k of keys) {
    sessions += (store.byWorkspace?.[k] ?? []).length;
  }
  return { partitions: keys.length, sessions };
}

/** Merge imported store into local (imported sessions win on id clash). */
export function importSessionsJson(
  raw: string,
  mode: "merge" | "replace" = "merge",
): ImportResult {
  let bundle: SessionExportBundle;
  try {
    bundle = JSON.parse(raw) as SessionExportBundle;
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  if (!bundle || typeof bundle !== "object") {
    return { ok: false, error: "Invalid bundle" };
  }
  const incoming = (bundle.store ?? bundle) as {
    byWorkspace?: Record<string, ChatSession[]>;
    activeId?: Record<string, string>;
    pinned?: string[];
    expanded?: string[];
  };
  if (!incoming.byWorkspace || typeof incoming.byWorkspace !== "object") {
    return { ok: false, error: "Bundle missing sessions store" };
  }

  flushSessions();
  let local: typeof incoming = {
    byWorkspace: {},
    activeId: {},
    pinned: [],
    expanded: [],
  };
  if (mode === "merge") {
    try {
      const existing = localStorage.getItem(STORE_KEY);
      if (existing) local = JSON.parse(existing) as typeof incoming;
    } catch {
      /* empty */
    }
  }

  const byWorkspace: Record<string, ChatSession[]> = {
    ...(local.byWorkspace ?? {}),
  };
  for (const [part, list] of Object.entries(incoming.byWorkspace)) {
    if (!Array.isArray(list)) continue;
    const prev = byWorkspace[part] ?? [];
    const map = new Map<string, ChatSession>();
    for (const s of prev) map.set(s.id, s);
    for (const s of list) {
      if (s && typeof s.id === "string") {
        map.set(s.id, sanitizeSession(s, part));
      }
    }
    byWorkspace[part] = [...map.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40);
  }

  const activeId = {
    ...(local.activeId ?? {}),
    ...(incoming.activeId ?? {}),
  };
  const pinned = unique([
    ...(local.pinned ?? []),
    ...(incoming.pinned ?? []),
  ]).slice(0, 50);
  const expanded = unique([
    ...(local.expanded ?? []),
    ...(incoming.expanded ?? []),
  ]).slice(0, 50);

  const next = { byWorkspace, activeId, pinned, expanded };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage full",
    };
  }
  // Keep sessions.ts memory cache in sync (import bypassed saveStore)
  reloadSessionsFromDisk(next);
  const c = countStore(next);
  return { ok: true, ...c, mode };
}

function sanitizeSession(s: ChatSession, workspace: string): ChatSession {
  return {
    id: s.id,
    workspace: s.workspace || workspace,
    title: String(s.title || "New chat").slice(0, 200),
    messages: Array.isArray(s.messages)
      ? (s.messages as StoredMessage[]).slice(-200)
      : [],
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
    branch: s.branch ?? null,
    status: s.status,
    subagents: s.subagents,
    open: s.open !== false,
  };
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

export function pickImportFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
