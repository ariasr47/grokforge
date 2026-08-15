import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  StdioAcpClient,
  type AcpUiEvent,
  type PermissionDecision,
} from "@grokforge/acp-client";
import {
  clearAllAuth,
  loadConfig,
  publicAuthInfo,
  resolveApiKeyAsync,
  saveConfig,
  type EffortLevel,
  type HostConfig,
  type ProductMode,
} from "./config.js";
import { log, logPath } from "./log.js";
import {
  clearOAuthTokens,
  pollDeviceToken,
  startDeviceLogin,
  type DeviceStart,
} from "./oauth.js";
import { ensureChatRoot } from "./chat-root.js";
import {
  isEffort,
  modelFallbackChain,
  resolveEffort,
  type Effort,
} from "./effort.js";
import { getAgent, listAgents, resolveAgentSpawn } from "./agents.js";
import { audit } from "./audit.js";
import { clampEffort, loadPolicy } from "./policy.js";
import { recordCompletedConversation } from "./shell-history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function summarizeToolOutput(output: unknown): Record<string, unknown> {
  const raw =
    typeof output === "string"
      ? output
      : (() => {
          try {
            return JSON.stringify(output);
          } catch {
            return String(output);
          }
        })();
  const snippet = raw.slice(0, 240);
  try {
    const j = JSON.parse(typeof output === "string" ? output : raw) as Record<
      string,
      unknown
    >;
    return {
      blocked: Boolean(j.blocked),
      timed_out: Boolean(j.timed_out),
      exit_code: j.exit_code ?? null,
      error:
        typeof j.error === "string" ? j.error.slice(0, 160) : undefined,
      snippet,
    };
  } catch {
    return { snippet };
  }
}

export type BusEvent =
  | AcpUiEvent
  | { type: "state"; state: PublicState }
  | {
      type: "oauth_pending";
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
    }
  | { type: "oauth_complete"; ok: boolean; message?: string }
  /** AC8 fallback-chain notice: the effort/model actually applied differed from the request. */
  | { type: "effort_applied"; selected: EffortLevel; applied: EffortLevel; model: string };

export type Listener = (event: BusEvent) => void;

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
  recent: HostConfig["recent"];
  agentId?: string;
  agentName?: string;
  agentStatus?: string;
  shellAllowlist: boolean;
  logHint: string;
  mode: ProductMode;
  effort: EffortLevel;
  appliedEffort: EffortLevel | null;
  appliedModel: string | null;
  chatRoot: string | null;
}

export class AgentSession {
  private client: StdioAcpClient | null = null;
  private sessionId: string | null = null;
  private workspace: string | null = null;
  private busy = false;
  private busyWatchdog: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private cfg = loadConfig();
  private oauthAbort: AbortController | null = null;
  private appliedEffort: EffortLevel | null = null;
  private appliedModel: string | null = null;
  /**
   * The `Origin` header of the request that started the in-flight prompt run (SPEC §2.8 / D1,
   * INTERFACE_CONTRACT.md `priorConversations`). Recorded against `shells.json` only when the run
   * reaches `done` — an `error` run does not count as a completed conversation.
   */
  private pendingPromptOrigin: string | null = null;
  /** Serialize restarts so concurrent mode switches don't null the client mid-start. */
  private restartChain: Promise<PublicState> | null = null;
  /**
   * AC8 model-id fallback chain (SPEC §5 "Effort/model fallback"): tracks the in-flight prompt's
   * remaining model candidates so a rejected model can be retried with the next one instead of
   * dead-ending the turn. Cleared on every new prompt, cancel and restart.
   */
  private pendingFallback: {
    text: string;
    history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    models: string[];
    attemptIdx: number;
    reasoningEffort?: "low" | "medium" | "high";
    selected: Effort;
    suppressNextDone: boolean;
  } | null = null;

  constructor() {
    this.cfg = loadConfig();
    if (!this.cfg.mode) this.cfg.mode = "chat";
    if (!this.cfg.effort) this.cfg.effort = "auto";
    if (this.cfg.mode === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
    } else if (this.cfg.lastWorkspace && fs.existsSync(this.cfg.lastWorkspace)) {
      this.workspace = this.cfg.lastWorkspace;
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BusEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcastState(): void {
    this.emit({ type: "state", state: this.getState() });
  }

  getState(): PublicState {
    const auth = publicAuthInfo(this.cfg);
    const chatRoot =
      this.cfg.mode === "chat"
        ? ensureChatRoot(this.cfg.chatRoot)
        : this.cfg.chatRoot
          ? ensureChatRoot(this.cfg.chatRoot)
          : null;
    const agent = this.getAgentInfo();
    return {
      workspace: this.workspace,
      workspaceName: this.workspace ? path.basename(this.workspace) : null,
      authMode: auth.authMode,
      hasApiKey: auth.hasApiKey,
      authSource: auth.source,
      model: this.cfg.model,
      connected: Boolean(this.client),
      busy: this.busy,
      sessionId: this.sessionId,
      recent: this.cfg.recent,
      shellAllowlist: this.cfg.shellAllowlist !== false,
      logHint: logPath(),
      mode: this.cfg.mode === "code" ? "code" : "chat",
      effort: isEffort(this.cfg.effort) ? this.cfg.effort : "auto",
      appliedEffort: this.appliedEffort,
      appliedModel: this.appliedModel,
      chatRoot,
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
    };
  }

  updateSettings(patch: {
    apiKey?: string;
    model?: string;
    clearKey?: boolean;
    shellAllowlist?: boolean;
    mode?: ProductMode;
    effort?: EffortLevel;
  }): PublicState {
    this.cfg = loadConfig();
    if (patch.clearKey) {
      this.cfg = clearAllAuth(this.cfg);
    }
    if (typeof patch.apiKey === "string") this.cfg.apiKey = patch.apiKey;
    if (typeof patch.model === "string" && patch.model.trim()) {
      this.cfg.model = patch.model.trim();
    }
    if (typeof patch.shellAllowlist === "boolean") {
      this.cfg.shellAllowlist = patch.shellAllowlist;
    }
    if (isEffort(patch.effort)) this.cfg.effort = patch.effort;
    saveConfig(this.cfg);
    log("info", "settings updated", {
      hasKey: Boolean(this.cfg.apiKey),
      model: this.cfg.model,
      shellAllowlist: this.cfg.shellAllowlist,
      effort: this.cfg.effort,
    });
    if (patch.mode === "chat" || patch.mode === "code") {
      void this.setMode(patch.mode);
      return this.getState();
    }
    void this.restartAgent().catch((e) =>
      log("warn", "restart after settings failed", {
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    this.broadcastState();
    return this.getState();
  }

  async setMode(mode: ProductMode): Promise<PublicState> {
    this.cfg = loadConfig();
    const next = mode === "code" ? "code" : "chat";
    // No-op fast path: already in this mode with a live agent
    if (
      this.cfg.mode === next &&
      this.client &&
      this.sessionId &&
      this.workspace
    ) {
      return this.getState();
    }
    if (this.busy) {
      try {
        await this.cancel();
      } catch {
        /* continue */
      }
    }

    this.cfg.mode = next;
    saveConfig(this.cfg);
    audit("mode_set", { mode: next, via: "restart" });
    if (next === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
    } else {
      this.workspace =
        this.cfg.lastWorkspace && fs.existsSync(this.cfg.lastWorkspace)
          ? this.cfg.lastWorkspace
          : null;
    }
    log("info", "mode set", { mode: next, workspace: this.workspace });
    await this.restartAgent();
    this.broadcastState();
    return this.getState();
  }

  setEffort(effort: Effort): PublicState {
    if (!isEffort(effort)) throw new Error("invalid effort");
    this.cfg = loadConfig();
    this.cfg.effort = effort;
    saveConfig(this.cfg);
    log("info", "effort set", { effort });
    this.broadcastState();
    return this.getState();
  }

  async setChatRoot(pathIn: string | null): Promise<PublicState> {
    this.cfg = loadConfig();
    if (pathIn == null || pathIn === "") {
      this.cfg.chatRoot = null;
    } else {
      // AC16 / C3: relative paths are refused, never resolved against the host process CWD.
      // chatRoot is left untouched (cfg not mutated before this check).
      if (!path.isAbsolute(pathIn)) {
        throw new Error("chat root path must be absolute");
      }
      const resolved = path.resolve(pathIn);
      const st = await fsPromises.stat(resolved);
      if (!st.isDirectory()) throw new Error("Path is not a directory");
      this.cfg.chatRoot = resolved;
    }
    saveConfig(this.cfg);
    if (this.cfg.mode === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
      await this.restartAgent();
    }
    this.broadcastState();
    return this.getState();
  }

  async openWorkspace(workspacePath: string): Promise<PublicState> {
    const resolved = path.resolve(workspacePath);
    const st = await fsPromises.stat(resolved);
    if (!st.isDirectory()) throw new Error("Path is not a directory");

    this.workspace = resolved;
    this.cfg = loadConfig();
    this.cfg.lastWorkspace = resolved;
    // Opening a folder implies Code mode for workspace-centric flows
    if (this.cfg.mode !== "code") {
      this.cfg.mode = "code";
    }
    const name = path.basename(resolved);
    this.cfg.recent = [
      { name, path: resolved, openedAt: Date.now() },
      ...this.cfg.recent.filter((r) => r.path !== resolved),
    ].slice(0, 12);
    saveConfig(this.cfg);
    log("info", "workspace opened", { path: resolved, mode: this.cfg.mode });
    audit("workspace_open", { path: resolved, mode: this.cfg.mode });

    await this.restartAgent();
    this.broadcastState();
    return this.getState();
  }

  private agentEntry(): { command: string; args: string[] } {
    const root = process.env.GROKFORGE_ROOT || repoRoot;
    const agentId = this.cfg.agentId || loadPolicy().agentId || "grok-acp";
    const spec = resolveAgentSpawn(agentId, root);
    return { command: spec.command, args: spec.args };
  }

  listAgents() {
    return listAgents();
  }

  getAgentInfo() {
    const id = this.cfg.agentId || loadPolicy().agentId || "grok-acp";
    return getAgent(id);
  }

  setAgentId(agentId: string): PublicState {
    const agent = getAgent(agentId);
    if (agent.status !== "ready") {
      throw new Error(
        `${agent.name} is not available yet (${agent.status}). Grok remains the ready ACP backend.`,
      );
    }
    this.cfg = loadConfig();
    this.cfg.agentId = agent.id;
    saveConfig(this.cfg);
    audit("agent_select", { agentId: agent.id });
    void this.restartAgent();
    this.broadcastState();
    return this.getState();
  }

  async ensureAgent(): Promise<void> {
    if (this.client && this.sessionId) return;
    await this.restartAgent();
  }

  async restartAgent(): Promise<PublicState> {
    // Chain concurrent restarts so setMode + prompt don't race dispose vs newSession
    const run = async (): Promise<PublicState> => {
      // A restart always clears any in-flight fallback retry — it belongs to the client about to
      // be disposed, not the next one. Same for a stale prompt-origin attribution (D1): the
      // in-flight run's completion events are about to be dropped by the disposed client, so no
      // `done` will ever arrive to record it — clear it rather than leak it onto the next prompt.
      this.pendingFallback = null;
      this.pendingPromptOrigin = null;
      if (this.client) {
        const prev = this.client;
        this.client = null;
        this.sessionId = null;
        try {
          await prev.dispose();
        } catch {
          /* ignore */
        }
      }
      this.setBusy(false);
      this.cfg = loadConfig();
      const mode = this.cfg.mode === "code" ? "code" : "chat";
      if (mode === "chat") {
        this.workspace = ensureChatRoot(this.cfg.chatRoot);
      } else if (!this.workspace) {
        this.broadcastState();
        return this.getState();
      }

      const { token, source } = await resolveApiKeyAsync(this.cfg);
      const { command, args } = this.agentEntry();
      log("info", "starting agent", {
        source,
        workspace: this.workspace,
        mode,
      });

      const client = new StdioAcpClient({
        workspaceRoot: this.workspace!,
        command,
        args,
        env: {
          XAI_API_KEY: token ?? "",
          XAI_MODEL: this.cfg.model,
          GROKFORGE_MODE: mode,
          GROKFORGE_SHELL_ALLOWLIST:
            this.cfg.shellAllowlist === false ? "0" : "1",
        },
      });
      this.client = client;
      /** Cache tool names for result logging. */
      const toolNames = new Map<string, string>();
      const gen = client; // capture for exit handler
      client.onEvent((ev) => {
        // Ignore events from a disposed/replaced client
        if (this.client !== gen) return;
        if (ev.type === "tool_request") {
          toolNames.set(ev.id, ev.name);
          log("debug", "tool request", {
            id: ev.id,
            name: ev.name,
            sessionId: this.sessionId,
          });
        }
        if (ev.type === "tool_result") {
          const name = toolNames.get(ev.id) || "tool";
          const meta = summarizeToolOutput(ev.output);
          if (!ev.ok) {
            log("warn", "tool failed", {
              id: ev.id,
              name,
              sessionId: this.sessionId,
              ...meta,
            });
          } else {
            log("debug", "tool ok", {
              id: ev.id,
              name,
              sessionId: this.sessionId,
              ...meta,
            });
          }
        }
        if (ev.type === "permission_request") {
          log("info", "permission requested", {
            id: ev.id,
            kind: ev.kind,
            detail: ev.detail.slice(0, 200),
          });
        }
        if (ev.type === "agent_log") {
          log(ev.level === "warn" ? "warn" : "debug", "agent stderr", {
            message: ev.message.slice(0, 500),
          });
          if (ev.level !== "warn") return;
        }
        // AC8 model-id fallback chain (SPEC §5): a rejected model gets retried with the next
        // candidate instead of dead-ending the turn. Only api_error 400/404 is eligible — auth,
        // rate-limit and upstream errors would not be fixed by a different model id, and retrying
        // them would just mask the real failure. Swallows this failed attempt's error AND its
        // paired `done reason:"error"` (grok-acp always emits both) so the UI never sees the
        // intermediate dead end.
        if (ev.type === "error") {
          const pf = this.pendingFallback;
          const canFallback =
            pf !== null &&
            ev.code === "api_error" &&
            (ev.status === 400 || ev.status === 404) &&
            pf.attemptIdx < pf.models.length - 1;
          if (canFallback && pf) {
            const failedModel = pf.models[pf.attemptIdx];
            pf.attemptIdx += 1;
            const nextModel = pf.models[pf.attemptIdx];
            pf.suppressNextDone = true;
            log("warn", "model rejected — retrying with fallback model", {
              failedModel,
              nextModel,
              status: ev.status,
              detail: ev.detail,
              sessionId: this.sessionId,
            });
            this.appliedModel = nextModel;
            this.broadcastState();
            const retryClient = this.client;
            const retrySessionId = this.sessionId;
            if (retryClient && retrySessionId) {
              retryClient
                .prompt(retrySessionId, pf.text, {
                  model: nextModel,
                  reasoning_effort: pf.reasoningEffort,
                  history: pf.history,
                })
                .catch((e2) => {
                  this.pendingFallback = null;
                  this.setBusy(false);
                  const message = e2 instanceof Error ? e2.message : String(e2);
                  log("error", "fallback prompt failed", { message, sessionId: this.sessionId });
                  this.emit({ type: "error", code: "prompt_failed", message });
                  this.emit({ type: "done", reason: "error" });
                  this.broadcastState();
                });
            } else {
              this.pendingFallback = null;
              this.setBusy(false);
              this.broadcastState();
            }
            return; // do not forward — a retry is already in flight
          }
          log("error", "agent error", {
            code: ev.code,
            message: ev.message,
            detail: ev.detail,
            status: ev.status,
            sessionId: this.sessionId,
          });
        }
        if (ev.type === "done" && this.pendingFallback?.suppressNextDone) {
          // Tail of the failed attempt just superseded by a fallback retry — swallow it too.
          this.pendingFallback.suppressNextDone = false;
          return;
        }
        if (ev.type === "done" || ev.type === "error") {
          if (ev.type === "done" && ev.reason === "stop" && this.pendingFallback) {
            const pf = this.pendingFallback;
            if (pf.attemptIdx > 0) {
              // A fallback actually happened for this turn — publish the truth (AC8).
              this.emit({
                type: "effort_applied",
                selected: pf.selected,
                applied: pf.selected,
                model: pf.models[pf.attemptIdx],
              });
            }
          }
          this.pendingFallback = null;
          this.setBusy(false);
          if (ev.type === "error" && ev.code === "agent_exited") {
            if (this.client === gen) {
              this.client = null;
              this.sessionId = null;
            }
          }
          // priorConversations (SPEC §2.8 / D1): a run reaching `done` — other than one that
          // itself carries reason "error" — is a completed conversation, attributed to the
          // Origin that started it. An `error` event or a `done reason:"error"` does not count.
          if (ev.type === "done" && ev.reason !== "error" && this.pendingPromptOrigin) {
            recordCompletedConversation(this.pendingPromptOrigin);
          }
          this.pendingPromptOrigin = null;
          this.broadcastState();
        }
        if (ev.type === "done") {
          log("debug", "agent done", {
            reason: ev.reason,
            sessionId: this.sessionId,
          });
        }
        this.emit(ev);
      });

      try {
        await client.initialize();
        if (this.client !== gen) {
          // Superseded by a newer restart
          try {
            await client.dispose();
          } catch {
            /* ignore */
          }
          return this.getState();
        }
        const sid = await client.newSession();
        if (this.client !== gen) {
          try {
            await client.dispose();
          } catch {
            /* ignore */
          }
          return this.getState();
        }
        this.sessionId = sid;
        log("info", "agent session ready", {
          sessionId: this.sessionId,
          workspace: this.workspace,
          source,
          mode,
        });
      } catch (e) {
        if (this.client === gen) {
          this.client = null;
          this.sessionId = null;
        }
        log("error", "agent start failed", {
          message: e instanceof Error ? e.message : String(e),
        });
        this.emit({
          type: "error",
          code: "agent_start_failed",
          message:
            e instanceof Error
              ? e.message
              : "Failed to start agent session",
        });
      }
      this.broadcastState();
      return this.getState();
    };

    const next = (this.restartChain ?? Promise.resolve(this.getState())).then(
      () => run(),
      () => run(),
    );
    this.restartChain = next.then(
      () => this.getState(),
      () => this.getState(),
    );
    return next;
  }

  async prompt(
    text: string,
    effortOverride?: Effort,
    opts?: {
      history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      /** The request's `Origin` header (D1) — null for an absent/empty Origin (never recorded). */
      originKey?: string | null;
    },
  ): Promise<void> {
    if (this.busy) {
      throw new Error("Agent is busy — wait or Cancel before sending again");
    }
    this.cfg = loadConfig();
    const mode = this.cfg.mode === "code" ? "code" : "chat";
    if (mode === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
    } else if (!this.workspace) {
      throw new Error("Open a workspace first");
    }
    // D1 ordering (F-2): set the attribution AFTER ensureAgent()/restartAgent(), never before.
    // A cold client's restartAgent() unconditionally nulls pendingPromptOrigin (it belongs to
    // whatever run was in flight against the client being disposed) — set here, this line
    // survives that reset instead of racing behind it, so the *first* prompt after every
    // engine/agent start is still attributed to its Origin.
    await this.ensureAgent();
    this.pendingPromptOrigin = opts?.originKey ?? null;
    if (!this.client || !this.sessionId) throw new Error("Agent not connected");

    const rawSelected = isEffort(effortOverride)
      ? effortOverride
      : isEffort(this.cfg.effort)
        ? this.cfg.effort
        : "auto";
    const policy = loadPolicy();
    const selected = clampEffort(rawSelected, policy.maxEffort);
    const binding = resolveEffort(selected, this.cfg.model);
    // AC8 model-id fallback chain: binding.model leads; the rest are the fallback candidates a
    // rejected model retries through (see the `client.onEvent` handler in restartAgent()).
    const modelsChain = modelFallbackChain(binding);
    this.appliedEffort = binding.selected;
    this.appliedModel = modelsChain[0];
    this.pendingFallback = {
      text,
      history: opts?.history,
      models: modelsChain,
      attemptIdx: 0,
      reasoningEffort: binding.reasoning_effort,
      selected,
      suppressNextDone: false,
    };

    this.setBusy(true);
    this.broadcastState();
    this.armBusyWatchdog();
    log("debug", "prompt", {
      len: text.length,
      sessionId: this.sessionId,
      workspace: this.workspace,
      mode,
      effort: selected,
      model: modelsChain[0],
      fallbackModels: modelsChain.slice(1),
      reasoning_effort: binding.reasoning_effort,
      historyTurns: opts?.history?.length ?? 0,
    });
    audit("prompt", {
      mode,
      effort: selected,
      model: modelsChain[0],
      len: text.length,
      agentId: this.cfg.agentId,
    });
    try {
      await this.client.prompt(this.sessionId, text, {
        model: modelsChain[0],
        reasoning_effort: binding.reasoning_effort,
        history: opts?.history,
      });
    } catch (e) {
      this.pendingFallback = null;
      this.setBusy(false);
      this.broadcastState();
      const message = e instanceof Error ? e.message : String(e);
      log("error", "prompt failed", { message, sessionId: this.sessionId });
      this.emit({
        type: "error",
        code: "prompt_failed",
        message,
      });
      throw e;
    }
  }

  /** If agent never emits done/error, clear stuck busy (long tools still within 15m). */
  private armBusyWatchdog(ms = 15 * 60_000): void {
    this.clearBusyWatchdog();
    this.busyWatchdog = setTimeout(() => {
      this.busyWatchdog = null;
      if (!this.busy) return;
      log("warn", "busy watchdog fired — clearing stuck busy");
      this.busy = false;
      this.broadcastState();
      this.emit({
        type: "error",
        code: "busy_timeout",
        message:
          "Agent run timed out waiting for completion. Try Cancel or Restart agent.",
      });
    }, ms);
  }

  private clearBusyWatchdog(): void {
    if (this.busyWatchdog) {
      clearTimeout(this.busyWatchdog);
      this.busyWatchdog = null;
    }
  }

  private setBusy(next: boolean): void {
    if (!next) this.clearBusyWatchdog();
    this.busy = next;
  }

  async cancel(): Promise<void> {
    log("info", "cancel requested");
    this.pendingFallback = null;
    if (this.client) {
      try {
        await this.client.cancel();
      } catch (e) {
        log("warn", "cancel failed, hard restart", {
          message: e instanceof Error ? e.message : String(e),
        });
        await this.restartAgent();
      }
    }
    this.setBusy(false);
    this.broadcastState();
  }

  async permission(id: string, decision: PermissionDecision): Promise<void> {
    if (!this.client) throw new Error("Agent not connected");
    await this.client.respondPermission(id, decision);
  }

  async diffAction(id: string, action: "accept" | "reject"): Promise<void> {
    if (!this.client) throw new Error("Agent not connected");
    await this.client.respondEdit(id, action, this.sessionId ?? undefined);
  }

  async startOAuth(): Promise<DeviceStart> {
    this.oauthAbort?.abort();
    this.oauthAbort = new AbortController();
    const start = await startDeviceLogin();
    this.emit({
      type: "oauth_pending",
      user_code: start.user_code,
      verification_uri: start.verification_uri,
      verification_uri_complete: start.verification_uri_complete,
    });
    // Poll in background
    void (async () => {
      try {
        await pollDeviceToken(
          start.device_code,
          start.interval,
          this.oauthAbort?.signal,
        );
        this.emit({ type: "oauth_complete", ok: true });
        await this.restartAgent();
        this.broadcastState();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log("warn", "oauth failed", { message });
        this.emit({ type: "oauth_complete", ok: false, message });
      }
    })();
    return start;
  }

  cancelOAuth(): void {
    this.oauthAbort?.abort();
    this.oauthAbort = null;
  }

  logoutOAuth(): PublicState {
    clearOAuthTokens();
    this.cfg = loadConfig();
    this.cfg.apiKey = "";
    saveConfig(this.cfg);
    void this.restartAgent().catch(() => undefined);
    this.broadcastState();
    return this.getState();
  }
}
