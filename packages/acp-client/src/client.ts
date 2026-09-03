import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { isValidToolRunEvent } from "./types.js";
import { vendorUpdateImpliesNonZeroExit } from "./vendorShellExit.js";
import type {
  AcpClient,
  AcpUiEvent,
  AgentSpawnConfig,
  PermissionDecision,
  PromptOptions,
  AcpOwnership,
} from "./types.js";
import {
  NAMED_MCP_JSONRPC_SERVERS_UPDATED,
  NAMED_MCP_JSONRPC_STATUS,
  parseVendorMcpStatusParams,
} from "./mcpAdvertisement.js";
import {
  NAMED_HOOKS_CHANGED_KIND,
  NAMED_HOOKS_EXECUTION_KIND,
  NAMED_HOOKS_JSONRPC_LIST,
  NAMED_HOOKS_JSONRPC_METHOD,
  parseVendorHookExecutionParams,
  parseVendorHooksListResult,
} from "./hooksAdvertisement.js";

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** Handshake / permission RPCs. `session/prompt` is not on this clock. */
export const ACP_RPC_TIMEOUT_MS = 120_000;
/** Vendor `session/prompt` stays open until the child returns or exits — wall clock must not stall a live turn. */
export const ACP_PROMPT_RPC_TIMEOUT_MS = 0;

/** Vendor reverse-RPC that parks until the client answers plan approval. */
export const VENDOR_EXIT_PLAN_METHODS = ["_x.ai/exit_plan_mode", "x.ai/exit_plan_mode"] as const;

/**
 * Vendor grok agent shell has no workingDirectory parameter (model will
 * otherwise run subdirectory commands at workspace root first and fail).
 * Appended on vendor `session/new` `_meta.rules`. grok-acp is not sent this.
 */
export const VENDOR_ACP_SHELL_CWD_RULE =
  "The shell tool has no workingDirectory. Commands run at the workspace root. When the user names a subdirectory (apps/shell, apps/host, packages/...), the FIRST shell command must be Set-Location DIR; then the command in the SAME invocation. Example: Set-Location apps/shell; node --test src/markdown.parse.test.ts. Never run the relative path at workspace root first — that attempt always fails.";

/**
 * ACP stdio host client.
 * Spawns one agent subprocess per client instance (one per active thread in v1).
 */
type AcpPermissionOption = { optionId: string; kind?: string; name?: string };

export class StdioAcpClient implements AcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    JsonRpcId,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private handlers = new Set<(event: AcpUiEvent) => void>();
  /** When true, process exit is expected (dispose) — do not emit agent_exited. */
  private closing = false;
  private activeOwnership: AcpOwnership | null = null;
  private rl: Interface | null = null;
  private pendingAcpRequestIds = new Map<
    string,
    { rawId: JsonRpcId; options: AcpPermissionOption[] }
  >();
  private vendorToolCalls = new Map<
    string,
    {
      name: string;
      input: unknown;
      command: string | null;
      acpToolKind: string | null;
      url: string | null;
      title: string | null;
      snapshotJournaled: boolean;
      path: string | null;
    }
  >();
  /** After a vendor tool, the next thought/message chunk starts a new paragraph. */
  private thoughtBreakAfterTool = false;
  private messageBreakAfterTool = false;
  private lastThoughtText = "";
  private lastMessageText = "";
  /** First-seen workspace file body, so overwrite diffs have a before-image. */
  private writeBaselines = new Map<string, string | null>();

  constructor(private readonly config: AgentSpawnConfig) {}

  onEvent(handler: (event: AcpUiEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: AcpUiEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        /* isolate UI handlers */
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.child) return;

    const command = this.config.command;
    const winCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    // Node CreateProcess cannot launch .cmd/.bat without a shell (EINVAL).
    // Live vendor on Windows is grok.exe — shell stays off. Test shims are .cmd.
    this.child = spawn(command, this.config.args, {
      cwd: this.config.workspaceRoot,
      env: Object.fromEntries(Object.entries(this.config.env).filter(([key]) => key !== "GROKFORGE_BYPASS_SECRET")),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: winCmd,
    }) as ChildProcessWithoutNullStreams;

    this.child.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf8").trim();
      if (!msg) return;
      // Stderr is often noisy diagnostics — never treat as fatal UI error.
      this.emit({
        type: "agent_log",
        level: "debug",
        message: msg.slice(0, 2000),
      });
    });

    this.child.on("exit", (code, signal) => {
      this.rl?.close();
      this.rl = null;
      for (const [, p] of this.pending) {
        p.reject(new Error(`Agent exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      this.child = null;
      // Intentional dispose/kill must not surface as a user-facing crash
      if (this.closing) return;
      this.emit({
        type: "error",
        code: "agent_exited",
        message: `Agent process exited (code=${code ?? "?"}${signal ? `, signal=${signal}` : ""}). Reconnect or send again.`,
        detail: `code=${code} signal=${signal}`,
      });
      this.emit({ type: "done", reason: "agent_exited" });
    });

    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => this.handleLine(line));

    const initializeParams: Record<string, unknown> = {
      protocolVersion: 1,
      clientInfo: { name: "grok-code-shell", version: "0.2.0" },
    };
    if (this.config.initializePermissionMode === "default") {
      initializeParams.permissionMode = "default";
    }
    await this.request("initialize", initializeParams);
  }

  async newSession(): Promise<string> {
    const params: Record<string, unknown> = {
      cwd: this.config.workspaceRoot,
      executionProfile: this.config.executionProfile,
      // Vendor grok agent ≥1.0.5 requires this field (JSON-RPC -32602
      // "missing field `mcpServers`"). Empty list is honest: Forge does not
      // inject a host MCP registry. grok-acp ignores unknown keys.
      mcpServers: [],
    };
    if (this.config.initializePermissionMode === "default") {
      params._meta = { rules: VENDOR_ACP_SHELL_CWD_RULE };
    }
    const result = (await this.request("session/new", params)) as { sessionId: string };
    if (this.config.authenticateMethod) {
      await this.request("authenticate", { methodId: this.config.authenticateMethod });
    }
    return result.sessionId;
  }

  /** GATE-named roster obtain. Emits `hook` events; never throws on method-not-found. */
  async listVendorHooks(sessionId: string): Promise<void> {
    try {
      const raw = await this.request(NAMED_HOOKS_JSONRPC_LIST, { sessionId });
      const parsed = parseVendorHooksListResult(raw);
      if (!parsed) {
        this.emit({
          type: "agent_log",
          level: "warn",
          message: "Malformed vendor hooks list ignored (incomplete identity or status).",
        });
        return;
      }
      for (const member of parsed) {
        this.emit({
          type: "hook",
          hookId: member.hookId,
          name: member.name,
          status: member.status,
        });
      }
    } catch (error) {
      this.emit({
        type: "agent_log",
        level: "warn",
        message: `Unmapped vendor hooks list: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async prompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions,
  ): Promise<void> {
    const ownership = opts?.runId && opts.connectionGeneration != null
      ? { sessionId, runId: opts.runId, connectionGeneration: opts.connectionGeneration }
      : null;
    this.activeOwnership = ownership;
    const result = await this.request("session/prompt", {
      sessionId,
      ...(ownership ?? {}),
      // Vendor grok agent requires ACP content blocks (a sequence). grok-acp
      // still accepts a string. Only the vendor handshake sets permissionMode.
      prompt: this.config.initializePermissionMode === "default"
        ? [{ type: "text", text }]
        : text,
      model: opts?.model,
      reasoning_effort: opts?.reasoning_effort,
      history: opts?.history,
      policy: opts?.policy,
      trustedCommandClasses: opts?.trustedCommandClasses ?? [],
      executionPhase: opts?.executionPhase ?? "execute",
      sessionWrite: opts?.sessionWrite === true,
      sessionShell: opts?.sessionShell === true,
    });
    // Vendor often returns only the RPC result (no done notification). Map it
    // onto the same done-class ingress grok-acp already emits. CAS rejects a
    // second winner if a stream-level done also arrives. grok-acp acks with
    // {ok, accepted} then notifies done later — that ack is not turn-end.
    this.emitDoneFromPromptResult(result);
  }

  private emitDoneFromPromptResult(result: unknown): void {
    const rec = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
    const hasStopReason = Boolean(rec && Object.prototype.hasOwnProperty.call(rec, "stopReason"));
    const grokAcpAck = Boolean(rec && rec.accepted === true && !hasStopReason);
    if (grokAcpAck) return;
    if (!hasStopReason && this.config.initializePermissionMode !== "default") return;
    const stopReason = hasStopReason
      ? String((rec as { stopReason?: unknown }).stopReason ?? "stop")
      : "stop";
    const reason =
      /cancel/i.test(stopReason) ? "cancelled" :
      /error|refus|abort/i.test(stopReason) ? "error" :
      stopReason === "end_turn" || stopReason === "stop" || !stopReason ? "stop" :
      stopReason;
    this.emit({ type: "done", reason });
  }

  async cancel(ownership?: AcpOwnership): Promise<void> {
    if (!this.child) return;
    try {
      await Promise.race([this.request("session/cancel", ownership ?? this.activeOwnership ?? {}), new Promise((_,reject)=>setTimeout(()=>reject(new Error("cancel acknowledgement timeout")),2000))]);
    } catch {
      const child=this.child; if(child.pid&&process.platform!=="win32") { try { process.kill(-child.pid,"SIGTERM"); } catch {} } else child.kill("SIGTERM"); if(process.platform==="win32"&&child.pid) execFile("taskkill",["/PID",String(child.pid),"/T","/F"],()=>{});
    }
  }

  async dispose(): Promise<void> {
    this.closing = true;
    this.rl?.close();
    this.rl = null;
    const child = this.child;
    this.child = null;
    if (!child) {
      for (const [, p] of this.pending) {
        p.reject(new Error("Client disposed"));
      }
      this.pending.clear();
      return;
    }
    // Best-effort graceful dispose; do not await long RPC (mode switch must be snappy)
    try {
      if (child.stdin.writable) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: this.nextId++,
            method: "dispose",
            params: {},
          }) + "\n",
        );
      }
    } catch {
      /* ignore */
    }
    try {
      if(child.pid&&process.platform!=="win32") { try { process.kill(-child.pid,"SIGTERM"); } catch {} } else child.kill("SIGTERM"); if(process.platform==="win32"&&child.pid) execFile("taskkill",["/PID",String(child.pid),"/T","/F"],()=>{});
    } catch {
      /* ignore */
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("Client disposed"));
    }
    this.pending.clear();
  }

  async respondPermission(
    id: string,
    decision: PermissionDecision,
    ownership?: AcpOwnership,
  ): Promise<void> {
    if (this.pendingAcpRequestIds.has(id)) {
      const optionId =
        decision === "deny" ? null :
        decision === "allow_session" ? (this.pickOption(id, ["allow_always", "allow_once"]) ?? "allow_once") :
        (this.pickOption(id, ["allow_once"]) ?? "allow_once");
      const result =
        decision === "deny"
          ? { outcome: { outcome: "cancelled" as const } }
          : { outcome: { outcome: "selected" as const, optionId } };
      this.writeResult(id, result);
      this.pendingAcpRequestIds.delete(id);
      return;
    }
    await this.request("permission/respond", { id, decision, ...(ownership ?? this.activeOwnership ?? {}) });
  }

  async respondEdit(
    id: string,
    action: "accept" | "reject",
    sessionId?: string,
    ownership?: AcpOwnership,
  ): Promise<void> {
    await this.request("edit/respond", { id, action, sessionId, ...(ownership ?? this.activeOwnership ?? {}) });
  }

  async respondPlanExit(id: string, outcome: "approved" | "cancelled" | "abandoned"): Promise<boolean> {
    if (!this.pendingAcpRequestIds.has(id)) return false;
    this.writeResult(id, { outcome });
    this.pendingAcpRequestIds.delete(id);
    return true;
  }

  private request(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Agent process not running"));
    }
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const ms =
      timeoutMs ??
      (method === "session/prompt" ? ACP_PROMPT_RPC_TIMEOUT_MS : ACP_RPC_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const timer =
        ms > 0
          ? setTimeout(() => {
              if (!this.pending.has(id)) return;
              this.pending.delete(id);
              const err = new Error(
                `Agent RPC timeout after ${ms}ms: ${method}`,
              );
              this.emit({
                type: "error",
                code: "rpc_timeout",
                message: err.message,
              });
              reject(err);
            }, ms)
          : null;
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      this.child!.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;
    } catch {
      this.emit({
        type: "error",
        code: "parse_error",
        message: `Invalid JSON from agent: ${trimmed.slice(0, 200)}`,
      });
      return;
    }

    if ("method" in msg && msg.method && "id" in msg && (msg as { id?: JsonRpcId | null }).id != null) {
      const req = msg as JsonRpcRequest;
      this.mapChildRequest(req.method, req.id, req.params);
      return;
    }

    if ("id" in msg && msg.id !== undefined && !("method" in msg && msg.method)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const detail = msg.error.data != null ? `: ${String(msg.error.data)}` : "";
        pending.reject(new Error(`${msg.error.message}${detail}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Response that also might be confused — if has id and result
    if ("id" in msg && msg.id !== undefined && ("result" in msg || "error" in msg)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          const detail = msg.error.data != null ? `: ${String(msg.error.data)}` : "";
          pending.reject(new Error(`${msg.error.message}${detail}`));
        }
        else pending.resolve(msg.result);
        return;
      }
    }

    if ("method" in msg && msg.method) {
      this.mapNotification(msg.method, msg.params);
    }
  }

  private pickOption(id: string, preferred: string[]): string | null {
    const pending = this.pendingAcpRequestIds.get(id);
    if (!pending) return null;
    for (const want of preferred) {
      const hit = pending.options.find((o) => o.optionId === want || o.kind === want);
      if (hit) return hit.optionId;
    }
    return pending.options[0]?.optionId ?? null;
  }

  private writeResult(id: string, result: unknown): void {
    if (!this.child?.stdin.writable) return;
    const pending = this.pendingAcpRequestIds.get(id);
    const rawId = pending?.rawId ?? (/^\d+$/.test(id) ? Number(id) : id);
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rawId, result }) + "\n");
  }

  private mapChildRequest(method: string, id: JsonRpcId, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "session/request_permission") {
      const optionsRaw = Array.isArray(p.options) ? p.options : [];
      const options: AcpPermissionOption[] = optionsRaw
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({
          optionId: String(o.optionId ?? o.kind ?? ""),
          kind: typeof o.kind === "string" ? o.kind : undefined,
          name: typeof o.name === "string" ? o.name : undefined,
        }))
        .filter((o) => o.optionId);
      this.pendingAcpRequestIds.set(String(id), { rawId: id, options });
      const toolCall = (p.toolCall && typeof p.toolCall === "object" ? p.toolCall : {}) as Record<string, unknown>;
      const kindRaw = String(toolCall.kind ?? p.kind ?? "");
      const kind: "write" | "shell" = kindRaw === "execute" || kindRaw === "shell" ? "shell" : "write";
      const toolCallIdRaw = toolCall.toolCallId ?? toolCall.id;
      const toolCallId =
        typeof toolCallIdRaw === "string" && toolCallIdRaw
          ? toolCallIdRaw
          : null;
      const detail = String(toolCall.title ?? p.detail ?? toolCall.path ?? kind);
      if (kind === "write") {
        const permPath = extractVendorFsPath(
          toolCall,
          typeof toolCall.kind === "string" ? toolCall.kind : null,
          typeof toolCall.title === "string" ? toolCall.title : detail,
          this.config.workspaceRoot,
        );
        if (permPath) {
          readWriteBaseline(this.config.workspaceRoot, permPath, this.writeBaselines, true);
        }
      }
      this.emit({
        type: "permission_request",
        id: String(id),
        kind,
        detail,
        toolCallId,
      });
      return;
    }
    if ((VENDOR_EXIT_PLAN_METHODS as readonly string[]).includes(method)) {
      this.pendingAcpRequestIds.set(String(id), { rawId: id, options: [] });
      const wrapped = p.params && typeof p.params === "object" ? (p.params as Record<string, unknown>) : null;
      const raw = p.planContent ?? wrapped?.planContent ?? p.content ?? wrapped?.content;
      this.emit({
        type: "vendor_plan_exit",
        id: String(id),
        planContent: typeof raw === "string" && raw.trim() ? raw : null,
      });
      return;
    }
    this.emit({
      type: "agent_log",
      level: "warn",
      message: `Unmapped child ACP request: ${method}`,
    });
  }

  private mapNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    if (this.activeOwnership && (p.runId !== undefined || p.sessionId !== undefined || p.connectionGeneration !== undefined)) {
      if (p.sessionId !== undefined && p.sessionId !== this.activeOwnership.sessionId) return;
      if (p.runId !== undefined && p.runId !== this.activeOwnership.runId) return;
      if (p.connectionGeneration !== undefined && p.connectionGeneration !== this.activeOwnership.connectionGeneration) return;
    }
    switch (method) {
      case NAMED_HOOKS_JSONRPC_METHOD: {
        const update = (p.update && typeof p.update === "object" ? p.update : p) as Record<string, unknown>;
        const kind = String(update.sessionUpdate ?? "");
        if (kind !== NAMED_HOOKS_EXECUTION_KIND && kind !== NAMED_HOOKS_CHANGED_KIND) {
          break;
        }
        const parsed = parseVendorHookExecutionParams(p);
        if (parsed == null) {
          this.emit({
            type: "agent_log",
            level: "warn",
            message: "Malformed vendor hooks frame ignored (incomplete identity or status).",
          });
          break;
        }
        if (kind === NAMED_HOOKS_EXECUTION_KIND && Array.isArray(update.runs) && update.runs.length > 0 && parsed.length === 0) {
          this.emit({
            type: "agent_log",
            level: "warn",
            message: "Malformed vendor hooks frame ignored (incomplete identity or status).",
          });
          break;
        }
        for (const member of parsed) {
          this.emit({
            type: "hook",
            hookId: member.hookId,
            name: member.name,
            status: member.status,
          });
        }
        break;
      }
      case NAMED_MCP_JSONRPC_STATUS: {
        const parsed = parseVendorMcpStatusParams(p);
        if (!parsed) {
          this.emit({
            type: "agent_log",
            level: "warn",
            message: "Malformed vendor MCP frame ignored (incomplete identity or status).",
          });
          break;
        }
        this.emit({
          type: "mcp_server",
          serverId: parsed.serverId,
          name: parsed.name,
          status: parsed.status,
        });
        break;
      }
      case NAMED_MCP_JSONRPC_SERVERS_UPDATED: {
        // Roster snapshot without per-server status — known no-op, not a journal member.
        break;
      }
      case "text_delta":
      case "agent/text_delta": {
        const text = String(p.text ?? "");
        // Skip empty chunks — they can create phantom bubbles client-side
        if (!text) break;
        this.emit({ type: "text_delta", text });
        break;
      }
      case "thinking_delta":
      case "agent/thinking_delta":
        this.emit({ type: "thinking_delta", text: String(p.text ?? "") });
        break;
      case "run_phase":
      case "agent/run_phase": {
        const phase = String(p.phase ?? "waiting_model") as
          | "waiting_model"
          | "reasoning"
          | "tools"
          | "writing"
          | "done";
        this.emit({
          type: "run_phase",
          phase,
          detail: p.detail != null ? String(p.detail) : undefined,
        });
        break;
      }
      case "tool_run":
      case "agent/tool_run": {
        const event = { ...p, type: "tool_run" };
        if (!isValidToolRunEvent(event)) {
          this.emit({ type: "agent_log", level: "warn", message: "Malformed tool_run notification ignored." });
          break;
        }
        this.emit(event);
        break;
      }
      case "tool_request":
      case "agent/tool_request":
      case "tool_result":
      case "agent/tool_result":
        this.emit({ type: "agent_log", level: "warn", message: "Legacy tool notification ignored; current tool_run schema required." });
        break;
      case "permission_request":
      case "agent/permission_request":
        this.emit({
          type: "permission_request",
          id: String(p.id ?? ""),
          kind: (p.kind as "write" | "shell") ?? "shell",
          detail: String(p.detail ?? ""),
        });
        break;
      case "file_edit":
      case "agent/file_edit":
        this.emit({
          type: "file_edit",
          path: String(p.path ?? ""),
          diff: typeof p.diff === "string" ? p.diff : p.diff === null ? null : String(p.diff ?? ""),
          status:
            (p.status as "proposed" | "accepted" | "rejected") ?? "proposed",
          id: String(p.id ?? ""),
          editId: String(p.editId ?? p.id ?? ""),
          invocationId: p.invocationId != null ? String(p.invocationId) : undefined,
          toolCallId: p.toolCallId != null ? String(p.toolCallId) : undefined,
          kind: p.kind === "content" || p.kind === "delete" || p.kind === "rename" ? p.kind : undefined,
          fromPath: typeof p.fromPath === "string" ? p.fromPath : p.fromPath === null ? null : undefined,
          toPath: typeof p.toPath === "string" ? p.toPath : p.toPath === null ? null : undefined,
        });
        break;
      case "error":
      case "agent/error":
        this.emit({
          type: "error",
          code: String(p.code ?? "agent_error"),
          message: String(p.message ?? "Unknown agent error"),
          detail: p.detail != null ? String(p.detail) : undefined,
          status:
            typeof p.status === "number"
              ? p.status
              : p.status != null
                ? Number(p.status)
                : undefined,
        });
        break;
      case "done":
      case "agent/done":
        this.emit({
          type: "done",
          reason: p.reason ? String(p.reason) : undefined,
        });
        break;
      case "project_instructions":
      case "agent/project_instructions": {
        const status = p.status;
        const inclusion = p.inclusion;
        const ok =
          p.schemaVersion === 1 &&
          (status === "present" || status === "absent" || status === "failed") &&
          (inclusion === "included" || inclusion === "not_included" || inclusion === "failed") &&
          (p.path === null || typeof p.path === "string") &&
          (p.bodyByteLength === null || typeof p.bodyByteLength === "number");
        if (!ok) {
          this.emit({ type: "agent_log", level: "warn", message: "Malformed project_instructions notification ignored." });
          break;
        }
        this.emit({
          type: "project_instructions",
          schemaVersion: 1,
          status,
          inclusion,
          path: (p.path as string | null) ?? null,
          bodyByteLength: (p.bodyByteLength as number | null) ?? null,
        });
        break;
      }
      case "usage":
      case "agent/usage": {
        const promptTokens = p.promptTokens;
        const contextWindow = p.contextWindow;
        const ok =
          p.schemaVersion === 1 &&
          typeof promptTokens === "number" &&
          Number.isFinite(promptTokens) &&
          (contextWindow === null || (typeof contextWindow === "number" && Number.isFinite(contextWindow)));
        if (!ok) {
          this.emit({ type: "agent_log", level: "warn", message: "Malformed usage notification ignored." });
          break;
        }
        this.emit({
          type: "usage",
          schemaVersion: 1,
          promptTokens,
          contextWindow: contextWindow as number | null,
        });
        break;
      }
      case "agent_log":
        this.emit({ type:"agent_log", level:(p.level === "warn" || p.level === "info" ? p.level : "debug"), message:String(p.message ?? "") });
        break;
      case "session/update": {
        this.mapSessionUpdate(p);
        break;
      }
      default:
        if (method === NAMED_HOOKS_JSONRPC_LIST || method.startsWith("_x.ai/hooks/")) {
          this.emit({
            type: "agent_log",
            level: "warn",
            message: `Unmapped vendor hooks method: ${method}`,
          });
        }
        break;
    }
  }

  private mapSessionUpdate(p: Record<string, unknown>): void {
    const update = (
      p.update && typeof p.update === "object" ? p.update : p
    ) as Record<string, unknown>;
    const kind = String(update.sessionUpdate ?? "");
    if (kind === "agent_thought_chunk") {
      let text = acpContentText(update.content);
      if (text && this.thoughtBreakAfterTool) {
        text = paragraphBreak(this.lastThoughtText, text);
      }
      this.thoughtBreakAfterTool = false;
      if (text) {
        this.lastThoughtText += text;
        this.emit({ type: "thinking_delta", text });
      }
      return;
    }
    if (kind === "agent_message_chunk") {
      let text = acpContentText(update.content);
      if (text && this.messageBreakAfterTool) {
        text = paragraphBreak(this.lastMessageText, text);
      }
      this.messageBreakAfterTool = false;
      if (text) {
        this.lastMessageText += text;
        this.emit({ type: "text_delta", text });
      }
      return;
    }
    if (kind === "agent") {
      const childId = String(update.childId ?? "");
      const identityLabel = String(update.identityLabel ?? "").trim();
      const status = String(update.status ?? "");
      if (
        !childId ||
        !identityLabel ||
        (status !== "running" && status !== "done" && status !== "failed")
      ) {
        this.emit({
          type: "agent_log",
          level: "warn",
          message: "Malformed vendor child_agent frame ignored.",
        });
        return;
      }
      this.emit({
        type: "child_agent",
        childId,
        identityLabel,
        status,
      });
      return;
    }
    if (kind === "tool_call") {
      const toolCallId = String(update.toolCallId ?? update.id ?? "");
      if (!toolCallId) {
        this.emit({ type: "agent_log", level: "warn", message: "session/update tool_call missing toolCallId" });
        return;
      }
      const acpToolKind =
        typeof update.kind === "string" ? update.kind : null;
      const title =
        typeof update.title === "string" ? update.title : null;
      const name = String(update.title ?? update.kind ?? "tool");
      const input = update.rawInput ?? update.input ?? null;
      const command = typeof update.command === "string" ? update.command : null;
      const url = extractVendorUrl(update);
      const fsPath = extractVendorFsPath(update, acpToolKind, title, this.config.workspaceRoot);
      this.thoughtBreakAfterTool = true;
      this.messageBreakAfterTool = true;
      const mapped = mapVendorToolStatus(update.status);
      const callOutput =
        acpContentText(update.content) || acpContentText(update.rawOutput) || mapped.output;
      const failedFromOutput =
        mapped.status === "succeeded" && vendorUpdateImpliesNonZeroExit(update);
      const existing = fsPath
        ? readWriteBaseline(this.config.workspaceRoot, fsPath, this.writeBaselines)
        : null;
      const diskBody =
        fsPath && mapped.lifecycle === "terminal"
          ? currentFileBody(this.config.workspaceRoot, fsPath)
          : null;
      const diff = fsPath ? vendorWriteDiff(fsPath, update, null, existing, diskBody) : null;
      const snapshotJournaled =
        acpToolKind === "fetch" &&
        (contentHasImage(update.content) || contentHasImage(update.rawOutput));
      this.vendorToolCalls.set(toolCallId, {
        name,
        input,
        command,
        acpToolKind,
        url,
        title,
        snapshotJournaled,
        path: fsPath,
      });
      if (shouldStopAndNameToolKindSeam(acpToolKind, title) && acpToolKind !== "fetch") {
        this.emit({
          type: "agent_log",
          level: "warn",
          message: `ToolKind class seam: ${acpToolKind ?? "(missing)"}`,
        });
      }
      const event = {
        type: "tool_run" as const,
        schemaVersion: 2 as const,
        activityId: toolCallId,
        toolCallId,
        lifecycle: mapped.lifecycle,
        execution: mapped.execution,
        status: failedFromOutput ? ("failed" as const) : mapped.status,
        name,
        input,
        summary: title,
        command,
        output: callOutput || mapped.output,
        error: failedFromOutput ? callOutput || "non-zero exit" : mapped.error,
        reasonCode: mapped.reasonCode,
        reason: mapped.reason,
        shellDisplayName: null,
        detailAvailable: true,
        acpToolKind,
        url,
        title,
        snapshotJournaled,
        ...(fsPath
          ? { path: fsPath, kind: "content" as const, editId: toolCallId, ...(diff ? { diff } : {}) }
          : {}),
      };
      if (!isValidToolRunEvent(event)) {
        this.emit({ type: "agent_log", level: "warn", message: "Malformed vendor tool_call ignored." });
        return;
      }
      this.emit(event);
      return;
    }
    if (kind === "available_commands_update") {
      const raw = update.availableCommands ?? update.available_commands;
      if (!Array.isArray(raw)) {
        this.emit({ type: "available_commands", commands: null, valid: false });
        return;
      }
      const commands: Array<{ name: string; description: string | null }> = [];
      let skipped = 0;
      for (const item of raw) {
        if (!item || typeof item !== "object") {
          skipped += 1;
          continue;
        }
        const name = normalizeAvailableCommandName((item as { name?: unknown }).name);
        if (!name) {
          skipped += 1;
          continue;
        }
        const description = (item as { description?: unknown }).description;
        commands.push({
          name,
          description: typeof description === "string" ? description : null,
        });
      }
      if (skipped > 0) {
        this.emit({
          type: "agent_log",
          level: "warn",
          message:
            skipped === 1
              ? "Skipped unusable available_commands member."
              : `Skipped ${skipped} unusable available_commands members.`,
        });
      }
      if (raw.length > 0 && commands.length === 0) {
        this.emit({ type: "available_commands", commands: null, valid: false });
        return;
      }
      this.emit({ type: "available_commands", commands, valid: true });
      return;
    }
    if (kind === "tool_call_update") {
      const toolCallId = String(update.toolCallId ?? update.id ?? "");
      if (!toolCallId) {
        this.emit({ type: "agent_log", level: "warn", message: "session/update tool_call_update missing toolCallId" });
        return;
      }
      const prior = this.vendorToolCalls.get(toolCallId);
      const status = String(update.status ?? "completed");
      if (status === "pending" || status === "in_progress") return;
      const acpToolKind =
        typeof update.kind === "string" ? update.kind : prior?.acpToolKind ?? null;
      const title =
        typeof update.title === "string" ? update.title : prior?.title ?? null;
      const url = extractVendorUrl(update) ?? prior?.url ?? null;
      const fsPath =
        extractVendorFsPath(update, acpToolKind, title, this.config.workspaceRoot) ?? prior?.path ?? null;
      const snapshotJournaled =
        prior?.snapshotJournaled === true ||
        (acpToolKind === "fetch" &&
          (contentHasImage(update.content) || contentHasImage(update.rawOutput)));
      const name = prior?.name ?? (title ?? (typeof update.kind === "string" ? update.kind : "tool"));
      const input = prior?.input ?? update.rawInput ?? update.input ?? null;
      const command = prior?.command ?? (typeof update.command === "string" ? update.command : null);
      this.vendorToolCalls.set(toolCallId, {
        name,
        input,
        command,
        acpToolKind,
        url,
        title,
        snapshotJournaled,
        path: fsPath,
      });
      const outputText = acpContentText(update.content) || acpContentText(update.rawOutput);
      const failed =
        status === "failed" ||
        status === "error" ||
        vendorUpdateImpliesNonZeroExit(update);
      const rejected = status === "cancelled" || status === "rejected";
      const existing = fsPath
        ? readWriteBaseline(this.config.workspaceRoot, fsPath, this.writeBaselines)
        : null;
      const diskBody =
        fsPath && !rejected ? currentFileBody(this.config.workspaceRoot, fsPath) : null;
      const diff = fsPath
        ? vendorWriteDiff(fsPath, update, prior?.input ?? null, existing, diskBody)
        : null;
      const editFields = fsPath
        ? { path: fsPath, kind: "content" as const, editId: toolCallId, ...(diff ? { diff } : {}) }
        : {};
      const event = failed
        ? {
            type: "tool_run" as const,
            schemaVersion: 2 as const,
            activityId: toolCallId,
            toolCallId,
            lifecycle: "terminal" as const,
            execution: "executed" as const,
            status: "failed" as const,
            name,
            input,
            summary: title,
            command,
            output: outputText || null,
            error: outputText || status,
            reasonCode: null,
            reason: null,
            shellDisplayName: null,
            detailAvailable: true,
            acpToolKind,
            url,
            title,
            snapshotJournaled,
            ...editFields,
          }
        : rejected
          ? {
              type: "tool_run" as const,
              schemaVersion: 2 as const,
              activityId: toolCallId,
              toolCallId,
              lifecycle: "terminal" as const,
              execution: "not_executed" as const,
              status: "rejected" as const,
              name,
              input,
              summary: title,
              command,
              output: "",
              error: null,
              reasonCode: "authorization_refused" as const,
              reason: status,
              shellDisplayName: null,
              detailAvailable: true,
              acpToolKind,
              url,
              title,
              snapshotJournaled,
              ...editFields,
            }
          : {
              type: "tool_run" as const,
              schemaVersion: 2 as const,
              activityId: toolCallId,
              toolCallId,
              lifecycle: "terminal" as const,
              execution: "executed" as const,
              status: "succeeded" as const,
              name,
              input,
              summary: title,
              command,
              output: outputText || null,
              error: null,
              reasonCode: null,
              reason: null,
              shellDisplayName: null,
              detailAvailable: true,
              acpToolKind,
              url,
              title,
              snapshotJournaled,
              ...editFields,
            };
      if (!isValidToolRunEvent(event)) {
        this.emit({ type: "agent_log", level: "warn", message: `Malformed vendor tool_call_update ignored (${status}).` });
        return;
      }
      this.emit(event);
      return;
    }
    if (kind === "session_info_update" || kind === "user_message_chunk" || kind === "current_mode_update") {
      // Known vendor extras Forge does not surface — not an unknown kind.
      return;
    }
    this.emit({
      type: "agent_log",
      level: "warn",
      message: `Unmapped vendor sessionUpdate kind: ${kind || "(missing)"}`,
    });
  }
}

function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** One blank line after a tool — not two, if the previous chunk already ended a line. */
function paragraphBreak(previous: string, next: string): string {
  if (!next || /^\s/.test(next)) return next;
  return /\n$/.test(previous) ? `\n${next}` : `\n\n${next}`;
}

/** Workspace-relative display path when the file is inside the open workspace. */
function toWorkspaceDisplayPath(workspaceRoot: string, fsPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.isAbsolute(fsPath) ? path.resolve(fsPath) : path.resolve(root, fsPath);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return fsPath;
  return rel.split(path.sep).join("/");
}

/** Workspace file path for vendor edit/write tools — never a fetch URL. */
function extractVendorFsPath(
  update: Record<string, unknown>,
  _acpToolKind: string | null,
  title: string | null,
  workspaceRoot: string,
): string | null {
  const candidates: string[] = [];
  const fromTitle = typeof title === "string" ? title.match(/Write `([^`]+)`/) : null;
  if (fromTitle?.[1]) candidates.push(fromTitle[1]);
  const raw = update.rawInput;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as { path?: unknown; file_path?: unknown };
    const filePath = rec.path ?? rec.file_path;
    if (typeof filePath === "string" && filePath) candidates.push(filePath);
  }
  const locations = update.locations;
  if (Array.isArray(locations) && locations[0] && typeof locations[0] === "object") {
    const filePath = (locations[0] as { path?: unknown }).path;
    if (typeof filePath === "string" && filePath) candidates.push(filePath);
  }
  const hit = candidates.find((p) => !looksLikeHttpUrl(p)) ?? null;
  return hit ? toWorkspaceDisplayPath(workspaceRoot, hit) : null;
}

function rawInputOf(update: Record<string, unknown>): Record<string, unknown> | null {
  const raw = update.rawInput ?? update.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function extractVendorWriteBody(update: Record<string, unknown>): string | null {
  const rec = rawInputOf(update);
  if (!rec) return null;
  for (const key of ["content", "contents"] as const) {
    const value = rec[key];
    if (typeof value === "string") return value;
  }
  if (typeof rec.new_string === "string" && typeof rec.old_string !== "string") {
    return rec.new_string;
  }
  return null;
}

function extractVendorReplacePair(
  update: Record<string, unknown>,
): { oldString: string; newString: string } | null {
  const rec = rawInputOf(update);
  if (!rec) return null;
  const oldString = rec.old_string ?? rec.oldString;
  const newString = rec.new_string ?? rec.newString;
  if (typeof oldString === "string" && typeof newString === "string") {
    return { oldString, newString };
  }
  return null;
}

function splitDiffLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  if (normalized === "") return [""];
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function syntheticWriteDiff(relPath: string, content: string): string {
  const slash = relPath.replace(/\\/g, "/");
  const lines = splitDiffLines(content);
  const plus = lines.map((line) => `+${line}`).join("\n");
  const count = lines.length;
  const header = `--- /dev/null\n+++ b/${slash}\n@@ -0,0 +${count === 0 ? "0" : `1,${count}`} @@\n`;
  return `${header}${plus}\n`;
}

function syntheticReplaceDiff(relPath: string, oldString: string, newString: string): string {
  const slash = relPath.replace(/\\/g, "/");
  const oldLines = splitDiffLines(oldString);
  const newLines = splitDiffLines(newString);
  const minus = oldLines.map((line) => `-${line}`).join("\n");
  const plus = newLines.map((line) => `+${line}`).join("\n");
  return `--- a/${slash}\n+++ b/${slash}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${minus}\n${plus}\n`;
}

function readWriteBaseline(
  workspaceRoot: string,
  relPath: string,
  cache: Map<string, string | null>,
  refresh = false,
): string | null {
  if (!refresh && cache.has(relPath)) return cache.get(relPath) ?? null;
  let old: string | null = null;
  try {
    old = fs.readFileSync(path.resolve(workspaceRoot, relPath), "utf8");
  } catch {
    old = null;
  }
  cache.set(relPath, old);
  return old;
}

function currentFileBody(workspaceRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.resolve(workspaceRoot, relPath), "utf8");
  } catch {
    return null;
  }
}

function sameWriteText(a: string, b: string): boolean {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

function vendorWriteDiff(
  relPath: string,
  update: Record<string, unknown>,
  priorInput: unknown = null,
  existing: string | null = null,
  diskBody: string | null = null,
): string | null {
  if (typeof update.diff === "string" && update.diff) return update.diff;
  if (existing != null && diskBody != null && !sameWriteText(existing, diskBody)) {
    return syntheticReplaceDiff(relPath, existing, diskBody);
  }
  const pair =
    extractVendorReplacePair(update) ??
    (priorInput != null ? extractVendorReplacePair({ rawInput: priorInput }) : null);
  if (pair) {
    if (existing != null) {
      const existingNorm = existing.replace(/\r\n/g, "\n");
      const oldNorm = pair.oldString.replace(/\r\n/g, "\n");
      if (!existingNorm.includes(oldNorm)) {
        const existingLines = splitDiffLines(existingNorm).length;
        const oldLines = splitDiffLines(oldNorm).length;
        const newLines = splitDiffLines(pair.newString).length;
        const wholeFileReplace =
          existingLines <= 20 &&
          oldLines <= 20 &&
          Math.abs(existingLines - oldLines) <= 2 &&
          Math.abs(existingLines - newLines) <= 2;
        if (wholeFileReplace) {
          const after =
            diskBody != null && !sameWriteText(existing, diskBody)
              ? diskBody
              : pair.newString;
          if (!sameWriteText(existing, after)) {
            return syntheticReplaceDiff(relPath, existing, after);
          }
        }
      }
    }
    return syntheticReplaceDiff(relPath, pair.oldString, pair.newString);
  }
  const body =
    extractVendorWriteBody(update) ??
    (priorInput != null ? extractVendorWriteBody({ rawInput: priorInput }) : null) ??
    diskBody;
  if (body == null) return null;
  if (existing != null && !sameWriteText(existing, body)) {
    return syntheticReplaceDiff(relPath, existing, body);
  }
  // New file, or a late snapshot that already matches the write — still show
  // the landed bytes instead of Diff unavailable.
  return syntheticWriteDiff(relPath, body);
}

function extractVendorUrl(update: Record<string, unknown>): string | null {
  const raw = update.rawInput;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const url = (raw as { url?: unknown }).url;
    if (typeof url === "string" && url) return url;
  }
  const locations = update.locations;
  if (Array.isArray(locations) && locations[0] && typeof locations[0] === "object") {
    const path = (locations[0] as { path?: unknown }).path;
    if (typeof path === "string" && path) return path;
  }
  return null;
}

function contentHasImage(content: unknown): boolean {
  if (content == null) return false;
  if (Array.isArray(content)) return content.some(contentHasImage);
  if (typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (o.type === "image") return true;
    if ("content" in o) return contentHasImage(o.content);
  }
  return false;
}

function mapVendorToolStatus(raw: unknown): {
  lifecycle: "pending" | "terminal";
  execution: null | "executed" | "not_executed";
  status: "running" | "succeeded" | "failed" | "rejected";
  reasonCode: "authorization_refused" | null;
  reason: string | null;
  error: string | null;
  output: string | null;
} {
  const status = raw == null || raw === "" ? "pending" : String(raw);
  if (status === "completed") {
    return {
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      reasonCode: null,
      reason: null,
      error: null,
      output: null,
    };
  }
  if (status === "failed" || status === "error") {
    return {
      lifecycle: "terminal",
      execution: "executed",
      status: "failed",
      reasonCode: null,
      reason: null,
      error: status,
      output: null,
    };
  }
  if (status === "cancelled" || status === "rejected") {
    return {
      lifecycle: "terminal",
      execution: "not_executed",
      status: "rejected",
      reasonCode: "authorization_refused",
      reason: status,
      error: null,
      output: "",
    };
  }
  // pending | in_progress | omitted → running (vouched)
  return {
    lifecycle: "pending",
    execution: null,
    status: "running",
    reasonCode: null,
    reason: null,
    error: null,
    output: null,
  };
}

function titleLooksLikeFetchClass(title: string | null): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  if (t.includes("http://") || t.includes("https://")) return true;
  return /\b(browse|fetch|http|https)\b/.test(t);
}

function shouldStopAndNameToolKindSeam(
  kind: string | null,
  title: string | null,
): boolean {
  if (kind === "other" || kind === "execute") return true;
  if (kind == null || kind === "") return titleLooksLikeFetchClass(title);
  return false;
}

/** ACP advertises `name` without a leading slash; Forge palettes/handoff use `/name`. */
function normalizeAvailableCommandName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length < 2) return null;
  if (/\s/.test(withSlash)) return null;
  return withSlash;
}

function acpContentText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(acpContentText).join("");
  if (typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if ("content" in o) return acpContentText(o.content);
  }
  return "";
}

/** Stub client for UI development (no subprocess). */
export class StubAcpClient implements AcpClient {
  private handlers = new Set<(event: AcpUiEvent) => void>();
  private sessionCounter = 0;

  onEvent(handler: (event: AcpUiEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: AcpUiEvent): void {
    for (const h of this.handlers) h(event);
  }

  async initialize(): Promise<void> {}

  async newSession(): Promise<string> {
    this.sessionCounter += 1;
    return `stub-session-${this.sessionCounter}`;
  }

  async prompt(_sessionId: string, text: string): Promise<void> {
    this.emit({
      type: "text_delta",
      text: `*(stub)* You said: “${text}”`,
    });
    this.emit({ type: "done", reason: "stub" });
  }

  async cancel(): Promise<void> {
    this.emit({ type: "done", reason: "cancelled" });
  }

  async dispose(): Promise<void> {
    this.handlers.clear();
  }

  async respondPermission(
    _id: string,
    _decision: PermissionDecision,
  ): Promise<void> {}

  async respondPlanExit(
    _id: string,
    _outcome: "approved" | "cancelled" | "abandoned",
  ): Promise<boolean> {
    return false;
  }
}
