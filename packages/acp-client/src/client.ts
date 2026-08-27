import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { isValidToolRunEvent } from "./types.js";
import type {
  AcpClient,
  AcpUiEvent,
  AgentSpawnConfig,
  PermissionDecision,
  PromptOptions,
  AcpOwnership,
} from "./types.js";

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
    }
  >();

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

    this.child = spawn(this.config.command, this.config.args, {
      cwd: this.config.workspaceRoot,
      env: Object.fromEntries(Object.entries(this.config.env).filter(([key]) => key !== "GROKFORGE_BYPASS_SECRET")),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

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
    const result = (await this.request("session/new", {
      cwd: this.config.workspaceRoot,
      executionProfile: this.config.executionProfile,
    })) as { sessionId: string };
    return result.sessionId;
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
    await this.request("session/prompt", {
      sessionId,
      ...(ownership ?? {}),
      prompt: text,
      model: opts?.model,
      reasoning_effort: opts?.reasoning_effort,
      history: opts?.history,
      policy: opts?.policy,
      trustedCommandClasses: opts?.trustedCommandClasses ?? [],
      executionPhase: opts?.executionPhase ?? "execute",
      sessionWrite: opts?.sessionWrite === true,
      sessionShell: opts?.sessionShell === true,
    });
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

  private request(
    method: string,
    params?: unknown,
    timeoutMs = 120_000,
  ): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Agent process not running"));
    }
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        const err = new Error(
          `Agent RPC timeout after ${timeoutMs}ms: ${method}`,
        );
        this.emit({
          type: "error",
          code: "rpc_timeout",
          message: err.message,
        });
        reject(err);
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
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
        pending.reject(new Error(msg.error.message));
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
        if (msg.error) pending.reject(new Error(msg.error.message));
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
      const detail = String(toolCall.title ?? p.detail ?? toolCall.path ?? kind);
      this.emit({
        type: "permission_request",
        id: String(id),
        kind,
        detail,
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
      case "agent_log":
        this.emit({ type:"agent_log", level:(p.level === "warn" || p.level === "info" ? p.level : "debug"), message:String(p.message ?? "") });
        break;
      case "session/update": {
        this.mapSessionUpdate(p);
        break;
      }
      default:
        break;
    }
  }

  private mapSessionUpdate(p: Record<string, unknown>): void {
    const update = (
      p.update && typeof p.update === "object" ? p.update : p
    ) as Record<string, unknown>;
    const kind = String(update.sessionUpdate ?? "");
    if (kind === "agent_thought_chunk") {
      const text = acpContentText(update.content);
      if (text) this.emit({ type: "thinking_delta", text });
      return;
    }
    if (kind === "agent_message_chunk") {
      const text = acpContentText(update.content);
      if (text) this.emit({ type: "text_delta", text });
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
      const mapped = mapVendorToolStatus(update.status);
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
        status: mapped.status,
        name,
        input,
        summary: title,
        command,
        output: mapped.output,
        error: mapped.error,
        reasonCode: mapped.reasonCode,
        reason: mapped.reason,
        shellDisplayName: null,
        detailAvailable: true,
        acpToolKind,
        url,
        title,
        snapshotJournaled,
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
      for (const item of raw) {
        if (!item || typeof item !== "object") {
          this.emit({ type: "available_commands", commands: null, valid: false });
          return;
        }
        const name = (item as { name?: unknown }).name;
        if (typeof name !== "string" || !name.startsWith("/") || name.length < 2 || /\s/.test(name)) {
          this.emit({ type: "available_commands", commands: null, valid: false });
          return;
        }
        const description = (item as { description?: unknown }).description;
        commands.push({
          name,
          description: typeof description === "string" ? description : null,
        });
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
      });
      const outputText = acpContentText(update.content) || acpContentText(update.rawOutput);
      const failed = status === "failed" || status === "error";
      const rejected = status === "cancelled" || status === "rejected";
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
            };
      if (!isValidToolRunEvent(event)) {
        this.emit({ type: "agent_log", level: "warn", message: `Malformed vendor tool_call_update ignored (${status}).` });
        return;
      }
      this.emit(event);
      return;
    }
    this.emit({
      type: "agent_log",
      level: "warn",
      message: `Unmapped vendor sessionUpdate kind: ${kind || "(missing)"}`,
    });
  }
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

function shouldStopAndNameToolKindSeam(
  kind: string | null,
  _title: string | null,
): boolean {
  if (kind === "other" || kind === "execute") return true;
  if (kind == null || kind === "") return true; // missing / title-only
  return false;
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
}
