// Shared network-boundary fake host for flow-integration tests (SPEC §7 /
// spire-tech-flow-integration-tests: mock the network boundary only — real
// session store, real mode reducer, real React tree).
import type {
  DesktopHostStatus,
  PublicState,
  TrustedCommandClassCatalogEntry,
  TrustedCommandClassId,
  TrustedCommandClassesView,
} from "./api";
import type { DesktopCommand } from "./desktopBridge";

const TRUSTED_CLASS_CATALOG: TrustedCommandClassCatalogEntry[] = [
  { id: "npm", label: "npm" },
  { id: "npx", label: "npx" },
  { id: "cargo", label: "cargo" },
  { id: "git:status", label: "git status" },
  { id: "git:diff", label: "git diff" },
  { id: "git:log", label: "git log" },
  { id: "git:show", label: "git show" },
];

function emptyClassesView(workspace: string): TrustedCommandClassesView {
  return {
    status: "confirmed",
    workspace,
    classes: [],
    revision: "fallback",
    source: "fallback",
    fallbackReason: "missing",
    savedForWorkspace: false,
    catalog: TRUSTED_CLASS_CATALOG,
  };
}

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
  [key: string]: DesktopHostStatus[] | undefined;
}): { bridge: <T>(cmd: DesktopCommand, args?: Record<string, unknown>) => Promise<T>; callsTo: (cmd: DesktopCommand) => number } {
  const cursors: Record<DesktopCommand, number> = {
    ensure_host: 0,
    restart_host: 0,
    host_status: 0,
    get_bypass_permissions_unlock: 0,
    unlock_bypass_permissions: 0,
    lock_bypass_permissions: 0,
    authorize_bypass_permissions_activation: 0,
  };
  const counts: Record<DesktopCommand, number> = {
    ensure_host: 0,
    restart_host: 0,
    host_status: 0,
    get_bypass_permissions_unlock: 0,
    unlock_bypass_permissions: 0,
    lock_bypass_permissions: 0,
    authorize_bypass_permissions_activation: 0,
  };
  const bridge = async <T>(cmd: DesktopCommand, _args?: Record<string, unknown>): Promise<T> => {
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

export interface FakeRunJournal {
  run: unknown;
  events: unknown[];
}

export interface FakeHost {
  state: PublicState;
  calls: FetchCall[];
  fetchImpl: typeof fetch;
  callsTo: (pathIncludes: string) => FetchCall[];
  trustedClasses: Map<string, TrustedCommandClassesView>;
  runJournals: Map<string, FakeRunJournal>;
  nextClassSaveError: { status: number; code: string } | null;
  pendingPlanDecision: boolean;
}

const BASE_STATE: PublicState = {
  shellCapability: { status: "available", platform: "win32", osFamily: "windows", executable: "C:\\Windows\\System32\\cmd.exe", displayName: "Command Prompt (cmd.exe)", dialect: "cmd", reasonCode: null, reason: null },
  workspace: null,
  workspaceName: null,
  authMode: "sub_pool",
  hasApiKey: true,
  authSource: "oauth",
  model: "grok-4.6",
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
  permissionPolicy: { status: "confirmed", workspace: "", storedMode: null, effectiveMode: "review", source: "default", revision: "default", fallbackReason: null, savedForWorkspace: false },
  bypassPermissions: { unlocked: false, available: false, activeForSession: false, blockedReason: "unlock_required", confirmationVersion: null },
  planEngagement: { engaged: false, vouched: true },
  projectInstructions: { status: "absent", path: null, vouched: true },
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
  trustedClasses?: TrustedCommandClassesView;
  classSaveError?: { status: number; code: string } | null;
  /** GET /api/runs/{runId} bodies keyed by runId. */
  runJournals?: Record<string, FakeRunJournal>;
  /** When true, omit planEngagement from state snapshots (older-host / AC-28). */
  omitPlanEngagement?: boolean;
  /** When true, omit projectInstructions from state snapshots (older-host loading). */
  omitProjectInstructions?: boolean;
  /** Scripted POST /api/prompt refuse. */
  promptRefuse?: { status: number; code: string; error: string } | null;
}

export function createFakeHost(
  overrides: Partial<PublicState> = {},
  opts: FakeHostOptions = {},
): FakeHost {
  const state: PublicState = { ...BASE_STATE, ...overrides };
  const calls: FetchCall[] = [];
  const files = opts.files ?? {};
  const trustedClasses = new Map<string, TrustedCommandClassesView>();
  if (opts.trustedClasses && overrides.workspace) {
    trustedClasses.set(overrides.workspace, opts.trustedClasses);
  }
  const runJournals = new Map<string, FakeRunJournal>(Object.entries(opts.runJournals ?? {}));
  let nextClassSaveError = opts.classSaveError ?? null;
  let nextPromptRefuse = opts.promptRefuse ?? null;
  let pendingPlanDecision = false;

  function snapshot(): PublicState {
    const snap = { ...state };
    if (opts.omitPlanEngagement) {
      delete (snap as Partial<PublicState>).planEngagement;
    }
    if (opts.omitProjectInstructions) {
      delete (snap as Partial<PublicState>).projectInstructions;
    } else if (snap.mode === "chat") {
      snap.projectInstructions = { status: "absent", path: null, vouched: true };
    } else if (!snap.workspace) {
      snap.projectInstructions = { status: "absent", path: null, vouched: true };
    }
    return snap;
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
      if (nextPromptRefuse) {
        const err = nextPromptRefuse;
        nextPromptRefuse = null;
        return {
          __error: true,
          status: err.status,
          error: err.error,
          code: err.code,
          retryable: false,
          runId: null,
        };
      }
      if (state.mode === "code" && (!state.planEngagement || state.planEngagement.vouched === false)) {
        return {
          __error: true,
          status: 409,
          error: "Plan engagement cannot be vouched",
          code: "plan_engagement_unvouched",
          retryable: false,
          runId: null,
        };
      }
      if (pendingPlanDecision && state.mode === "code") {
        return {
          __error: true,
          status: 409,
          error: "A plan decision is still pending",
          code: "plan_decision_pending",
          retryable: false,
          runId: null,
        };
      }
      state.busy = true;
      return { ok: true };
    }
    if (path === "/api/plan-engagement" && method === "POST") {
      if (state.mode === "chat") {
        return {
          __error: true,
          status: 400,
          error: "Plan is not applicable in Chat",
          code: "plan_not_applicable",
          retryable: false,
          runId: null,
        };
      }
      if (!state.planEngagement || state.planEngagement.vouched === false) {
        return {
          __error: true,
          status: 409,
          error: "Plan engagement cannot be vouched",
          code: "plan_engagement_unvouched",
          retryable: false,
          runId: null,
        };
      }
      if (typeof body?.engaged !== "boolean") {
        return {
          __error: true,
          status: 400,
          error: "engaged required",
          code: "invalid_request",
          retryable: false,
          runId: null,
        };
      }
      if (body.engaged === false) pendingPlanDecision = false;
      state.planEngagement = { engaged: body.engaged, vouched: true };
      return mutatingSnapshot();
    }
    if (path === "/api/plan" && method === "POST") {
      const action = body?.action;
      if (action !== "accept" && action !== "keep_planning") {
        return {
          __error: true,
          status: 400,
          error: "invalid plan action",
          code: "invalid_request",
          retryable: false,
          runId: null,
        };
      }
      pendingPlanDecision = false;
      if (action === "accept" && state.planEngagement) {
        state.planEngagement = { engaged: false, vouched: true };
      }
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
      const next = (body?.path as string) ?? state.workspace;
      if (next !== state.workspace) {
        state.workspace = next;
        state.projectInstructions = { status: "absent", path: null, vouched: false };
      }
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
    if (path === "/api/trusted-command-class-catalog") {
      return { catalog: TRUSTED_CLASS_CATALOG };
    }
    if (path === "/api/trusted-command-classes" && method === "GET") {
      const workspace = search?.get("workspace") ?? "";
      if (!workspace || workspace === ".") {
        return {
          __error: true,
          status: 400,
          error: "Workspace must be an absolute directory",
          code: "invalid_workspace",
          retryable: false,
          runId: null,
        };
      }
      return { classes: trustedClasses.get(workspace) ?? emptyClassesView(workspace) };
    }
    if (path === "/api/trusted-command-classes" && method === "POST") {
      const workspace = typeof body?.workspace === "string" ? body.workspace : "";
      if (!workspace || workspace === ".") {
        return {
          __error: true,
          status: 400,
          error: "Invalid workspace or classes request",
          code: "invalid_workspace",
          retryable: false,
          runId: null,
        };
      }
      if (nextClassSaveError) {
        const err = nextClassSaveError;
        nextClassSaveError = null;
        if (err.code === "class_revision_conflict") {
          const current = trustedClasses.get(workspace) ?? emptyClassesView(workspace);
          trustedClasses.set(workspace, { ...current, revision: `fresh-${Date.now()}` });
        }
        return {
          __error: true,
          status: err.status,
          error: err.code === "run_active" ? "Run is active" : "Class revision conflict",
          code: err.code,
          retryable: false,
          runId: null,
        };
      }
      const incoming = Array.isArray(body?.classes) ? body.classes : [];
      const classes = incoming.filter((id): id is TrustedCommandClassId =>
        TRUSTED_CLASS_CATALOG.some((entry) => entry.id === id),
      );
      const saved: TrustedCommandClassesView = {
        status: "confirmed",
        workspace,
        classes,
        revision: `rev-${Date.now()}`,
        source: "saved",
        fallbackReason: null,
        savedForWorkspace: true,
        catalog: TRUSTED_CLASS_CATALOG,
      };
      trustedClasses.set(workspace, saved);
      return { classes: saved };
    }
    if (path === "/api/permission" && method === "POST") return { ok: true };
    if (path === "/api/diff" && method === "POST") return { ok: true };
    if (path.startsWith("/api/runs/") && method === "GET") {
      const runId = decodeURIComponent(path.slice("/api/runs/".length));
      const journal = runJournals.get(runId);
      if (!journal) return { __notFound: true };
      return journal;
    }
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
    const record = json as { __notFound?: boolean; __error?: boolean; status?: number };
    const notFound = Boolean(record.__notFound);
    const errored = Boolean(record.__error);
    const status = notFound ? 404 : errored ? (record.status ?? 400) : 200;
    const payload = notFound ? { error: "not found" } : errored
      ? { error: (json as { error?: string }).error, code: (json as { code?: string }).code, retryable: (json as { retryable?: boolean }).retryable ?? false, runId: (json as { runId?: string | null }).runId ?? null }
      : json;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 200 && status < 300 ? "OK" : "Error",
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as typeof fetch;

  return {
    state,
    calls,
    fetchImpl,
    callsTo: (pathIncludes: string) => calls.filter((c) => c.path.includes(pathIncludes)),
    trustedClasses,
    runJournals,
    get nextClassSaveError() {
      return nextClassSaveError;
    },
    set nextClassSaveError(value) {
      nextClassSaveError = value;
    },
    get pendingPlanDecision() {
      return pendingPlanDecision;
    },
    set pendingPlanDecision(value: boolean) {
      pendingPlanDecision = value;
    },
  };
}

/** Minimal controllable WebSocket the app can receive server-pushed events from. */
export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  /** Hard cap so a HostSocket reconnect storm fails the test instead of filling RAM. */
  static MAX_INSTANCES = 24;
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    if (FakeWebSocket.instances.length >= FakeWebSocket.MAX_INSTANCES) {
      console.error(
        `[FakeWebSocket] aborting: ${FakeWebSocket.instances.length} sockets (reconnect storm)`,
      );
      process.exit(134);
    }
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data?: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    if (typeof data !== "string") return;
    try {
      this.sent.push(JSON.parse(data));
    } catch {
      this.sent.push(data);
    }
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    const onclose = this.onclose;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    onclose?.();
  }

  /** Test-only: push a server event as if the host emitted it over /ws. */
  emit(ev: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }

  static latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset(): void {
    for (const ws of FakeWebSocket.instances) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.readyState = FakeWebSocket.CLOSED;
    }
    FakeWebSocket.instances = [];
  }
}
