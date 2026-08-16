import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  applyPendingEdit,
  executeReadTool,
  prepareWriteEdit,
  runShell,
  toolPermissionKind,
  type PendingEdit,
  type ToolName,
} from "./tools.js";
import {
  chatCompletion,
  getApiKey,
  getModel,
  streamChatCompletion,
  streamTextCompletion,
  systemPromptForMode,
  type ChatMessage,
  type ToolCall,
} from "./xai.js";
import { bindExecutionCapability, isHostExecutionProfile, type ExecutionEnvironmentCapability } from "./executionCapability.js";
import { preflightShell } from "./shellPreflight.js";

type JsonRpcId = number | string | null;

interface Incoming {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  pendingEdits: Map<string, PendingEdit>;
  sessionWrite: boolean;
  sessionShell: boolean;
  capability: ExecutionEnvironmentCapability;
}

/** Cap agent context growth during long dogfood sessions (system + recent turns). */
export const MAX_SESSION_MESSAGES = Number(
  process.env.GROKFORGE_MAX_SESSION_MESSAGES || 80,
) || 80;

const MAX_TURNS = Number(process.env.GROKFORGE_MAX_TURNS || 20) || 20;

export function trimSessionMessages(
  messages: ChatMessage[],
  max = MAX_SESSION_MESSAGES,
): void {
  if (messages.length <= max) return;
  const head = messages[0]?.role === "system" ? messages[0] : null;
  const restStart = head ? 1 : 0;
  const keepCount = max - (head ? 1 : 0);
  const kept = messages.slice(restStart).slice(-keepCount);
  messages.length = 0;
  if (head) messages.push(head);
  messages.push(...kept);
}

/**
 * Grok ACP agent over stdio — streaming + tools + permissions + staged edits.
 */
export class GrokAcpServer {
  private sessions = new Map<string, Session>();
  private workspaceRoot = process.cwd();
  private permissionWaiters = new Map<
    string,
    { resolve: (d: string) => void; reject: (e: Error) => void }
  >();
  private editWaiters = new Map<
    string,
    { resolve: (action: "accept" | "reject") => void; reject: (e: Error) => void }
  >();
  private abort: AbortController | null = null;
  private cancelled = false;
  private capability: ExecutionEnvironmentCapability | null = null;

  start(): void {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
      void this.onLine(line);
    });
    process.stdin.on("end", () => process.exit(0));
  }

  private write(obj: unknown): void {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private async onLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Incoming;
    try {
      msg = JSON.parse(trimmed) as Incoming;
    } catch {
      return;
    }
    const { id, method, params } = msg;
    if (!method) return;

    try {
      switch (method) {
        case "initialize":
          this.respond(id ?? null, {
            protocolVersion: 1,
            serverInfo: { name: "grok-acp", version: "0.2.0" },
            capabilities: { tools: true, streaming: true },
          });
          break;
        case "session/new": {
          if (typeof params?.cwd === "string" && params.cwd) {
            this.workspaceRoot = params.cwd;
          }
          if (!isHostExecutionProfile(params?.executionProfile)) {
            this.respondError(id ?? null, -32001, "Missing or invalid host execution profile");
            break;
          }
          this.capability = bindExecutionCapability(params.executionProfile, this.workspaceRoot, Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string,string>);
          const sessionId = randomUUID();
          this.sessions.set(sessionId, {
            id: sessionId,
            messages: [{ role: "system", content: systemPromptForMode(this.capability) }],
            pendingEdits: new Map(),
            sessionWrite: false,
            sessionShell: false,
            capability: this.capability,
          });
          this.respond(id ?? null, {
            sessionId,
            workspaceRoot: this.workspaceRoot,
          });
          break;
        }
        case "session/prompt": {
          const sessionId = String(params?.sessionId ?? "");
          const prompt = String(params?.prompt ?? "");
          const session = this.sessions.get(sessionId);
          if (!session) {
            this.respondError(id ?? null, -32000, "Unknown session");
            break;
          }
          const model =
            typeof params?.model === "string" && params.model.trim()
              ? params.model.trim()
              : undefined;
          const re = params?.reasoning_effort;
          const reasoning_effort =
            re === "low" || re === "medium" || re === "high" ? re : undefined;
          // Seed prior UI history once if agent only has system message
          const hist = params?.history;
          if (Array.isArray(hist) && session.messages.length <= 1) {
            for (const h of hist) {
              if (!h || typeof h !== "object") continue;
              const role = (h as { role?: string }).role;
              const content = String((h as { content?: string }).content ?? "");
              if (
                (role === "user" || role === "assistant" || role === "system") &&
                content
              ) {
                session.messages.push({
                  role,
                  content: content.slice(0, 20_000),
                });
              }
            }
            trimSessionMessages(session.messages);
          }
          // Respond immediately; run agent loop async
          this.respond(id ?? null, { ok: true, accepted: true });
          void this.runPrompt(session, prompt, { model, reasoning_effort });
          break;
        }
        case "session/cancel":
          this.cancelled = true;
          this.abort?.abort();
          for (const [, w] of this.permissionWaiters) {
            w.reject(new Error("cancelled"));
          }
          this.permissionWaiters.clear();
          for (const [, w] of this.editWaiters) {
            w.reject(new Error("cancelled"));
          }
          this.editWaiters.clear();
          this.notify("done", { reason: "cancelled" });
          this.respond(id ?? null, { ok: true });
          break;
        case "permission/respond": {
          const pid = String(params?.id ?? "");
          const decision = String(params?.decision ?? "deny");
          const waiter = this.permissionWaiters.get(pid);
          if (waiter) {
            this.permissionWaiters.delete(pid);
            waiter.resolve(decision);
          }
          this.respond(id ?? null, { ok: true });
          break;
        }
        case "edit/respond": {
          const eid = String(params?.id ?? "");
          const action = String(params?.action ?? "reject") as "accept" | "reject";
          const waiter = this.editWaiters.get(eid);
          if (waiter) {
            this.editWaiters.delete(eid);
            waiter.resolve(action === "accept" ? "accept" : "reject");
          }
          // Also handle late accept for pending edits without waiter
          const sessionId = String(params?.sessionId ?? "");
          const session = this.sessions.get(sessionId);
          if (session && action === "accept") {
            const edit = session.pendingEdits.get(eid);
            if (edit) {
              await applyPendingEdit(edit);
              session.pendingEdits.delete(eid);
              this.notify("file_edit", {
                id: edit.id,
                path: edit.path,
                diff: edit.diff,
                status: "accepted",
              });
            }
          } else if (session && action === "reject") {
            const edit = session.pendingEdits.get(eid);
            if (edit) {
              session.pendingEdits.delete(eid);
              this.notify("file_edit", {
                id: edit.id,
                path: edit.path,
                diff: edit.diff,
                status: "rejected",
              });
            }
          }
          this.respond(id ?? null, { ok: true });
          break;
        }
        case "dispose":
          this.sessions.clear();
          this.respond(id ?? null, { ok: true });
          break;
        default:
          this.respondError(id ?? null, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (id !== undefined) this.respondError(id, -32000, message);
      else this.notify("error", { code: "internal", message });
    }
  }

  private waitPermission(
    id: string,
    kind: "write" | "shell",
    detail: string,
  ): Promise<string> {
    this.notify("permission_request", { id, kind, detail });
    return new Promise((resolve, reject) => {
      this.permissionWaiters.set(id, { resolve, reject });
    });
  }

  private waitEdit(edit: PendingEdit): Promise<"accept" | "reject"> {
    this.notify("file_edit", {
      id: edit.id,
      path: edit.path,
      diff: edit.diff,
      status: "proposed",
    });
    return new Promise((resolve, reject) => {
      this.editWaiters.set(edit.id, { resolve, reject });
    });
  }

  private async runPrompt(
    session: Session,
    prompt: string,
    opts?: {
      model?: string;
      reasoning_effort?: "low" | "medium" | "high";
    },
  ): Promise<void> {
    this.cancelled = false;
    this.abort = new AbortController();
    const apiKey = getApiKey();
    let model = opts?.model?.trim() || getModel();
    let reasoning_effort = opts?.reasoning_effort;
    let strippedEffort = false;

    if (!apiKey) {
      this.notify("error", {
        code: "auth_missing",
        message:
          "No XAI_API_KEY. Set it in Settings or environment, then retry.",
      });
      this.notify("done", { reason: "auth_missing" });
      return;
    }

    session.messages.push({ role: "user", content: prompt });
    trimSessionMessages(session.messages);

    try {
      this.notify("run_phase", {
        phase: "waiting_model",
        detail: reasoning_effort
          ? `Model thinking (reasoning ${reasoning_effort})…`
          : "Waiting for Grok…",
      });
      // Agent loop — stream each model turn so thinking appears live
      let turns = 0;
      const maxTurns = MAX_TURNS;
      while (turns < maxTurns && !this.cancelled) {
        turns += 1;
        trimSessionMessages(session.messages);
        this.notify("run_phase", {
          phase: "waiting_model",
          detail: `Model turn ${turns}${reasoning_effort ? ` · effort ${reasoning_effort}` : ""}…`,
        });

        // Track what we already streamed so we don't double-emit on assemble
        let streamedContent = false;
        let streamedThinking = false;

        const runOnce = async (effort?: "low" | "medium" | "high") => {
          streamedContent = false;
          streamedThinking = false;
          try {
              return await streamChatCompletion({
              apiKey,
              model,
              messages: session.messages,
              tools: true,
              capability: session.capability,
                reasoning_effort: effort,
              signal: this.abort?.signal,
              onThinkingDelta: (t) => {
                streamedThinking = true;
                this.notify("run_phase", {
                  phase: "reasoning",
                  detail: "Thinking…",
                });
                this.notify("thinking_delta", { text: t });
              },
              onTextDelta: (t) => {
                streamedContent = true;
                this.notify("run_phase", {
                  phase: "writing",
                  detail: "Writing answer…",
                });
                this.notify("text_delta", { text: t });
              },
              onPhase: (phase) => {
                if (phase === "tools") {
                  this.notify("run_phase", {
                    phase: "tools",
                    detail: "Preparing tools…",
                  });
                }
              },
            });
          } catch (streamErr) {
            // Fall back to non-stream if provider rejects stream+tools
            return chatCompletion({
              apiKey,
              model,
              messages: session.messages,
              tools: true,
              capability: session.capability,
              reasoning_effort: effort,
              signal: this.abort?.signal,
            });
          }
        };

        let result;
        try {
          result = await runOnce(reasoning_effort);
        } catch (err) {
          const e = err as Error & { status?: number; message?: string };
          const msg = e.message || "";
          if (
            !strippedEffort &&
            reasoning_effort &&
            (msg.includes("reasoning") || e.status === 400)
          ) {
            strippedEffort = true;
            reasoning_effort = undefined;
            result = await runOnce(undefined);
          } else {
            throw err;
          }
        }

        // Non-stream fallback path: emit thinking/content in one shot
        if (!streamedThinking && result.reasoning_content) {
          this.notify("run_phase", {
            phase: "reasoning",
            detail: "Thinking…",
          });
          this.notify("thinking_delta", { text: result.reasoning_content });
          streamedThinking = true;
        }
        if (!streamedContent && result.content) {
          this.notify("run_phase", {
            phase: "writing",
            detail: "Writing answer…",
          });
          this.notify("text_delta", { text: result.content });
          // Critical: mark streamed so finalText path does not double-emit
          streamedContent = true;
        }

        if (result.tool_calls?.length) {
          this.notify("run_phase", {
            phase: "tools",
            detail: `Using ${result.tool_calls.length} tool(s)…`,
          });
          session.messages.push({
            role: "assistant",
            content: result.content,
            tool_calls: result.tool_calls,
          });
          for (const call of result.tool_calls) {
            if (this.cancelled) break;
            const toolResult = await this.handleToolCall(session, call);
            const capped =
              toolResult.length > 12_000
                ? toolResult.slice(0, 12_000) + "\n…[truncated for context]"
                : toolResult;
            session.messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: capped,
            });
          }
          continue;
        }

        let finalText = (result.content || "").trim();
        if (!finalText && !streamedContent) {
          // Last resort: text-only stream (no tools)
          finalText = (
            await streamTextCompletion({
              apiKey,
              model,
              messages: session.messages,
              reasoning_effort,
              handlers: {
                onTextDelta: (t) => {
                  streamedContent = true;
                  this.notify("text_delta", { text: t });
                },
                onThinkingDelta: (t) => {
                  this.notify("run_phase", {
                    phase: "reasoning",
                    detail: "Thinking…",
                  });
                  this.notify("thinking_delta", { text: t });
                },
                signal: this.abort?.signal,
              },
            })
          ).trim();
          streamedContent = Boolean(finalText) || streamedContent;
        }

        if (finalText) {
          // Content may already have been streamed token-by-token
          if (!streamedContent) {
            this.notify("text_delta", { text: finalText });
            streamedContent = true;
          }
          session.messages.push({ role: "assistant", content: finalText });
        } else if (result.reasoning_content?.trim()) {
          const fromThink = result.reasoning_content.trim();
          // Promote reasoning to visible answer when model omitted content
          if (!streamedContent) {
            this.notify("text_delta", { text: fromThink });
            streamedContent = true;
          }
          session.messages.push({ role: "assistant", content: fromThink });
        } else if (!streamedContent) {
          const fallback =
            "I finished processing but produced no text. Please try again (Retry), or switch effort (e.g. Expert).";
          this.notify("text_delta", { text: fallback });
          session.messages.push({ role: "assistant", content: fallback });
        }
        break;
      }

      this.notify("run_phase", { phase: "done" });
      this.notify("done", { reason: this.cancelled ? "cancelled" : "stop" });
    } catch (err) {
      const e = err as Error & { code?: string; status?: number };
      if (e.name === "AbortError" || this.cancelled) {
        this.notify("run_phase", { phase: "done", detail: "Cancelled" });
        this.notify("done", { reason: "cancelled" });
        return;
      }
      const userMessage =
        (e as Error & { userMessage?: string }).userMessage || e.message;
      this.notify("error", {
        code: e.code ?? "agent_error",
        message: userMessage,
        detail: e.message,
        status: e.status,
      });
      this.notify("done", { reason: "error" });
    }
  }

  private async handleToolCall(
    session: Session,
    call: ToolCall,
  ): Promise<string> {
    const name = call.function.name as ToolName;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }

    const capability = session.capability;
    const emitTerminal = (out: string, ok: boolean, extra: Record<string, unknown> = {}) => this.notify("tool_run", { schemaVersion: 2, type: "tool_run", activityId: call.id, toolCallId: call.id, lifecycle: "terminal", execution: extra.execution ?? "executed", status: extra.status ?? (ok ? "succeeded" : "failed"), name, input: args, summary: null, command: name === "run_shell" ? String(args.command ?? "") : null, output: out, error: extra.execution === "not_executed" ? null : (ok ? null : out), reasonCode: extra.reasonCode ?? null, reason: extra.reason ?? null, shellDisplayName: capability.displayName, detailAvailable: true });
    this.notify("tool_run", { schemaVersion: 2, type: "tool_run", activityId: call.id, toolCallId: call.id, lifecycle: "pending", execution: null, status: "running", name, input: args, summary: null, command: name === "run_shell" ? String(args.command ?? "") : null, output: null, error: null, reasonCode: null, reason: null, shellDisplayName: capability.displayName, detailAvailable: true });

    const perm = toolPermissionKind(name);

    try {
      if (perm === "read") {
        const out = await executeReadTool(this.workspaceRoot, name, args);
        emitTerminal(out, true);
        return out;
      }

      if (perm === "shell") {
        const preflight = await preflightShell(capability, String(args.command ?? ""));
        if (preflight.disposition === "reject") {
          const msg = JSON.stringify({ execution: "not_executed", reasonCode: preflight.reasonCode, command: preflight.command, reason: preflight.reason, shellDisplayName: preflight.shellDisplayName });
          emitTerminal(msg, false, { execution: "not_executed", status: "rejected", reasonCode: preflight.reasonCode, reason: preflight.reason });
          return msg;
        }
        if (!session.sessionShell) {
          const decision = await this.waitPermission(
            call.id,
            "shell",
            `Run: ${String(args.command ?? "")}`,
          );
          if (decision === "allow_session") session.sessionShell = true;
          if (decision === "deny" || decision === "cancelled") {
            const msg = JSON.stringify({ error: "User denied shell permission" });
            emitTerminal(msg, false);
            return msg;
          }
        }
        const enforceAllowlist = process.env.GROKFORGE_SHELL_ALLOWLIST !== "0";
        const out = await runShell(
          capability,
          String(args.command ?? ""),
          Number(args.timeout_ms ?? 60_000),
          { enforceAllowlist },
        );
        let ok = true;
        try {
          const parsed = JSON.parse(out) as {
            blocked?: boolean;
            timed_out?: boolean;
            exit_code?: number | null;
          };
          if (parsed.blocked || parsed.timed_out) ok = false;
          else if (typeof parsed.exit_code === "number" && parsed.exit_code !== 0) {
            ok = false;
          }
        } catch {
          /* keep ok */
        }
        emitTerminal(out, ok);
        return out;
      }

      // write
      if (!session.sessionWrite) {
        const decision = await this.waitPermission(
          call.id,
          "write",
          `Write: ${String(args.path ?? "")}`,
        );
        if (decision === "allow_session") session.sessionWrite = true;
        if (decision === "deny") {
          const msg = JSON.stringify({ error: "User denied write permission" });
          emitTerminal(msg, false);
          return msg;
        }
      }

      const editId = randomUUID();
      const edit = await prepareWriteEdit(
        this.workspaceRoot,
        name as "write_file" | "apply_patch",
        args,
        editId,
      );
      session.pendingEdits.set(editId, edit);
      const action = await this.waitEdit(edit);
      if (action === "accept") {
        await applyPendingEdit(edit);
        session.pendingEdits.delete(editId);
        this.notify("file_edit", {
          id: edit.id,
          path: edit.path,
          diff: edit.diff,
          status: "accepted",
        });
        const out = JSON.stringify({
          ok: true,
          path: edit.path,
          status: "accepted",
        });
        emitTerminal(out, true);
        return out;
      }
      session.pendingEdits.delete(editId);
      this.notify("file_edit", {
        id: edit.id,
        path: edit.path,
        diff: edit.diff,
        status: "rejected",
      });
      const out = JSON.stringify({
        ok: false,
        path: edit.path,
        status: "rejected",
      });
      emitTerminal(out, false);
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const out = JSON.stringify({ error: message });
      emitTerminal(out, false);
      return out;
    }
  }

  /** Backend test seam: executes the same production tool path used by prompt turns. */
  async executeTool(session: Session, call: ToolCall): Promise<string> {
    return this.handleToolCall(session, call);
  }
}
