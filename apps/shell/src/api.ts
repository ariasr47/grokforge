import { invoke } from "@tauri-apps/api/core";

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

/** Channel: prod (stable) vs dev (side-by-side). Injected by Vite for dev. */
export function appChannel(): "prod" | "dev" {
  const c = String(import.meta.env.VITE_GROKFORGE_CHANNEL || "prod").toLowerCase();
  if (c === "dev" || c === "tst" || c === "test" || c === "qa") return "dev";
  return "prod";
}

/** User-facing channel label (DEV / TST / empty for prod). */
export function channelBadge(): string | null {
  const raw = String(
    import.meta.env.VITE_GROKFORGE_CHANNEL_LABEL ||
      import.meta.env.VITE_GROKFORGE_CHANNEL ||
      "prod",
  ).toLowerCase();
  if (raw === "tst" || raw === "test" || raw === "qa") return "TST";
  if (raw === "dev" || raw === "development") return "DEV";
  if (appChannel() === "dev") return "DEV";
  return null;
}

export function hostPort(): number {
  const fromEnv = Number(import.meta.env.VITE_GROKFORGE_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return appChannel() === "dev" ? 8788 : 8787;
}

/** API base: always absolute in Tauri; Vite proxy in browser dev. */
export function hostBase(): string {
  const env = import.meta.env.VITE_HOST_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  const port = hostPort();
  if (isTauri()) return `http://127.0.0.1:${port}`;
  // Browser dev: Vite proxies /api and /ws to the channel host
  if (import.meta.env.DEV) return "";
  return `http://127.0.0.1:${port}`;
}

export function wsUrl(): string {
  const base = hostBase();
  if (base) return base.replace(/^http/, "ws") + "/ws";
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  }
  return `ws://127.0.0.1:${hostPort()}/ws`;
}

export type ProductMode = "chat" | "code";
export type EffortLevel = "auto" | "fast" | "expert" | "heavy";

export interface PublicState {
  workspace: string | null;
  workspaceName: string | null;
  authMode: "signed_out" | "api_key" | "sub_pool";
  hasApiKey: boolean;
  authSource: string;
  model: string;
  connected: boolean;
  busy: boolean;
  sessionId: string | null;
  recent: Array<{ name: string; path: string; openedAt: number }>;
  shellAllowlist?: boolean;
  logHint?: string;
  mode?: ProductMode;
  effort?: EffortLevel;
  appliedEffort?: EffortLevel | null;
  appliedModel?: string | null;
  chatRoot?: string | null;
  agentId?: string;
  agentName?: string;
  agentStatus?: string;
}

export interface AgentDescriptor {
  id: string;
  name: string;
  provider: string;
  status: "ready" | "planned" | "disabled";
  description: string;
}

export type ServerEvent =
  | { type: "state"; state: PublicState }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | {
      type: "run_phase";
      phase: "waiting_model" | "reasoning" | "tools" | "writing" | "done";
      detail?: string;
    }
  | { type: "tool_request"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; output: unknown }
  | {
      type: "permission_request";
      id: string;
      kind: "write" | "shell";
      detail: string;
    }
  | {
      type: "file_edit";
      path: string;
      diff: string;
      status: "proposed" | "accepted" | "rejected";
      id?: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      detail?: string;
      status?: number;
    }
  | { type: "done"; reason?: string }
  | { type: "agent_log"; level: "debug" | "info" | "warn"; message: string }
  | {
      type: "oauth_pending";
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
    }
  | { type: "oauth_complete"; ok: boolean; message?: string };

export interface DesktopHostStatus {
  ok: boolean;
  message: string;
  owned: boolean;
  pid?: number | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${hostBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: (T & { error?: string }) | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T & { error?: string };
    } catch {
      if (!res.ok) {
        throw new Error(
          `${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
        );
      }
      throw new Error(`Invalid JSON from host (${path}): ${text.slice(0, 120)}`);
    }
  }
  if (!res.ok) {
    throw new Error(body?.error || `${res.status} ${res.statusText}`);
  }
  return (body ?? ({} as T)) as T;
}

export const api = {
  health: () => json<{ ok: boolean; log?: string }>("/api/health"),
  state: () => json<PublicState>("/api/state"),
  workspaceFiles: () => json<{ files: string[] }>("/api/workspace/files"),
  workspaceRead: (path: string) =>
    json<{ path: string; content: string; truncated?: boolean }>(
      `/api/workspace/read?path=${encodeURIComponent(path)}`,
    ),
  workspaceBranch: (path?: string) =>
    json<{ path: string; branch: string | null }>(
      `/api/workspace/branch${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  workspaceBranches: (paths: string[]) =>
    json<{ branches: Record<string, string | null> }>(
      "/api/workspace/branches",
      { method: "POST", body: JSON.stringify({ paths }) },
    ),
  testConnection: () =>
    json<{
      hostOk: boolean;
      authMode: string;
      authSource: string;
      hasCredential: boolean;
      model: string;
      probe: { ok: boolean; status?: number; detail?: string };
    }>("/api/test-connection", { method: "POST", body: "{}" }),
  openLogs: () =>
    json<{ ok: boolean; path?: string; error?: string }>("/api/open-logs", {
      method: "POST",
      body: "{}",
    }),
  logs: () =>
    json<{
      ok: boolean;
      dir: string;
      hostPath: string;
      clientPath: string;
      host: string;
      client: string;
    }>("/api/logs"),
  clientLog: (
    level: "info" | "warn" | "error" | "debug",
    message: string,
    meta?: Record<string, unknown>,
  ) =>
    json<{ ok: boolean }>("/api/client-log", {
      method: "POST",
      body: JSON.stringify({ level, message, meta }),
    }).catch(() => ({ ok: false as const })),
  exportDiagnostics: (opts?: { markdown?: string; openFolder?: boolean }) =>
    json<{
      ok: boolean;
      path: string;
      dir: string;
      markdown: string;
    }>("/api/export-diagnostics", {
      method: "POST",
      body: JSON.stringify({
        markdown: opts?.markdown ?? "",
        openFolder: opts?.openFolder !== false,
      }),
    }),
  openWorkspace: (path: string) =>
    json<PublicState>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  settings: (body: {
    apiKey?: string;
    model?: string;
    clearKey?: boolean;
    shellAllowlist?: boolean;
    agentId?: string;
  }) =>
    json<PublicState>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  agents: () =>
    json<{ agents: AgentDescriptor[]; active: AgentDescriptor }>(
      "/api/agents",
    ),
  policy: () => json<{ policy: Record<string, unknown> }>("/api/policy"),
  setPolicy: (patch: Record<string, unknown>) =>
    json<{ policy: Record<string, unknown> }>("/api/policy", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  auditPath: () => json<{ path: string }>("/api/audit-path"),
  prompt: (
    text: string,
    effort?: EffortLevel,
    opts?: {
      history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    },
  ) =>
    json<{ ok: boolean }>("/api/prompt", {
      method: "POST",
      body: JSON.stringify({
        text,
        effort,
        history: opts?.history,
      }),
    }),
  setMode: (mode: ProductMode) =>
    json<PublicState>("/api/mode", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  setEffort: (effort: EffortLevel) =>
    json<PublicState>("/api/effort", {
      method: "POST",
      body: JSON.stringify({ effort }),
    }),
  setChatRoot: (path: string | null) =>
    json<PublicState>("/api/chat-root", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  prefetchMode: (mode: ProductMode) =>
    json<{ ok: boolean; ready: boolean; mode: ProductMode }>(
      "/api/prefetch-mode",
      {
        method: "POST",
        body: JSON.stringify({ mode }),
      },
    ).catch(() => ({ ok: false, ready: false, mode })),
  cancel: () =>
    json<{ ok: boolean }>("/api/cancel", { method: "POST", body: "{}" }),
  restart: () =>
    json<PublicState>("/api/restart", { method: "POST", body: "{}" }),
  oauthStart: () =>
    json<{
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
    }>("/api/oauth/start", { method: "POST", body: "{}" }),
  oauthCancel: () =>
    json<{ ok: boolean }>("/api/oauth/cancel", { method: "POST", body: "{}" }),
  oauthLogout: () =>
    json<PublicState>("/api/oauth/logout", { method: "POST", body: "{}" }),
  permission: (id: string, decision: "allow_once" | "allow_session" | "deny") =>
    json<{ ok: boolean }>("/api/permission", {
      method: "POST",
      body: JSON.stringify({ id, decision }),
    }),
  diff: (id: string, action: "accept" | "reject") =>
    json<{ ok: boolean }>("/api/diff", {
      method: "POST",
      body: JSON.stringify({ id, action }),
    }),
  listConnectors: () =>
    json<{ connectors: ConnectorInfo[] }>("/api/connectors"),
  setConnectorToken: (id: string, token: string | null) =>
    json<{ connectors: ConnectorInfo[] }>("/api/connectors/token", {
      method: "POST",
      body: JSON.stringify({ id, token }),
    }),
  testConnector: (id: string) =>
    json<{
      ok: boolean;
      message: string;
      connectors: ConnectorInfo[];
    }>("/api/connectors/test", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
};

export type ConnectorStatus =
  | "live"
  | "configured"
  | "paste_workflow"
  | "planned";

export interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  status: ConnectorStatus;
  howToday: string;
  samplePrompt: string;
  tokenConfigurable?: boolean;
  tokenLabel?: string;
  lastTestOk?: boolean | null;
  lastTestAt?: string | null;
  lastTestMessage?: string | null;
  hasToken?: boolean;
}

/** Desktop: ask Tauri to ensure host is up. Browser: poll health only. */
export async function ensureDesktopHost(): Promise<DesktopHostStatus> {
  if (isTauri()) {
    try {
      return await invoke<DesktopHostStatus>("ensure_host");
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        owned: false,
      };
    }
  }
  try {
    await api.health();
    return { ok: true, message: "Host healthy", owned: false };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Host offline",
      owned: false,
    };
  }
}

export async function restartDesktopHost(): Promise<DesktopHostStatus> {
  if (isTauri()) {
    try {
      return await invoke<DesktopHostStatus>("restart_host");
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        owned: false,
      };
    }
  }
  try {
    await api.restart();
    return { ok: true, message: "Agent restarted", owned: false };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      owned: false,
    };
  }
}

export async function pollHostHealth(
  attempts = 40,
  delayMs = 250,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const h = await api.health();
      if (h.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export class HostSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<(ev: ServerEvent) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private onStatus?: (connected: boolean) => void;
  private attempt = 0;

  constructor(opts?: { onStatus?: (connected: boolean) => void }) {
    this.onStatus = opts?.onStatus;
  }

  connect(): void {
    this.closed = false;
    this.detachSocket();
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.onStatus?.(true);
    };
    socket.onmessage = (m) => {
      try {
        const ev = JSON.parse(String(m.data)) as ServerEvent;
        for (const h of this.handlers) h(ev);
      } catch {
        /* ignore */
      }
    };
    socket.onclose = () => {
      if (this.ws === socket) this.ws = null;
      this.onStatus?.(false);
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      this.onStatus?.(false);
    };
  }

  private detachSocket(): void {
    const prev = this.ws;
    this.ws = null;
    if (!prev) return;
    prev.onopen = null;
    prev.onmessage = null;
    prev.onclose = null;
    prev.onerror = null;
    try {
      prev.close();
    } catch {
      /* ignore */
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Exponential backoff with jitter: 0.5s → ~8s cap
    const base = Math.min(8000, 500 * 2 ** Math.min(this.attempt, 4));
    this.attempt += 1;
    const delay = base + Math.floor(Math.random() * 200);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  on(handler: (ev: ServerEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.detachSocket();
  }
}

/**
 * Native folder picker:
 * 1) Tauri dialog (when MSVC-built desktop app)
 * 2) Host WinForms dialog (works with npm run desktop launcher)
 */
export async function pickFolderNative(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open workspace folder",
      });
      if (typeof selected === "string") return selected;
      if (Array.isArray(selected) && selected[0]) return selected[0];
      return null;
    } catch {
      /* fall through to host */
    }
  }
  try {
    const res = await json<{ cancelled?: boolean; path: string | null }>(
      "/api/pick-folder",
      { method: "POST", body: "{}" },
    );
    if (res.cancelled || !res.path) return null;
    return res.path;
  } catch {
    return null;
  }
}
