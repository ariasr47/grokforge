import { HOME_NAME_PLACEHOLDER } from "./chatPackComposer";

const KEY = "grokforge.sessions.v2";
const LEGACY_KEY = "grokforge.sessions.v1";
const MAX_PER_WS = 20;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  projectedRunId?: string;
  toolMeta?: {
    ok?: boolean;
    name?: string;
    summary?: string;
    done?: boolean;
  };
}

export type SessionStatus = "idle" | "live" | "busy";
export type SubagentStatus = "running" | "idle" | "done";

export interface SubagentRecord {
  id: string;
  name: string;
  role: string;
  branch: string;
  status: SubagentStatus;
  updatedAt: number;
}

export type PackMembers = { files: Array<{ path: string }>; note: string | null };

export const EMPTY_PACK_MEMBERS: PackMembers = { files: [], note: null };

export interface ChatSession {
  id: string;
  workspace: string;
  title: string;
  /** false = auto-title / placeholder; true = operator committed keep-or-start name. */
  committedName?: boolean;
  /** Accepted pack membership refs — durable until operator unpin/clear. */
  packMembers?: PackMembers;
  messages: StoredMessage[];
  updatedAt: number;
  branch?: string | null;
  status?: SessionStatus;
  subagents?: SubagentRecord[];
  open?: boolean;
  /** True while a decision (permission/diff/plan/recovery) is pending on this session's run. */
  needsYou?: boolean;
}

interface Store {
  byWorkspace: Record<string, ChatSession[]>;
  activeId: Record<string, string>;
  pinned: string[];
  expanded: string[];
}

let memory: Store | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveError: string | null = null;
const saveListeners = new Set<(err: string | null) => void>();

export function onSessionSaveError(
  fn: (err: string | null) => void,
): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

export function getLastSessionSaveError(): string | null {
  return lastSaveError;
}

function emptyStore(): Store {
  return { byWorkspace: {}, activeId: {}, pinned: [], expanded: [] };
}

function normalizePackMembers(raw: ChatSession["packMembers"]): PackMembers {
  if (!raw || !Array.isArray(raw.files)) return { ...EMPTY_PACK_MEMBERS };
  const files = raw.files
    .filter((f) => f && typeof f.path === "string" && f.path.trim())
    .map((f) => ({ path: String(f.path) }));
  const note = typeof raw.note === "string" ? raw.note : null;
  return { files, note };
}

/** Legacy records omit named-home fields — treat as uncommitted + honest empty pack. */
export function withHomeDefaults(s: ChatSession): ChatSession {
  return {
    ...s,
    committedName: s.committedName === true,
    packMembers: normalizePackMembers(s.packMembers),
  };
}

function migrateLegacy(): Store | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as {
      byWorkspace?: Record<string, ChatSession[]>;
      activeId?: Record<string, string>;
    };
    const byWorkspace = legacy.byWorkspace ?? {};
    const pinned = Object.keys(byWorkspace).filter(
      (ws) => (byWorkspace[ws]?.length ?? 0) > 0,
    );
    return {
      byWorkspace,
      activeId: legacy.activeId ?? {},
      pinned,
      expanded: [...pinned],
    };
  } catch {
    return null;
  }
}

function readDisk(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const migrated = migrateLegacy();
      if (migrated) return migrated;
      return emptyStore();
    }
    const s = JSON.parse(raw) as Store;
    return {
      byWorkspace: s.byWorkspace ?? {},
      activeId: s.activeId ?? {},
      pinned: s.pinned ?? [],
      expanded: s.expanded ?? [],
    };
  } catch {
    return emptyStore();
  }
}

function loadStore(): Store {
  if (!memory) memory = readDisk();
  return memory;
}

function persistNow(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    lastSaveError = null;
    for (const l of saveListeners) l(null);
  } catch (e) {
    lastSaveError =
      e instanceof Error ? e.message : "Failed to save sessions (storage full?)";
    for (const l of saveListeners) l(lastSaveError);
  }
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty || !memory) return;
    dirty = false;
    persistNow(memory);
  }, 800);
}

function saveStore(s: Store): void {
  memory = s;
  scheduleFlush();
}

/** Force immediate flush (call on page hide / session switch). */
export function flushSessions(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (memory) {
    dirty = false;
    persistNow(memory);
  }
}

/**
 * Replace in-memory cache from disk (or an explicit store).
 * Call after external localStorage writes (session import).
 */
export function reloadSessionsFromDisk(store?: {
  byWorkspace?: Record<string, ChatSession[]>;
  activeId?: Record<string, string>;
  pinned?: string[];
  expanded?: string[];
}): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  dirty = false;
  if (store) {
    memory = {
      byWorkspace: store.byWorkspace ?? {},
      activeId: store.activeId ?? {},
      pinned: store.pinned ?? [],
      expanded: store.expanded ?? [],
    };
  } else {
    memory = readDisk();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flushSessions());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSessions();
  });
}

function pinWorkspace(store: Store, workspace: string): void {
  if (!store.pinned.includes(workspace)) {
    store.pinned = [workspace, ...store.pinned];
  }
  if (!store.expanded.includes(workspace)) {
    store.expanded = [...store.expanded, workspace];
  }
}

function recomputePins(store: Store): void {
  store.pinned = Object.keys(store.byWorkspace).filter((ws) => {
    const list = store.byWorkspace[ws] ?? [];
    return list.some((s) => s.open !== false);
  });
}

export function listPinnedWorkspaces(): string[] {
  const s = loadStore();
  recomputePins(s);
  // Code tree only — never surface chat: partition keys as folders
  return s.pinned
    .filter((p) => !isChatPartition(p) && p !== "__no_workspace__")
    .slice()
    .sort((a, b) => {
      const ta = Math.max(
        0,
        ...(s.byWorkspace[a] ?? []).map((x) => x.updatedAt),
      );
      const tb = Math.max(
        0,
        ...(s.byWorkspace[b] ?? []).map((x) => x.updatedAt),
      );
      return tb - ta;
    });
}

/**
 * F4 (SPEC §4 flow 3 branch B, AC-U6): true when ANY partition (chat sandbox
 * or any code workspace) holds at least one session with at least one
 * message. Used at boot-error time, when server state (and therefore the
 * current partition key) may never have been reached — so this scans every
 * known partition rather than a single one.
 */
export function hasAnyStoredHistory(): boolean {
  const store = loadStore();
  return Object.values(store.byWorkspace).some((list) =>
    list.some(
      (s) =>
        s.open !== false &&
        (s.messages.length > 0 || s.committedName === true),
    ),
  );
}

export function listSessions(workspace: string): ChatSession[] {
  return (loadStore().byWorkspace[workspace] ?? [])
    .filter((s) => s.open !== false)
    .map(withHomeDefaults)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveSessionId(workspace: string): string | null {
  return loadStore().activeId[workspace] || null;
}

export function isExpanded(workspace: string): boolean {
  return loadStore().expanded.includes(workspace);
}

export function toggleExpanded(workspace: string): boolean {
  const store = loadStore();
  const open = !store.expanded.includes(workspace);
  setExpanded(workspace, open);
  return open;
}

export function setExpanded(workspace: string, open: boolean): void {
  const store = loadStore();
  if (open) {
    if (!store.expanded.includes(workspace)) {
      store.expanded = [...store.expanded, workspace];
    }
  } else {
    store.expanded = store.expanded.filter((w) => w !== workspace);
  }
  saveStore(store);
}

export function defaultSessionTitle(workspace: string): string {
  return workspace.startsWith("chat:") ? "New chat" : "New session";
}

/** List/heading label. Placeholder only while the home has no auto-title yet. */
export function chatListTitle(sess: {
  committedName?: boolean;
  title: string;
  workspace: string;
}): string {
  const untitled = defaultSessionTitle(sess.workspace);
  if (sess.committedName === true) return sess.title.trim() || untitled;
  const title = sess.title.trim();
  if (title && title !== untitled) return title;
  return HOME_NAME_PLACEHOLDER;
}

export function createSession(
  workspace: string,
  title = defaultSessionTitle(workspace),
  branch?: string | null,
): ChatSession {
  const session: ChatSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    workspace,
    title,
    committedName: false,
    packMembers: { ...EMPTY_PACK_MEMBERS },
    messages: [],
    updatedAt: Date.now(),
    branch: branch ?? null,
    status: "idle",
    subagents: [],
    open: true,
  };
  const store = loadStore();
  const list = [session, ...(store.byWorkspace[workspace] ?? [])].slice(
    0,
    MAX_PER_WS,
  );
  store.byWorkspace[workspace] = list;
  store.activeId[workspace] = session.id;
  pinWorkspace(store, workspace);
  saveStore(store);
  return session;
}

export function loadSession(
  workspace: string,
  id: string,
): ChatSession | null {
  const found = (loadStore().byWorkspace[workspace] ?? []).find((s) => s.id === id);
  return found ? withHomeDefaults(found) : null;
}

export function setActiveSession(workspace: string, id: string): void {
  const store = loadStore();
  store.activeId[workspace] = id;
  pinWorkspace(store, workspace);
  saveStore(store);
}

export function saveSessionMessages(
  workspace: string,
  id: string,
  messages: StoredMessage[],
  title?: string,
): void {
  const store = loadStore();
  const list = store.byWorkspace[workspace] ?? [];
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const prev = list[idx]!;
  const committed = prev.committedName === true;
  const nextTitle = committed
    ? prev.title
    : (title ??
      (messages.find((m) => m.role === "user")?.content.slice(0, 48) ||
        prev.title ||
        "New chat"));
  list[idx] = {
    ...prev,
    messages,
    title: nextTitle,
    committedName: committed,
    packMembers: normalizePackMembers(prev.packMembers),
    updatedAt: Date.now(),
    open: true,
  };
  store.byWorkspace[workspace] = list;
  pinWorkspace(store, workspace);
  saveStore(store);
}

export function commitHomeName(
  workspace: string,
  id: string,
  title: string,
): boolean {
  const store = loadStore();
  const list = store.byWorkspace[workspace] ?? [];
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  const prev = list[idx]!;
  const nextTitle = String(title || "").trim().slice(0, 200);
  if (!nextTitle) return false;
  list[idx] = {
    ...prev,
    title: nextTitle,
    committedName: true,
    packMembers: normalizePackMembers(prev.packMembers),
    updatedAt: Date.now(),
    open: true,
  };
  store.byWorkspace[workspace] = list;
  pinWorkspace(store, workspace);
  saveStore(store);
  flushSessions();
  return getLastSessionSaveError() === null;
}

export function updatePackMembers(
  workspace: string,
  id: string,
  members: PackMembers,
): void {
  const store = loadStore();
  const list = store.byWorkspace[workspace] ?? [];
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const prev = list[idx]!;
  list[idx] = {
    ...prev,
    packMembers: normalizePackMembers(members),
    updatedAt: Date.now(),
    open: true,
  };
  store.byWorkspace[workspace] = list;
  saveStore(store);
  flushSessions();
}

export function clearPackMembers(workspace: string, id: string): void {
  updatePackMembers(workspace, id, { ...EMPTY_PACK_MEMBERS });
}

export function updateSessionMeta(
  workspace: string,
  id: string,
  patch: Partial<
    Pick<ChatSession, "branch" | "status" | "title" | "subagents" | "open" | "needsYou">
  >,
): void {
  const store = loadStore();
  const list = store.byWorkspace[workspace] ?? [];
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx]!, ...patch, updatedAt: Date.now() };
  store.byWorkspace[workspace] = list;
  recomputePins(store);
  saveStore(store);
}

export function setSessionBranch(
  workspace: string,
  id: string,
  branch: string | null,
): void {
  updateSessionMeta(workspace, id, { branch });
}

/** Flip the Needs-you flag for one session (permission/diff/plan/recovery pending). */
export function setSessionNeedsYou(
  workspace: string,
  id: string,
  needsYou: boolean,
): void {
  updateSessionMeta(workspace, id, { needsYou });
}

/** Sessions in `workspace` currently flagged Needs-you, most recently updated first. */
export function listNeedsYou(workspace: string): ChatSession[] {
  return listSessions(workspace).filter((s) => s.needsYou === true);
}

export function setWorkspaceBranchAll(
  workspace: string,
  branch: string | null,
): void {
  const store = loadStore();
  const list = store.byWorkspace[workspace] ?? [];
  store.byWorkspace[workspace] = list.map((s) => ({
    ...s,
    branch: s.branch ?? branch,
  }));
  saveStore(store);
}

export function upsertSubagent(
  workspace: string,
  sessionId: string,
  sub: SubagentRecord,
): void {
  const store = loadStore();
  const list = store.byWorkspace[workspace] ?? [];
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  const sess = list[idx]!;
  const subs = [...(sess.subagents ?? [])];
  const si = subs.findIndex((x) => x.id === sub.id);
  if (si >= 0) subs[si] = { ...subs[si]!, ...sub, updatedAt: Date.now() };
  else subs.unshift({ ...sub, updatedAt: Date.now() });
  list[idx] = { ...sess, subagents: subs.slice(0, 30), updatedAt: Date.now() };
  store.byWorkspace[workspace] = list;
  saveStore(store);
}

export function ensureActiveSession(
  workspace: string,
  branch?: string | null,
): ChatSession {
  const store = loadStore();
  const active = store.activeId[workspace];
  if (active) {
    const found = (store.byWorkspace[workspace] ?? []).find((s) => s.id === active);
    if (found && found.open !== false) {
      pinWorkspace(store, workspace);
      if (branch && !found.branch) {
        found.branch = branch;
        saveStore(store);
      } else {
        saveStore(store);
      }
      return found;
    }
  }
  return createSession(workspace, defaultSessionTitle(workspace), branch);
}

export function deleteSession(
  workspace: string,
  id: string,
): ChatSession | null {
  const store = loadStore();
  const list = (store.byWorkspace[workspace] ?? []).filter((s) => s.id !== id);
  store.byWorkspace[workspace] = list;
  if (store.activeId[workspace] === id) {
    store.activeId[workspace] = list[0]?.id ?? "";
  }
  recomputePins(store);
  saveStore(store);
  flushSessions();
  return list[0] ?? null;
}

export function workspaceDisplayName(workspace: string): string {
  const parts = workspace.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || workspace;
}

/** Partition key for session store by product mode. */
export function partitionKey(
  mode: "chat" | "code",
  root: string | null | undefined,
): string {
  if (mode === "chat") {
    // Normalize to a stable sandbox key so path casing/variants don't fork history
    const r = root?.trim() || "";
    if (!r || r.includes("chat-sandbox")) return "chat:__sandbox__";
    return `chat:${r}`;
  }
  return root?.trim() || "__no_workspace__";
}

export function isChatPartition(key: string): boolean {
  return key.startsWith("chat:");
}
