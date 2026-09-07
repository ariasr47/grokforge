import { callDesktop } from "./desktopBridge";
import { INHERITED_DEFAULT_MODEL, KNOWN_MODEL_IDS } from "../../../../packages/model-catalog/src/index";
export { INHERITED_DEFAULT_MODEL };
export const MODEL_PRESETS = [...KNOWN_MODEL_IDS];

export class ApiError extends Error {
  status: number; code: string; runId: string | null; activeRunId?: string; activity?: unknown;
  constructor(status: number, body: { error?: string; code?: string; runId?: string | null; activeRunId?: string; activity?: unknown }) {
    super(body.error || `Host request failed (${status})`); this.name = "ApiError";
    this.status = status; this.code = body.code || "unknown"; this.runId = body.runId ?? null; this.activeRunId = body.activeRunId; this.activity = body.activity;
  }
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

// `import.meta.env` is a Vite-injected surface; outside a Vite build (e.g. the
// component test harness running under plain Node) it is undefined, so every
// read below is defensive (`?.`) rather than assuming Vite is present.
type ViteEnv = Record<string, string | boolean | undefined>;
function viteEnv(): ViteEnv {
  return (import.meta as unknown as { env?: ViteEnv }).env ?? {};
}

/** Channel: prod (stable) vs dev (side-by-side). Injected by Vite for dev. */
export function appChannel(): "prod" | "dev" {
  const c = String(viteEnv().VITE_GROKFORGE_CHANNEL || "prod").toLowerCase();
  if (c === "dev" || c === "tst" || c === "test" || c === "qa") return "dev";
  return "prod";
}

/** User-facing channel label (DEV / TST / empty for prod). */
export function channelBadge(): string | null {
  const raw = String(
    viteEnv().VITE_GROKFORGE_CHANNEL_LABEL ||
      viteEnv().VITE_GROKFORGE_CHANNEL ||
      "prod",
  ).toLowerCase();
  if (raw === "tst" || raw === "test" || raw === "qa") return "TST";
  if (raw === "dev" || raw === "development") return "DEV";
  if (appChannel() === "dev") return "DEV";
  return null;
}

/**
 * Channel label mirroring `apps/host/src/channel.ts::channelLabel()`
 * exactly — unlike `channelBadge()` (which returns `null` for prod so the
 * topbar badge chip hides itself) this is never `null`: "PROD" is the
 * correct value for a prod build wherever build identity is being reported
 * (`Details`, diagnostics), never for badge visibility.
 */
export function buildIdentityChannelLabel(): string {
  const raw = String(
    viteEnv().VITE_GROKFORGE_CHANNEL_LABEL ||
      viteEnv().VITE_GROKFORGE_CHANNEL ||
      "prod",
  ).toLowerCase();
  if (raw === "tst" || raw === "test" || raw === "qa") return "TST";
  if (raw === "dev" || raw === "development") return "DEV";
  return appChannel() === "dev" ? "DEV" : "PROD";
}

/** Test-only: replace the Tauri app-version lookup used by
 *  `localBuildIdentity()` without needing a real Tauri IPC transport (the
 *  jsdom test harness has no `window.__TAURI_INTERNALS__.invoke`). Mirrors
 *  the `setDesktopBridge` seam for the other IPC boundary. */
let appVersionResolver: (() => Promise<string>) | null = null;
export function setAppVersionResolver(fn: (() => Promise<string>) | null): void {
  appVersionResolver = fn;
}

export interface BuildIdentity {
  version?: string;
  channel: string;
  channelLabel: string;
}

/**
 * QA GATE Q N-2 (AC-S8) + N-3 — build identity sourced from the running
 * executable and compile-time constants, **never from a fetch to
 * `hostPort()`**. This exists because `LaunchFailureCard`'s `Details` and
 * the diagnostics export need build identity in exactly the states where
 * `GET /api/health` cannot be trusted: either nothing answers at all (every
 * failure class that renders a full-screen card), or — before the N-3 fix —
 * a *foreign* engine on the fallback port answers instead and reports
 * *its* identity, not this install's. `channel`/`channelLabel` are
 * compile-time (no IO at all); `version` is Tauri's own `core:app` command
 * (`getVersion()`, bundled `tauri.conf.json` version) — already covered by
 * the `core:default` capability, no custom Rust and no network needed. In
 * the browser-dev path (`!isTauri()`) there is no such IPC, so `version` is
 * left undefined there — that path is never the packaged build AC-S8 is
 * about.
 */
export async function localBuildIdentity(): Promise<BuildIdentity> {
  const channel = appChannel();
  const channelLabel = buildIdentityChannelLabel();
  if (!isTauri()) return { channel, channelLabel };
  try {
    const version = appVersionResolver
      ? await appVersionResolver()
      : await (await import("@tauri-apps/api/app")).getVersion();
    return { version, channel, channelLabel };
  } catch {
    return { channel, channelLabel };
  }
}

/**
 * In a packaged build the port is NOT a build-time constant
 * (INTERFACE_CONTRACT.md): the launcher walks the port ladder and publishes
 * the resolved value over the Tauri IPC boundary. This module consumes that
 * value in a packaged run instead of `VITE_GROKFORGE_PORT`; the browser/dev
 * path (Vite proxy / env var) is unchanged.
 */
let runtimePort: number | null = null;
export function setRuntimePort(port: number | null): void {
  runtimePort = port;
}

/**
 * QA GATE Q N-3 (SPEC §2.5 `instance-ownership-attach`, non-cuttable): in a
 * packaged/Tauri build there is exactly one trustworthy source for the port
 * — the launcher's own IPC value (`runtimePort`, set from
 * `DesktopHostStatus.port`). A launcher failure that supplies `port: null`
 * (`entry_missing`, `runtime_missing`, `health_timeout`, `port_unavailable`
 * with an exhausted ladder…) means NO ENGINE, full stop. Falling back to the
 * compile-time default port here is exactly the bug: any prod engine
 * already sitting on that port — a second install, an orphaned host, the
 * operator's own `npm run start` (SPEC §2.5 names this the normal loop) —
 * would silently become "this app's engine". `null` is returned instead so
 * every caller (`hostBase`, `wsUrl`, `json`) refuses to talk to anything
 * rather than guessing.
 *
 * The **development-browser path is unaffected**: `isTauri()` is false
 * there (no launcher exists at all), so the `VITE_GROKFORGE_PORT` / default
 * fallback below still applies — that path targets a from-source host
 * started the ordinary way, not a foreign packaged engine.
 */
export function hostPort(): number | null {
  if (runtimePort != null && Number.isFinite(runtimePort) && runtimePort > 0) {
    return runtimePort;
  }
  if (isTauri()) return null;
  const fromEnv = Number(viteEnv().VITE_GROKFORGE_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return appChannel() === "dev" ? 8788 : 8787;
}

/** True when this document is the Vite `desktop:dev` / `npm run dev` origin.
 *  Packaged `http://tauri.localhost` is not this. Used so a Tauri webview that
 *  lost IPC (127.0.0.1 vs localhost:5174) can still use the same-origin proxy. */
export function isViteDevOrigin(href?: string): boolean {
  const raw =
    href ?? (typeof window !== "undefined" ? window.location?.href ?? "" : "");
  try {
    const u = new URL(raw);
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return false;
    return u.port === "5173" || u.port === "5174";
  } catch {
    return false;
  }
}

/** API base: always absolute in Tauri; Vite proxy in browser dev. `null`
 *  when packaged/Tauri and `hostPort()` has nothing to offer — see
 *  `hostPort()`'s N-3 note. Callers must not fetch when this is `null`. */
export function hostBase(): string | null {
  const env = viteEnv().VITE_HOST_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  const port = hostPort();
  if (isTauri()) {
    if (port != null) return `http://127.0.0.1:${port}`;
    // desktop:dev: Vite already proxies /api. Do not paint "couldn't reach
    // its engine" when the proxy is 200 but ensure_host IPC is denied
    // (localhost vs 127.0.0.1). Packaged tauri.localhost is not this path.
    if (isViteDevOrigin()) return "";
    return null;
  }
  // Browser dev: Vite proxies /api and /ws to the channel host
  if (viteEnv().DEV) return "";
  return `http://127.0.0.1:${port}`;
}

export function wsUrl(): string | null {
  const base = hostBase();
  if (base == null) return null;
  if (base) return base.replace(/^http/, "ws") + "/ws";
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  }
  return `ws://127.0.0.1:${hostPort()}/ws`;
}

export type ProductMode = "chat" | "code";
export type EffortLevel = "auto" | "fast" | "expert" | "heavy";

/** Session-scoped next-send preference. Bound as PublicState.planEngagement. */
export type PlanEngagementView = {
  engaged: boolean;
  vouched: boolean;
};

/** Workspace recipe presence for the bound root. Bound as PublicState.projectInstructions. */
export type ProjectInstructionsPresenceView = {
  status: "present" | "absent" | "failed";
  path: string | null;
  vouched: boolean;
};

/**
 * Host-vouched Code-agent identity on GET /api/state / WS state.
 * Always present on a current host (`null` in Chat). Optional so older hosts
 * can omit it — composer treats missing as checking, never PATH-guesses vendor.
 */
export type CodeAgentFact = {
  resolveStatus: "resolving" | "ready" | "hard_fail";
  identity: "vendor" | "fallback" | "house" | "hard_fail" | null;
  fallbackReason: "cli_missing" | "spawn_failed" | null;
};

/** Host-vouched slash/skills catalog on GET /api/state / WS state. */
export type SkillsCatalogCommand = {
  name: string;
  description: string | null;
};

/** Closed child-work status — never unconfirmed / stuck. */
export type ChildAgentStatus = "running" | "done" | "failed";

export type ChildAgentMember = {
  childId: string;
  identityLabel: string;
  status: ChildAgentStatus;
  firstEventSeq: number;
};

/**
 * Host-visible membership eligibility/hydration for Child agents chrome.
 * Always present on a current host. Optional so older hosts can omit it.
 * Missing → treat as unvouched absent chrome; never invent members.
 */
export type ChildAgentsMembershipFact = {
  disposition:
    | "absent_non_code_or_non_vendor"
    | "hydrating"
    | "ready"
    | "obtain_failed";
  members: ChildAgentMember[] | null;
};

/** Closed Browser chip statuses — never unconfirmed / stuck. */
export type BrowserWorkChipStatus = "running" | "done" | "failed";

export type BrowserWorkMember = {
  toolCallId: string;
  /** Class voucher — must be literal "fetch" for Browser rows. */
  acpToolKind: "fetch";
  url: string | null;
  title: string | null;
  status: BrowserWorkChipStatus | null;
  snapshotJournaled: boolean;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

/**
 * Host-visible membership eligibility/hydration for Browser chrome.
 * Always present on a current host. Optional so older hosts can omit it.
 * Missing → treat as unvouched absent chrome; never invent members.
 * Disposition token includes `for_` (differs from childAgents).
 */
export type BrowserWorkMembershipFact = {
  disposition:
    | "absent_for_non_code_or_non_vendor"
    | "hydrating"
    | "ready"
    | "obtain_failed";
  members: BrowserWorkMember[] | null;
};

/** Closed MCP chip statuses — never unconfirmed / disconnected / stuck. */
export type McpServerStatus = "connected" | "idle" | "error";

export type McpServerMember = {
  serverId: string;
  name: string | null;
  status: McpServerStatus | null;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

/**
 * Disposition token includes `for_` (matches Browser; differs from childAgents).
 * Shell MCP reads mcpServers.members only.
 */
export type McpServersMembershipFact = {
  disposition:
    | "absent_for_non_code_or_non_vendor"
    | "hydrating"
    | "ready"
    | "obtain_failed";
  members: McpServerMember[] | null;
};

/** Closed Hooks chip statuses — never unconfirmed / stuck / connected/error. */
export type HookStatus = "running" | "idle" | "done" | "failed";

export type HookMember = {
  hookId: string;
  name: string | null;
  status: HookStatus | null;
  restore: "restored" | "unrestorable";
  firstEventSeq: number;
};

/**
 * Disposition token includes `for_` (matches Browser/MCP; differs from childAgents).
 * Shell Hooks reads hooks.members only.
 */
export type HooksMembershipFact = {
  disposition:
    | "absent_for_non_code_or_non_vendor"
    | "hydrating"
    | "ready"
    | "obtain_failed";
  members: HookMember[] | null;
};

export type SkillsCatalogFact = {
  disposition:
    | "absent_non_vendor"
    | "awaiting_first_valid"
    | "ready"
    | "obtain_failed";
  commands: SkillsCatalogCommand[] | null;
};

/** Run-scoped handoff stamp. Never invent `consumed` client-side. */
export type SkillHandoffProvenance = {
  kind: "consumed" | "none";
  name: string | null;
};

/** Pre-send / hydrate Chat pack view. Bound as PublicState.chatPack — always present on a current host. */
export type ChatPackLastAttempt = "ok" | "pin_failed" | "note_failed" | "hydrate_failed";

export type ChatPackView = {
  conversationId: string | null;
  vouched: boolean;
  confirmFailed: boolean;
  members: { files: Array<{ path: string }>; note: string | null };
  lastAttempt: ChatPackLastAttempt;
};

export type ChatPackMutation = {
  sessionId: string;
  conversationId: string;
} & (
  | { action: "pin_file"; path: string }
  | { action: "unpin_file"; path: string }
  | { action: "set_note"; note: string }
  | { action: "clear_note" }
  | { action: "clear_pack" }
  | {
      action: "hydrate";
      members: { files: Array<{ path: string }>; note: string | null };
    }
);

export const CODE_CHAT_PACK_VIEW: ChatPackView = {
  conversationId: null,
  vouched: true,
  confirmFailed: false,
  members: { files: [], note: null },
  lastAttempt: "ok",
};

export function emptyChatPackView(conversationId: string | null = null): ChatPackView {
  return {
    conversationId,
    vouched: false,
    confirmFailed: false,
    members: { files: [], note: null },
    lastAttempt: "ok",
  };
}

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
  /** GET /api/state — INTERFACE_CONTRACT.md `priorConversations`. Origin-keyed
   *  signal: true when THIS shell's engine data root has at least one
   *  completed conversation. Outlives the WebView localStorage partition, so
   *  a wiped/re-keyed partition cannot masquerade as a genuine first run
   *  (SPEC §2.8, AC12b/AC12d/AC12e). Absent on older hosts -> undefined,
   *  treated as "unknown" (never as a false first-run signal) by callers. */
  priorConversations?: boolean;
  permissionPolicy?: {
    status: "confirmed";
    workspace: string;
    storedMode: "review" | "trusted_workspace" | null;
    effectiveMode: "review" | "trusted_workspace";
    source: "default" | "saved" | "fallback";
    revision: string;
    fallbackReason: "missing" | "invalid" | "unreadable" | null;
    savedForWorkspace: boolean;
  };
  bypassPermissions?: {
    unlocked: boolean;
    available: boolean;
    activeForSession: boolean;
    blockedReason: "managed_disabled" | "local_attestation_required" | "unlock_required" | null;
    confirmationVersion: number | null;
  };
  shellCapability: ShellCapabilityView;
  /**
   * Always present on a current host. Optional on the type so older hosts /
   * restore holes can omit it. Projection treats missing as unvouched —
   * never invent `{ engaged: false, vouched: true }`.
   */
  planEngagement?: PlanEngagementView;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing field → composer treats as unvouched / loading — never invents a path.
   */
  projectInstructions?: ProjectInstructionsPresenceView;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing field → composer treats as checking — never invents members.
   */
  chatPack?: ChatPackView;
  /**
   * Always present on a current host (`null` in Chat). Optional so older hosts
   * can omit it. Missing → Code composer checking; never invent vendor from
   * `agentName` / PATH.
   */
  codeAgent?: CodeAgentFact | null;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing → no Skills palette; never invent catalog rows.
   */
  skillsCatalog?: SkillsCatalogFact;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing → treat as unvouched absent chrome; never invent members.
   * Eligibility keys off `codeAgent`, not `connected` alone.
   */
  childAgents?: ChildAgentsMembershipFact;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing → treat as unvouched absent; never invent browses.
   * Shell Browser reads browserWork.members only.
   */
  browserWork?: BrowserWorkMembershipFact;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing → treat as unvouched absent; never invent servers.
   * Shell MCP reads mcpServers.members only — no second journal roster.
   */
  mcpServers?: McpServersMembershipFact;
  /**
   * Always present on a current host. Optional so older hosts can omit it.
   * Missing → treat as unvouched absent; never invent hooks.
   * Shell Hooks reads hooks.members only — no second journal roster.
   */
  hooks?: HooksMembershipFact;
}

export type ShellCapabilityView =
  | {
      status: "available";
      platform: string;
      osFamily: "windows" | "macos" | "linux";
      executable: string;
      displayName: string;
      dialect: "cmd" | "posix";
      reasonCode: null;
      reason: null;
    }
  | {
      status: "unavailable";
      platform: string;
      osFamily: "windows" | "macos" | "linux" | "unsupported";
      executable: null;
      displayName: null;
      dialect: null;
      reasonCode: "shell_resolution_failed" | "unsupported_platform";
      reason: string;
    };

/**
 * INTERFACE_CONTRACT.md "Which surfaces carry it, and what a response that
 * omits it means" / SPEC.md §2.8 property 4 (GATE Q pass 1j finding N-8).
 *
 * The engine's state object has exactly one origin-aware builder, and every
 * response whose body is that shape carries every field the builder knows —
 * but a per-requester field (today, `priorConversations`) exists only where
 * that builder ran, so an older or not-yet-updated endpoint can still answer
 * with a state-shaped body that simply omits it. The contract's rule for a
 * consumer is explicit: an absent field is not an answer about that field —
 * not `false`, not "unknown", and never a reason to blank a value already
 * held. This function is the ONE place that turns a state-bearing response
 * into the shell's held state, so that rule is enforced structurally rather
 * than re-implemented (or forgotten) at each of the eight-and-counting call
 * sites: it merges the payload's OWN properties onto whatever the shell
 * already holds, and a property the payload does not carry — whether
 * because `JSON.parse` never materialized the key, or because it was
 * explicitly serialized as `undefined` — leaves the held value untouched.
 *
 * `prev == null` (nothing held yet, e.g. the very first response of the
 * session) has nothing to preserve, so the payload is returned as-is.
 */
export function mergeState(
  prev: PublicState | null,
  payload: PublicState,
): PublicState {
  if (prev == null) return payload;
  const merged: PublicState = { ...prev };
  for (const key of Object.keys(payload) as Array<keyof PublicState>) {
    const value = payload[key];
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export interface AgentDescriptor {
  id: string;
  name: string;
  provider: string;
  status: "ready" | "planned" | "disabled";
  description: string;
}

export type ServerEvent =
  | import("../projections/runReducer").RunEventEnvelope
  | { type: "state"; state: PublicState }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | {
      type: "run_phase";
      phase: "waiting_model" | "reasoning" | "tools" | "writing" | "done";
      detail?: string;
    }
  | ToolRunEvent
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
      id: string;
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

export type ToolReasonCode =
  | "shell_resolution_failed"
  | "unsupported_platform"
  | "shell_dialect_incompatible"
  | "leading_command_unresolved";

export type TrustedCommandClassId =
  | "npm"
  | "npx"
  | "cargo"
  | "git:status"
  | "git:diff"
  | "git:log"
  | "git:show";

export type TrustedCommandClassCatalogEntry = {
  id: TrustedCommandClassId;
  label: string;
};

export type TrustedCommandClassesFallbackReason = "missing" | "invalid" | "unreadable" | null;

export type TrustedCommandClassesView = {
  status: "confirmed";
  workspace: string;
  classes: TrustedCommandClassId[];
  revision: string;
  source: "saved" | "fallback";
  fallbackReason: TrustedCommandClassesFallbackReason;
  savedForWorkspace: boolean;
  catalog: TrustedCommandClassCatalogEntry[];
};

export type AutomaticEligibility =
  | "read"
  | "fixed_inspection"
  | "text_edit"
  | "bypass"
  | "trusted_command_class"
  | "not_eligible";

export type ToolRunEvent = {
  schemaVersion: 2;
  type: "tool_run";
  activityId: string;
  toolCallId: string;
  lifecycle: "pending" | "terminal";
  execution: null | "executed" | "not_executed";
  status: "running" | "succeeded" | "failed" | "rejected";
  name: string | null;
  input: unknown | null;
  summary: string | null;
  title?: string | null;
  command: string | null;
  output: string | null;
  error: string | null;
  reasonCode: ToolReasonCode | null;
  reason: string | null;
  shellDisplayName: string | null;
  detailAvailable: boolean;
  automaticEligibility?: AutomaticEligibility;
  autoApplied?: boolean;
};

/**
 * Launcher -> shell boundary (INTERFACE_CONTRACT.md "Launcher → shell
 * boundary"). The shell consumes ALL of it — `message` is free text for the
 * `Details` disclosure and diagnostics only, never a headline or body copy
 * (AC-U4 bans developer tokens from rendered surfaces).
 */
export type LaunchPhase = "starting" | "ready" | "failed";
export type LaunchReason =
  | "entry_missing"
  | "runtime_missing"
  | "port_unavailable"
  | "health_timeout"
  | "crashed"
  | "origin_refused"
  | "foreign_host"
  | "unknown";

export interface DesktopHostStatus {
  ok: boolean;
  phase: LaunchPhase;
  /** True when this launcher spawned the listener. Always true in a packaged
   *  prod build (instance ownership, SPEC §2.5); false is dev-shell-only. */
  owned: boolean;
  port: number | null;
  pid: number | null;
  reason: LaunchReason | null;
  osError: number | null;
  message: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const base = hostBase();
  if (base == null) {
    // N-3 — packaged build, no launcher-published port: there is no engine
    // to reach. Refusing here (rather than guessing a port) is the fix; see
    // `hostPort()`.
    throw new Error("No engine: the launcher has not published a port");
  }
  const res = await fetch(`${base}${path}`, {
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
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return (body ?? ({} as T)) as T;
}

export const api = {
  health: () =>
    json<{
      ok: boolean;
      service?: string;
      version?: string;
      channel?: string;
      channelLabel?: string;
      port?: number;
      dataDir?: string;
      log?: string;
      pid?: number;
      installerSha256: string | null;
    }>("/api/health"),
  state: () => json<PublicState>("/api/state"),
  runState: (runId: string, sessionId: string, after = 0) => json<{ run: import("../projections/runReducer").RunSnapshot; events: import("../projections/runReducer").RunEventEnvelope[] }>(`/api/runs/${encodeURIComponent(runId)}?sessionId=${encodeURIComponent(sessionId)}&after=${after}`),
  promptRun: (body: {
    sessionId: string;
    conversationId: string;
    text: string;
    effort?: EffortLevel;
    history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    skillHandoff?: { name: string } | null;
  }) => json<{ accepted: boolean; run: import("../projections/runReducer").RunSnapshot }>("/api/prompt", { method: "POST", body: JSON.stringify(body) }),
  chatPack: (body: ChatPackMutation) =>
    json<PublicState>("/api/chat-pack", { method: "POST", body: JSON.stringify(body) }),
  cancelRun: (sessionId: string, runId: string) => json<{ accepted: boolean; run: import("../projections/runReducer").RunSnapshot }>("/api/cancel", { method: "POST", body: JSON.stringify({ sessionId, runId }) }),
  workspacePolicy: (workspace: string) => json<{ policy: Record<string, unknown> }>(`/api/workspace-policy?workspace=${encodeURIComponent(workspace)}`),
  saveWorkspacePolicy: (body: { sessionId: string; workspace: string; mode: "review" | "trusted_workspace" }) => json<{ policy: Record<string, unknown> }>("/api/workspace-policy", { method: "POST", body: JSON.stringify(body) }),
  trustedCommandClassCatalog: () =>
    json<{ catalog: TrustedCommandClassCatalogEntry[] }>(
      "/api/trusted-command-class-catalog",
    ),
  trustedCommandClasses: (workspace: string) =>
    json<{ classes: TrustedCommandClassesView }>(
      `/api/trusted-command-classes?workspace=${encodeURIComponent(workspace)}`,
    ),
  saveTrustedCommandClasses: (body: {
    sessionId: string;
    workspace: string;
    classes: TrustedCommandClassId[];
    expectedRevision: string;
  }) =>
    json<{ classes: TrustedCommandClassesView }>("/api/trusted-command-classes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sessionPermissionMode: (body: { sessionId: string; mode: "workspace" | "bypass_permissions"; activationToken?: string }) => json<{ sessionId: string; effectivePermissionMode: string; bypassPermissions: Record<string, unknown> }>("/api/session-permission-mode", { method: "POST", body: JSON.stringify(body) }),
  runPermission: (body: { sessionId: string; runId: string; requestId: string; invocationId: string; decision: "allow_once" | "allow_session" | "deny" }) => json<{ ok: boolean }>("/api/permission", { method: "POST", body: JSON.stringify(body) }),
  runDiff: (body: { sessionId: string; runId: string; requestId: string; invocationId: string; editId: string; action: "accept" | "reject" }) => json<{ ok: boolean }>("/api/diff", { method: "POST", body: JSON.stringify(body) }),
  editRecovery: (body: { sessionId: string; runId: string; editId: string }) => json<{ ok: boolean; activity: unknown }>("/api/edit-recovery", { method: "POST", body: JSON.stringify(body) }),
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
  setPlanEngagement: (engaged: boolean, sessionId?: string | null) =>
    json<PublicState>("/api/plan-engagement", {
      method: "POST",
      body: JSON.stringify(sessionId ? { engaged, sessionId } : { engaged }),
    }),
  runPlan: (body: {
    sessionId: string;
    runId: string;
    requestId: string;
    invocationId: string;
    connectionGeneration: number;
    action: "accept" | "keep_planning";
  }) =>
    json<{ ok: boolean }>("/api/plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setChatRoot: (path: string | null) =>
    json<PublicState>("/api/chat-root", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
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

function browserFallbackStatus(ok: boolean, message: string): DesktopHostStatus {
  // The browser dev path has no launcher IPC to consult — synthesize the
  // full shape rather than a partial one so every caller (App.tsx, the
  // failure-card mapping) can rely on the shape being complete everywhere.
  return {
    ok,
    phase: ok ? "ready" : "failed",
    owned: false,
    port: null,
    pid: null,
    reason: ok ? null : "health_timeout",
    osError: null,
    message,
  };
}

function invokeFailureStatus(e: unknown): DesktopHostStatus {
  return {
    ok: false,
    phase: "failed",
    owned: false,
    port: null,
    pid: null,
    reason: "unknown",
    osError: null,
    message: e instanceof Error ? e.message : String(e),
  };
}

/** Desktop: ask Tauri's launcher to ensure the engine is up. Browser: poll
 *  health only. Ordering note (INTERFACE_CONTRACT.md / PLAN F1): the runtime
 *  port is published here, before the caller's first health poll — a caller
 *  that reads `hostPort()` before this resolves would still hit the stale
 *  build-time constant. */
export async function ensureDesktopHost(): Promise<DesktopHostStatus> {
  if (isTauri()) {
    try {
      const status = await callDesktop<DesktopHostStatus>("ensure_host");
      setRuntimePort(status.port);
      return status;
    } catch (e) {
      return invokeFailureStatus(e);
    }
  }
  try {
    await api.health();
    return browserFallbackStatus(true, "Host healthy");
  } catch (e) {
    return browserFallbackStatus(
      false,
      e instanceof Error ? e.message : "Host offline",
    );
  }
}

export async function restartDesktopHost(): Promise<DesktopHostStatus> {
  if (isTauri()) {
    try {
      const status = await callDesktop<DesktopHostStatus>("restart_host");
      setRuntimePort(status.port);
      return status;
    } catch (e) {
      return invokeFailureStatus(e);
    }
  }
  try {
    await api.restart();
    return browserFallbackStatus(true, "Agent restarted");
  } catch (e) {
    return browserFallbackStatus(false, e instanceof Error ? e.message : String(e));
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
  private cursors: Array<{ sessionId: string; runId: string; afterEventSeq: number }> = [];
  private cursorKey = "";

  constructor(opts?: { onStatus?: (connected: boolean) => void }) {
    this.onStatus = opts?.onStatus;
  }

  connect(): void {
    this.closed = false;
    this.detachSocket();
    const url = wsUrl();
    if (url == null) {
      // N-3 — no launcher-published port: nothing to connect to. Retry
      // later rather than guessing a port (this only fires transiently;
      // App only constructs a HostSocket once `boot === "ready"`, i.e.
      // once a real port is already known).
      this.onStatus?.(false);
      this.scheduleReconnect();
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.attempt = 0;
      if (this.cursors.length) socket.send(JSON.stringify({ type: "resume_runs", cursors: this.cursors }));
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

  resume(cursors: Array<{ sessionId: string; runId: string; afterEventSeq: number }>): void {
    const key = JSON.stringify(cursors);
    if (key === this.cursorKey) return;
    this.cursorKey = key;
    this.cursors = cursors;
    this.send({ type: "resume_runs", cursors });
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
