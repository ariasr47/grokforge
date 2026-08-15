// Shared network-boundary fake host for flow-integration tests (SPEC §7 /
// spire-tech-flow-integration-tests: mock the network boundary only — real
// session store, real mode reducer, real React tree).
import type { DesktopHostStatus } from "./api";
import type { PublicState } from "./api";
import type { DesktopCommand } from "./desktopBridge";

/**
 * desktop-self-host F1 — the Tauri IPC boundary is the second (and only
 * other) thing the shell harness mocks. `window.__TAURI_INTERNALS__` makes
 * `isTauri()` true so `ensureDesktopHost`/`restartDesktopHost` route through
 * `callDesktop` (the fake bridge) instead of the browser-dev health-poll
 * fallback.
 */
export function installTauriGlobal(): () => void {
  const w = window as unknown as Record<string, unknown>;
  const had = "__TAURI_INTERNALS__" in w;
  const prev = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = {};
  return () => {
    if (had) w.__TAURI_INTERNALS__ = prev;
    else delete w.__TAURI_INTERNALS__;
  };
}

/**
 * A scripted fake bridge: each command pulls the next queued status (the
 * last entry repeats once the queue is exhausted), so a test can script an
 * exact sequence of launcher outcomes (e.g. two failed restarts then a
 * healthy one) per command.
 */
export function createFakeDesktopBridge(script: {
  ensure_host?: DesktopHostStatus[];
  restart_host?: DesktopHostStatus[];
  host_status?: DesktopHostStatus[];
}): { bridge: <T>(cmd: DesktopCommand) => Promise<T>; callsTo: (cmd: DesktopCommand) => number } {
  const cursors: Record<DesktopCommand, number> = {
    ensure_host: 0,
    restart_host: 0,
    host_status: 0,
  };
  const counts: Record<DesktopCommand, number> = {
    ensure_host: 0,
    restart_host: 0,
    host_status: 0,
  };
  const bridge = async <T>(cmd: DesktopCommand): Promise<T> => {
    counts[cmd] += 1;
    const list = script[cmd] ?? [];
    const idx = Math.min(cursors[cmd], list.length - 1);
    cursors[cmd] += 1;
    const status = list[idx];
    if (!status) throw new Error(`no scripted status for ${cmd}`);
    return status as unknown as T;
  };
  return { bridge, callsTo: (cmd) => counts[cmd] };
}

export function readyStatus(overrides: Partial<DesktopHostStatus> = {}): DesktopHostStatus {
  return {
    ok: true,
    phase: "ready",
    owned: true,
    port: 8787,
    pid: 4242,
    reason: null,
    osError: null,
    message: "",
    ...overrides,
  };
}

export function failedStatus(overrides: Partial<DesktopHostStatus> = {}): DesktopHostStatus {
  return {
    ok: false,
    phase: "failed",
    owned: true,
    port: null,
    pid: null,
    reason: "unknown",
    osError: null,
    message: "",
    ...overrides,
  };
}

export interface FetchCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export interface FakeHost {
  state: PublicState;
  calls: FetchCall[];
  fetchImpl: typeof fetch;
  callsTo: (pathIncludes: string) => FetchCall[];
}

const BASE_STATE: PublicState = {
  workspace: null,
  workspaceName: null,
  authMode: "sub_pool",
  hasApiKey: true,
  authSource: "oauth",
  model: "grok-4",
  connected: true,
  busy: false,
  sessionId: null,
  recent: [],
  mode: "chat",
  effort: "auto",
  appliedEffort: null,
  appliedModel: null,
  chatRoot: "C:\\Users\\qa\\.grokforge\\chat-sandbox",
  // INTERFACE_CONTRACT.md priorConversations — default false (fresh host).
  priorConversations: false,
};

export interface FakeHostOptions {
  /** Path (relative to the bound root) -> file contents, for GET /api/workspace/read. */
  files?: Record<string, string>;
  /** What POST /api/pick-folder returns (native folder-picker fallback). */
  pickFolderPath?: string | null;
  /**
   * GATE Q pass 1j finding N-8 (INTERFACE_CONTRACT.md §2.8 property 4,
   * SPEC.md AC12g/AC12h) regression harness: when true, every state-bearing
   * POST response (`/api/mode`, `/api/effort`, `/api/chat-root`,
   * `/api/settings`, `/api/workspace`) strips `priorConversations` from its
   * body before returning it — reproducing the exact wire shape QA read off
   * the packaged engine before the host lane stamps these responses too.
   * `GET /api/state` is never affected (both live sites the engine already
   * stamped, per the finding's own wire trace). Defaults to false so every
   * other test in this suite keeps exercising a fully-stamped host and the
   * shell's fix is proven to hold even when the engine half has NOT landed.
   */
  omitPriorConversationsOnMutatingResponses?: boolean;
}

export function createFakeHost(
  overrides: Partial<PublicState> = {},
  opts: FakeHostOptions = {},
): FakeHost {
  const state: PublicState = { ...BASE_STATE, ...overrides };
  const calls: FetchCall[] = [];
  const files = opts.files ?? {};

  function snapshot(): PublicState {
    return { ...state };
  }

  /** Snapshot for a state-mutating POST response — see
   *  `omitPriorConversationsOnMutatingResponses` above. */
  function mutatingSnapshot(): PublicState {
    const snap = snapshot();
    if (opts.omitPriorConversationsOnMutatingResponses) {
      delete (snap as Partial<PublicState>).priorConversations;
    }
    return snap;
  }

  async function route(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    search?: URLSearchParams,
  ): Promise<unknown> {
    if (path === "/api/health") {
      // INTERFACE_CONTRACT.md conformance block: nine fields.
      return {
        ok: true,
        service: "grokforge-host",
        version: "0.3.1",
        channel: "prod",
        channelLabel: "PROD",
        port: 8787,
        dataDir: "C:\\Users\\qa\\.grokforge",
        log: "C:\\Users\\qa\\.grokforge\\logs\\host.log",
        pid: 4242,
      };
    }
    if (path === "/api/state") return snapshot();

    if (path === "/api/mode" && method === "POST") {
      state.mode = (body?.mode as PublicState["mode"]) ?? state.mode;
      state.busy = false; // cancel + dispose + restart always clears busy
      return mutatingSnapshot();
    }
    if (path === "/api/cancel" && method === "POST") {
      state.busy = false;
      return { ok: true };
    }
    if (path === "/api/effort" && method === "POST") {
      state.effort = (body?.effort as PublicState["effort"]) ?? state.effort;
      return mutatingSnapshot();
    }
    if (path === "/api/chat-root" && method === "POST") {
      state.chatRoot =
        (body?.path as string | null | undefined) ??
        "C:\\Users\\qa\\.grokforge\\chat-sandbox";
      return mutatingSnapshot();
    }
    if (path === "/api/prompt" && method === "POST") {
      state.busy = true;
      return { ok: true };
    }
    if (path === "/api/settings" && method === "POST") {
      if (body?.clearKey) state.hasApiKey = false;
      if (typeof body?.agentId === "string") state.agentId = body.agentId;
      if (typeof body?.shellAllowlist === "boolean")
        state.shellAllowlist = body.shellAllowlist;
      return mutatingSnapshot();
    }
    if (path === "/api/oauth/start" && method === "POST") {
      return {
        user_code: "ABCD-1234",
        verification_uri: "https://grok.com/device",
        verification_uri_complete: "https://grok.com/device?user_code=ABCD-1234",
      };
    }
    if (path === "/api/oauth/cancel" && method === "POST") return { ok: true };
    if (path === "/api/oauth/logout" && method === "POST") {
      state.hasApiKey = false;
      state.authMode = "signed_out";
      return mutatingSnapshot();
    }
    if (path === "/api/restart" && method === "POST") {
      state.busy = false;
      return mutatingSnapshot();
    }
    if (path === "/api/workspace" && method === "POST") {
      state.workspace = (body?.path as string) ?? state.workspace;
      return mutatingSnapshot();
    }
    if (path === "/api/workspace/files") return { files: Object.keys(files) };
    if (path === "/api/workspace/read") {
      const p = search?.get("path") ?? "";
      if (p in files) return { path: p, content: files[p], truncated: false };
      return { __notFound: true };
    }
    if (path.startsWith("/api/workspace/branch")) return { path: "", branch: null };
    if (path === "/api/pick-folder" && method === "POST") {
      return opts.pickFolderPath === undefined
        ? { cancelled: true, path: null }
        : { cancelled: opts.pickFolderPath === null, path: opts.pickFolderPath };
    }
    if (path === "/api/permission" && method === "POST") return { ok: true };
    if (path === "/api/diff" && method === "POST") return { ok: true };
    if (path === "/api/policy") return { policy: {} };
    if (path === "/api/agents")
      return {
        agents: [],
        active: {
          id: "grok",
          name: "Grok",
          provider: "xai",
          status: "ready",
          description: "",
        },
      };
    if (path === "/api/connectors") return { connectors: [] };
    if (path === "/api/audit-path") return { path: "" };
    if (path === "/api/logs")
      return { ok: true, dir: "", hostPath: "", clientPath: "", host: "", client: "" };
    // Undeclared paths (e.g. a lingering /api/prefetch-mode call) 404, matching
    // the real host once the backend lane removes the endpoint — a caller that
    // still fires it fails loudly instead of silently succeeding.
    return { __notFound: true };
  }

  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const raw = typeof input === "string" ? input : input.toString();
    const url = new URL(raw, "http://127.0.0.1:8787");
    const method = (init?.method || "GET").toUpperCase();
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname, body });
    const json = await route(method, url.pathname, body, url.searchParams);
    const notFound = Boolean((json as { __notFound?: boolean })?.__notFound);
    return {
      ok: !notFound,
      status: notFound ? 404 : 200,
      statusText: notFound ? "Not Found" : "OK",
      text: async () => JSON.stringify(notFound ? { error: "not found" } : json),
    } as Response;
  }) as typeof fetch;

  return {
    state,
    calls,
    fetchImpl,
    callsTo: (pathIncludes: string) => calls.filter((c) => c.path.includes(pathIncludes)),
  };
}

/** Minimal controllable WebSocket the app can receive server-pushed events from. */
export class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(): void {
    /* client never needs to send in this app — commands go over REST */
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test-only: push a server event as if the host emitted it over /ws. */
  emit(ev: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }

  static latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}
