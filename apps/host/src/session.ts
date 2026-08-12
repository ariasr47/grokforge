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
import { isEffort, resolveEffort, type Effort } from "./effort.js";
import { getAgent, listAgents, resolveAgentSpawn } from "./agents.js";
import { audit } from "./audit.js";
import { clampEffort, loadPolicy } from "./policy.js";

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
  | { type: "oauth_complete"; ok: boolean; message?: string };

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
  /** Serialize restarts so concurrent mode switches don't null the client mid-start. */
  private restartChain: Promise<PublicState> | null = null;
  /** Background agent for the other mode (hover prefetch). */
  private warm: {
    mode: ProductMode;
    client: StdioAcpClient;
    sessionId: string;
    workspace: string;
  } | null = null;
  private warmInflight: Promise<void> | null = null;

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

    // Promote prefetched warm agent if it matches target mode
    if (
      this.warm &&
      this.warm.mode === next &&
      this.warm.client &&
      this.warm.sessionId
    ) {
      const old = this.client;
      this.client = this.warm.client;
      this.sessionId = this.warm.sessionId;
      this.workspace = this.warm.workspace;
      this.warm = null;
      this.cfg.mode = next;
      saveConfig(this.cfg);
      if (old) {
        try {
          await old.dispose();
        } catch {
          /* ignore */
        }
      }
      this.bindClientEvents(this.client);
      log("info", "mode set via warm agent", {
        mode: next,
        workspace: this.workspace,
      });
      audit("mode_set", { mode: next, via: "warm" });
      this.broadcastState();
      return this.getState();
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

  /** Prefetch agent for the other mode (hover). Does not change live mode. */
  async prefetchMode(mode: ProductMode): Promise<{
    ok: boolean;
    ready: boolean;
    mode: ProductMode;
  }> {
    const target = mode === "code" ? "code" : "chat";
    this.cfg = loadConfig();
    if (this.cfg.mode === target && this.client && this.sessionId) {
      return { ok: true, ready: true, mode: target };
    }
    if (this.warm?.mode === target && this.warm.sessionId) {
      return { ok: true, ready: true, mode: target };
    }
    if (this.warmInflight) {
      await this.warmInflight;
      return {
        ok: true,
        ready: Boolean(this.warm?.mode === target),
        mode: target,
      };
    }

    let workspace: string | null = null;
    if (target === "chat") {
      workspace = ensureChatRoot(this.cfg.chatRoot);
    } else if (this.cfg.lastWorkspace && fs.existsSync(this.cfg.lastWorkspace)) {
      workspace = this.cfg.lastWorkspace;
    }
    if (!workspace) {
      return { ok: true, ready: false, mode: target };
    }

    this.warmInflight = (async () => {
      try {
        if (this.warm) {
          try {
            await this.warm.client.dispose();
          } catch {
            /* ignore */
          }
          this.warm = null;
        }
        const { token } = await resolveApiKeyAsync(this.cfg);
        const { command, args } = this.agentEntry();
        const client = new StdioAcpClient({
          workspaceRoot: workspace!,
          command,
          args,
          env: {
            XAI_API_KEY: token ?? "",
            XAI_MODEL: this.cfg.model,
            GROKFORGE_MODE: target,
            GROKFORGE_SHELL_ALLOWLIST:
              this.cfg.shellAllowlist === false ? "0" : "1",
          },
        });
        // Warm agents ignore UI events (no bind to live emit)
        client.onEvent(() => undefined);
        await client.initialize();
        const sessionId = await client.newSession();
        this.warm = {
          mode: target,
          client,
          sessionId,
          workspace: workspace!,
        };
        log("info", "warm agent ready", { mode: target, workspace });
      } catch (e) {
        log("warn", "warm agent failed", {
          mode: target,
          message: e instanceof Error ? e.message : String(e),
        });
        this.warm = null;
      } finally {
        this.warmInflight = null;
      }
    })();

    await this.warmInflight;
    return {
      ok: true,
      ready: Boolean(this.warm?.mode === target),
      mode: target,
    };
  }

  private bindClientEvents(client: StdioAcpClient): void {
    const toolNames = new Map<string, string>();
    const gen = client;
    client.onEvent((ev) => {
      if (this.client !== gen) return;
      if (ev.type === "tool_request") {
        toolNames.set(ev.id, ev.name);
      }
      if (ev.type === "tool_result" && !ev.ok) {
        log("warn", "tool failed", {
          id: ev.id,
          name: toolNames.get(ev.id) || "tool",
          ...summarizeToolOutput(ev.output),
        });
      }
      if (ev.type === "done" || ev.type === "error") {
        this.setBusy(false);
        if (ev.type === "error" && ev.code === "agent_exited") {
          if (this.client === gen) {
            this.client = null;
            this.sessionId = null;
          }
        }
        this.broadcastState();
      }
      if (ev.type === "error") {
        log("error", "agent error", {
          code: ev.code,
          message: ev.message,
          detail: ev.detail,
        });
      }
      this.emit(ev);
    });
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
      // Drop warm agent — about to start a live one for current mode
      if (this.warm) {
        try {
          await this.warm.client.dispose();
        } catch {
          /* ignore */
        }
        this.warm = null;
      }
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
        if (ev.type === "done" || ev.type === "error") {
          this.setBusy(false);
          if (ev.type === "error" && ev.code === "agent_exited") {
            if (this.client === gen) {
              this.client = null;
              this.sessionId = null;
            }
          }
          this.broadcastState();
        }
        if (ev.type === "error") {
          log("error", "agent error", {
            code: ev.code,
            message: ev.message,
            detail: ev.detail,
            status: ev.status,
            sessionId: this.sessionId,
          });
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
    await this.ensureAgent();
    if (!this.client || !this.sessionId) throw new Error("Agent not connected");

    const rawSelected = isEffort(effortOverride)
      ? effortOverride
      : isEffort(this.cfg.effort)
        ? this.cfg.effort
        : "auto";
    const policy = loadPolicy();
    const selected = clampEffort(rawSelected, policy.maxEffort);
    const binding = resolveEffort(selected, this.cfg.model);
    this.appliedEffort = binding.selected;
    this.appliedModel = binding.model;
    if (binding.reasoning_effort && selected !== "auto") {
      // appliedEffort stays selected; UI uses appliedModel for honesty
    }

    this.setBusy(true);
    this.broadcastState();
    this.armBusyWatchdog();
    log("debug", "prompt", {
      len: text.length,
      sessionId: this.sessionId,
      workspace: this.workspace,
      mode,
      effort: selected,
      model: binding.model,
      reasoning_effort: binding.reasoning_effort,
      historyTurns: opts?.history?.length ?? 0,
    });
    audit("prompt", {
      mode,
      effort: selected,
      model: binding.model,
      len: text.length,
      agentId: this.cfg.agentId,
    });
    try {
      await this.client.prompt(this.sessionId, text, {
        model: binding.model,
        reasoning_effort: binding.reasoning_effort,
        history: opts?.history,
      });
    } catch (e) {
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
