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

    await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "grok-code-shell", version: "0.2.0" },
    });
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

  private mapNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    if (this.activeOwnership && (p.runId !== undefined || p.sessionId !== undefined || p.connectionGeneration !== undefined)) {
      if (p.sessionId !== this.activeOwnership.sessionId || p.runId !== this.activeOwnership.runId || p.connectionGeneration !== this.activeOwnership.connectionGeneration) return;
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
      default:
        break;
    }
  }
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
