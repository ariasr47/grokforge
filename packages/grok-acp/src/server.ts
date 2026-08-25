import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  applyPendingEdit,
  executeReadTool,
  prepareDeleteEdit,
  prepareRenameEdit,
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
import { AuthorizationBroker } from "./authorization-broker.js";
import { compileFixedInspection } from "./inspection-grammar.js";
import { parseProtectedDelete } from "./protected-delete.js";
import { EditJournal } from "./edit-journal.js";
import { MutationCoordinator } from "./mutation-coordinator.js";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  composeSystemWithRecipe,
  inclusionFromStatus,
  resolveProjectInstructions,
} from "./project-instructions.js";

type JsonRpcId = number | string | null;

interface Incoming {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}
type RunOwner = { sessionId: string; runId: string; connectionGeneration: number };
function fixedInspectionPath(inspection:{args:string[]}):string|undefined {
  const args=inspection.args;
  if(args[0]==="diff"){const i=args.indexOf("--");return i>=0?args[i+1]:undefined;}
  if(args[0]==="--files")return args[1];
  if(args[0]==="-n")return args[2];
  return undefined;
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  pendingEdits: Map<string, PendingEdit>;
  sessionWrite: boolean;
  sessionShell: boolean;
  capability: ExecutionEnvironmentCapability;
  permissionMode?: "review" | "trusted_workspace" | "bypass_permissions";
  trustedCommandClasses?: string[];
  executionPhase?: "plan" | "execute";
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
  private activeRuns = new Map<string, { owner: RunOwner; abort: AbortController; cancelled: boolean; executionPhase: "plan" | "execute" }>();
  private activeOwner: RunOwner | null = null;
  private readonly authorization = new AuthorizationBroker();
  private readonly completedToolCalls = new Map<string,{args:string;result:string}>();
  private readonly mutation = new MutationCoordinator();
  private readonly editJournal = new EditJournal(process.env.GROKFORGE_DATA_DIR ?? path.join(process.cwd(), ".grokforge-runtime"));
  private async confinedTarget(target:string):Promise<boolean>{
    if(!target||path.isAbsolute(target)||target.split(/[\\/]/).includes(".."))return false;
    const root=await fs.realpath(this.workspaceRoot).catch(()=>null);if(!root)return false;
    let candidate=path.resolve(root,target);let probe=candidate;
    const within=(value:string)=>{const r=process.platform==="win32"?root.toLowerCase():root;const v=process.platform==="win32"?value.toLowerCase():value;return v===r||v.startsWith(r+path.sep)||v.startsWith(r+"/");};
    while(true){
      try { const real=await fs.realpath(probe); return within(real); }
      catch(error){ const code=(error as NodeJS.ErrnoException).code;if(code!=="ENOENT"&&code!=="ENOTDIR")return false; }
      const parent=path.dirname(probe);if(parent===probe)return false;probe=parent;
    }
  }

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

  private notify(method: string, params: unknown, owner?: RunOwner): void {
    const effectiveOwner = owner ?? this.activeOwner;
    const owned = effectiveOwner ? { ...(params as Record<string, unknown>), ...effectiveOwner } : params;
    this.write({ jsonrpc: "2.0", method, params: owned });
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
            permissionMode: "review",
            trustedCommandClasses: [],
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
          const runId = typeof params?.runId === "string" ? params.runId : "";
          const connectionGeneration = Number(params?.connectionGeneration);
          if (!runId || !Number.isInteger(connectionGeneration) || connectionGeneration < 1) {
            this.respondError(id ?? null, -32602, "Missing run ownership");
            break;
          }
          const model =
            typeof params?.model === "string" && params.model.trim()
              ? params.model.trim()
              : undefined;
          const re = params?.reasoning_effort;
          const reasoning_effort =
            re === "low" || re === "medium" || re === "high" ? re : undefined;
          const effectiveMode = String((params?.policy as {effectiveMode?:unknown} | undefined)?.effectiveMode ?? "review");
          if (effectiveMode === "review" || effectiveMode === "trusted_workspace" || effectiveMode === "bypass_permissions") session.permissionMode = effectiveMode;
          const classes = Array.isArray(params?.trustedCommandClasses)
            ? (params.trustedCommandClasses as unknown[]).filter(
                (id): id is string => typeof id === "string",
              )
            : [];
          session.trustedCommandClasses = classes;
          session.executionPhase = params?.executionPhase === "plan" ? "plan" : "execute";
          if (params?.sessionWrite === true) session.sessionWrite = true;
          if (params?.sessionShell === true) session.sessionShell = true;
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
          const owner = { sessionId, runId, connectionGeneration };
          if (process.env.GROKFORGE_MODE?.trim().toLowerCase() !== "chat") {
            const snap = await resolveProjectInstructions(this.workspaceRoot);
            const base = systemPromptForMode(session.capability);
            const content = composeSystemWithRecipe(base, snap);
            if (session.messages[0]?.role === "system") {
              session.messages[0].content = content;
            } else {
              session.messages.unshift({ role: "system", content });
            }
            this.notify("project_instructions", {
              schemaVersion: 1,
              type: "project_instructions",
              status: snap.status,
              inclusion: inclusionFromStatus(snap.status),
              path: snap.path,
              bodyByteLength:
                snap.status === "present" ? Buffer.byteLength(snap.body, "utf8") : null,
            }, owner);
          }
          // Respond immediately; run agent loop async
          this.respond(id ?? null, { ok: true, accepted: true });
          const controller = new AbortController();
          this.activeRuns.set(sessionId, { owner, abort: controller, cancelled: false, executionPhase: session.executionPhase ?? "execute" });
          void this.runPrompt(session, prompt, { model, reasoning_effort, owner, signal: controller.signal }).finally(() => this.activeRuns.delete(sessionId));
          break;
        }
        case "session/cancel": {
          const sessionId = String(params?.sessionId ?? "");
          const current = this.activeRuns.get(sessionId);
          if (!current || current.owner.runId !== params?.runId || current.owner.connectionGeneration !== Number(params?.connectionGeneration)) { this.respondError(id ?? null, -32004, "Run ownership mismatch"); break; }
          current.cancelled = true;
          current.abort.abort();
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
        }
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
                path: edit.kind === "rename" ? edit.toPath ?? edit.path : edit.path,
                diff: edit.diff,
                status: "accepted",
                kind: edit.kind,
                fromPath: edit.fromPath ?? null,
                toPath: edit.toPath ?? null,
              });
            }
          } else if (session && action === "reject") {
            const edit = session.pendingEdits.get(eid);
            if (edit) {
              session.pendingEdits.delete(eid);
              this.notify("file_edit", {
                id: edit.id,
                path: edit.kind === "rename" ? edit.fromPath ?? edit.path : edit.path,
                diff: edit.diff,
                status: "rejected",
                kind: edit.kind,
                fromPath: edit.fromPath ?? null,
                toPath: edit.toPath ?? null,
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
    owner?: RunOwner,
  ): Promise<string> {
    this.notify("permission_request", { id, kind, detail }, owner);
    return new Promise((resolve, reject) => {
      this.permissionWaiters.set(id, { resolve, reject });
    });
  }

  private waitEdit(edit: PendingEdit, owner?: RunOwner, callId?: string): Promise<"accept" | "reject"> {
    this.notify("file_edit", {
      id: edit.id,
      editId: edit.id,
      path: edit.kind === "rename" ? edit.fromPath! : edit.path,
      diff: edit.diff,
      status: "proposed",
      kind: edit.kind,
      fromPath: edit.fromPath ?? null,
      toPath: edit.toPath ?? null,
      toolCallId: callId,
      invocationId: callId,
    }, owner);
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
      owner: RunOwner;
      signal: AbortSignal;
    },
  ): Promise<void> {
    this.cancelled = false;
    this.activeOwner = opts?.owner ?? null;
    this.abort = new AbortController();
    if (opts?.signal) opts.signal.addEventListener("abort", () => this.abort?.abort(), { once: true });
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
        let emittedContent = "";
        let emittedThinking = "";

        const runOnce = async (effort?: "low" | "medium" | "high", recoveryPrefix?: { content: string; thinking: string }) => {
          let recoveryContent = "";
          let recoveryThinking = "";
          let completed;
          try {
              completed = await streamChatCompletion({
              apiKey,
              model,
              messages: session.messages,
              tools: true,
              capability: session.capability,
                reasoning_effort: effort,
              signal: this.abort?.signal,
              onThinkingDelta: (t) => {
                if (recoveryPrefix) { recoveryThinking += t; return; }
                streamedThinking = true;
                emittedThinking += t;
                this.notify("run_phase", {
                  phase: "reasoning",
                  detail: "Thinking…",
                });
                this.notify("thinking_delta", { text: t });
              },
              onTextDelta: (t) => {
                if (recoveryPrefix) { recoveryContent += t; return; }
                streamedContent = true;
                emittedContent += t;
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
            if ((streamErr as { code?: string }).code === "provider_liveness_timeout") throw streamErr;
            // Fall back to non-stream if provider rejects stream+tools
            completed = await chatCompletion({
              apiKey,
              model,
              messages: session.messages,
              tools: true,
              capability: session.capability,
              reasoning_effort: effort,
              signal: this.abort?.signal,
            });
          }
          if (recoveryPrefix) {
            const recoveredContent = completed.content ?? recoveryContent;
            const recoveredThinking = completed.reasoning_content ?? recoveryThinking;
            if (!recoveredContent.startsWith(recoveryPrefix.content) || !recoveredThinking.startsWith(recoveryPrefix.thinking)) {
              throw Object.assign(new Error("Provider recovery diverged from already-visible output"), { code: "provider_liveness_timeout" });
            }
            const thinkingSuffix = recoveredThinking.slice(recoveryPrefix.thinking.length);
            const contentSuffix = recoveredContent.slice(recoveryPrefix.content.length);
            if (thinkingSuffix) {
              streamedThinking = true;
              emittedThinking += thinkingSuffix;
              this.notify("run_phase", { phase: "reasoning", detail: "Thinking…" });
              this.notify("thinking_delta", { text: thinkingSuffix });
            }
            if (contentSuffix) {
              streamedContent = true;
              emittedContent += contentSuffix;
              this.notify("run_phase", { phase: "writing", detail: "Writing answer…" });
              this.notify("text_delta", { text: contentSuffix });
            }
          }
          return completed;
        };

        let result;
        try {
          result = await runOnce(reasoning_effort);
        } catch (err) {
          const e = err as Error & { status?: number; message?: string };
          if ((e as Error & { code?: string }).code === "provider_liveness_timeout") {
            const recoveryKey = `grokforge-recovery-${turns}`;
            if (turns <= 2) {
              this.notify("run_phase", { phase: "waiting_model", detail: `Recovering provider transport (${recoveryKey})…` });
              result = await runOnce(reasoning_effort, emittedContent || emittedThinking ? { content: emittedContent, thinking: emittedThinking } : undefined);
            } else throw err;
          }
          if (result) {
            // bounded same-run recovery succeeded; continue with the original turn
          } else {
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
        } else if (!streamedContent) {
          // Reasoning is never an answer. A missing final is an explicit retryable
          // failure; the host finalizer owns the terminal outcome.
          this.notify("error", {
            code: "missing_final_answer",
            message: "No final answer was produced.",
            retryable: true,
          });
          this.notify("done", { reason: "missing_final_answer" });
          return;
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
    } finally {
      this.activeOwner = null;
    }
  }

  private async handleToolCall(
    session: Session,
    call: ToolCall,
    ownerOverride?: RunOwner,
  ): Promise<string> {
    const executionOwner = ownerOverride ?? this.activeOwner ?? undefined;
    const name = call.function.name as ToolName;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    const normalizedArgs = JSON.stringify(args); const ownerKey=`${executionOwner?.sessionId??session.id}:${executionOwner?.runId??"direct"}:${call.id}`; const priorCall = this.completedToolCalls.get(ownerKey);
    if (priorCall) { if (priorCall.args !== normalizedArgs) return JSON.stringify({error:"tool_call_id_reused_with_different_arguments"}); return priorCall.result; }

    const capability = session.capability;
    const emitTerminal = (out: string, ok: boolean, extra: Record<string, unknown> = {}) => this.notify("tool_run", { schemaVersion: 2, type: "tool_run", activityId: call.id, toolCallId: call.id, lifecycle: "terminal", execution: extra.execution ?? "executed", status: extra.status ?? (ok ? "succeeded" : "failed"), name, input: args, summary: null, command: name === "run_shell" ? String(args.command ?? "") : null, output: out, error: extra.execution === "not_executed" ? null : ok ? null : typeof extra.error === "string" ? extra.error : out, reasonCode: extra.reasonCode ?? null, reason: extra.reason ?? null, shellDisplayName: capability.displayName, detailAvailable: true, automaticEligibility: extra.automaticEligibility ?? "not_eligible", autoApplied: extra.autoApplied === true, editId: extra.editId ?? null, diff: extra.diff ?? null, path: extra.path ?? null, recovery: extra.recovery ?? null, kind: extra.kind ?? null, fromPath: extra.fromPath ?? null, toPath: extra.toPath ?? null }, executionOwner);
    this.notify("tool_run", { schemaVersion: 2, type: "tool_run", activityId: call.id, toolCallId: call.id, lifecycle: "pending", execution: null, status: "running", name, input: args, summary: null, command: name === "run_shell" ? String(args.command ?? "") : null, output: null, error: null, reasonCode: null, reason: null, shellDisplayName: capability.displayName, detailAvailable: true }, executionOwner);

    const fromRun = executionOwner
      ? [...this.activeRuns.values()].find((r) => r.owner.runId === executionOwner.runId)
      : this.activeRuns.get(session.id);
    const phase = fromRun?.executionPhase ?? session.executionPhase ?? "execute";
    if (phase === "plan") {
      const isRead = name === "read_file" || name === "list_dir" || name === "grep";
      const isInspection = name === "run_shell" && compileFixedInspection(String(args.command ?? "")) != null;
      if (!isRead && !isInspection) {
        const msg = JSON.stringify({
          error: "Plan phase refuses mutations",
          execution: "not_executed",
          reasonCode: "plan_phase_refused",
        });
        emitTerminal(msg, false, {
          execution: "not_executed",
          status: "rejected",
          reasonCode: "plan_phase_refused",
          reason: "Plan phase: edits and non-inspection shell are not executed",
          automaticEligibility: "not_eligible",
        });
        return msg;
      }
    }

    if (name === "delete_file" || name === "rename_file") {
      return this.handleDeleteRenameTool(
        session,
        call,
        name,
        args,
        executionOwner,
        ownerKey,
        normalizedArgs,
        emitTerminal,
      );
    }

    const perm = toolPermissionKind(name);
    const command = name === "run_shell" ? String(args.command ?? "") : "";
    const inspection = name === "run_shell" ? compileFixedInspection(command) : null;
    const inspectionPath = inspection ? fixedInspectionPath(inspection) : undefined;
    const confined = perm === "shell" ? (inspectionPath ? await this.confinedTarget(inspectionPath) : true) : await this.confinedTarget(String(args.path ?? ""));
    const authorization = this.authorization.authorize(
      perm === "read"
        ? { kind: "read", path: String(args.path ?? "") }
        : perm === "shell" && inspection
          ? { kind: "inspection", path: String(args.path ?? ""), command }
          : perm === "shell"
            ? { kind: "shell", command }
            : {
                kind: "text_edit",
                regularText: (typeof args.content === "string" ? !args.content.includes("\0") : typeof args.patch === "string" && !args.patch.includes("\0")),
                exists: true,
              },
      {
        mode: session.permissionMode ?? "review",
        confined,
        inspection: inspection ? command : undefined,
        trustedCommandClasses: session.trustedCommandClasses ?? [],
      },
    );
    if (authorization.decision === "refuse") {
      const msg = JSON.stringify({ error: authorization.reason ?? "Tool refused" });
      emitTerminal(msg, false, { execution: "not_executed", status: "rejected", reasonCode: authorization.reason === "outside_workspace" ? "outside_workspace" : "authorization_refused", reason: authorization.reason ?? "Tool refused", automaticEligibility: authorization.automaticEligibility });
      return msg;
    }

    try {
      if (perm === "read") {
        const out = await executeReadTool(
          this.workspaceRoot,
          name,
          args,
          session.permissionMode === "bypass_permissions",
        );
        let extractFailed = false;
        let umbrella: string | undefined;
        if (name === "read_file") {
          try {
            const parsed = JSON.parse(out) as {
              extract_failed?: unknown;
              error?: unknown;
            };
            if (parsed.extract_failed === true) {
              extractFailed = true;
              umbrella =
                typeof parsed.error === "string" && parsed.error
                  ? parsed.error
                  : undefined;
            }
          } catch {
            /* non-JSON read results stay on the success path */
          }
        }
        if (extractFailed) {
          emitTerminal(out, false, {
            automaticEligibility: authorization.automaticEligibility,
            error: umbrella ?? out,
          });
        } else {
          emitTerminal(out, true, {
            automaticEligibility: authorization.automaticEligibility,
          });
        }
        this.completedToolCalls.set(ownerKey, { args: normalizedArgs, result: out });
        return out;
      }

      if (perm === "shell") {
        if (parseProtectedDelete(command, this.workspaceRoot)) {
          const msg = JSON.stringify({ execution: "not_executed", reasonCode: "protected_recursive_delete", reason: "Protected recursive deletion target" });
          emitTerminal(msg, false, { execution: "not_executed", status: "rejected", reasonCode: "protected_recursive_delete", reason: "Protected recursive deletion target", automaticEligibility: "not_eligible", autoApplied: false });
          return msg;
        }
        const preflight = await preflightShell(capability, String(args.command ?? ""));
        if (preflight.disposition === "reject") {
          const msg = JSON.stringify({ execution: "not_executed", reasonCode: preflight.reasonCode, command: preflight.command, reason: preflight.reason, shellDisplayName: preflight.shellDisplayName });
          emitTerminal(msg, false, { execution: "not_executed", status: "rejected", reasonCode: preflight.reasonCode, reason: preflight.reason, automaticEligibility: "not_eligible", autoApplied: false });
          return msg;
        }
        if (!session.sessionShell && session.permissionMode !== "bypass_permissions" && authorization.decision !== "auto") {
          let decision: string;
          try {
            decision = await this.waitPermission(
              call.id,
              "shell",
              `Run: ${String(args.command ?? "")}`,
              executionOwner,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === "cancelled") {
              const msg = JSON.stringify({ error: "User denied shell permission", execution: "not_executed" });
              emitTerminal(msg, false, {
                execution: "not_executed",
                status: "rejected",
                reasonCode: "authorization_refused",
                reason: "cancelled",
                automaticEligibility: authorization.automaticEligibility,
              });
              return msg;
            }
            throw err;
          }
          if (decision === "allow_session") session.sessionShell = true;
          if (decision === "deny" || decision === "cancelled") {
            const msg = JSON.stringify({ error: "User denied shell permission", execution: "not_executed" });
            emitTerminal(msg, false, {
              execution: "not_executed",
              status: "rejected",
              reasonCode: "authorization_refused",
              reason: decision === "cancelled" ? "cancelled" : "User denied shell permission",
              automaticEligibility: authorization.automaticEligibility,
            });
            return msg;
          }
        }
        const enforceAllowlist = session.permissionMode !== "bypass_permissions" && process.env.GROKFORGE_SHELL_ALLOWLIST !== "0";
        if (inspection && authorization.decision === "auto") {
          if (inspectionPath && session.permissionMode !== "bypass_permissions" && !(await this.confinedTarget(inspectionPath))) {
            const msg = JSON.stringify({error:"outside_workspace"});
            emitTerminal(msg,false,{execution:"not_executed",status:"rejected",reasonCode:"outside_workspace",reason:"outside_workspace",automaticEligibility:"not_eligible"});
            return msg;
          }
          const fixed = await new Promise<string>((resolve) => { const child=spawn(inspection.executable, inspection.args, {cwd:this.workspaceRoot,windowsHide:true}); let stdout="",stderr=""; child.stdout?.on("data",d=>{stdout+=d.toString();if(stdout.length>12000)stdout=stdout.slice(0,12000);}); child.stderr?.on("data",d=>{stderr+=d.toString();if(stderr.length>4000)stderr=stderr.slice(0,4000);}); child.on("close",code=>resolve(JSON.stringify({stdout,stderr,exit_code:code}))); child.on("error",e=>resolve(JSON.stringify({error:e.message,exit_code:null}))); });
          const fixedParsed=JSON.parse(fixed) as {exit_code?:number|null;error?:string}; const fixedOk=!fixedParsed.error&&(fixedParsed.exit_code===0||fixedParsed.exit_code===null); emitTerminal(fixed, fixedOk, { automaticEligibility: authorization.automaticEligibility }); this.completedToolCalls.set(ownerKey,{args:normalizedArgs,result:fixed}); return fixed;
        }
        // Generic shell is a workspace writer boundary: hold the same
        // cross-process lease used by structured edits for the duration of the
        // process. Read-only structured tools do not acquire this lease and
        // therefore remain available in another session.
        const shellLease = await this.mutation.acquire(this.workspaceRoot, call.id);
        let out: string;
        try {
          out = await runShell(
            capability,
            String(args.command ?? ""),
            Number(args.timeout_ms ?? 60_000),
            { enforceAllowlist },
          );
        } finally { shellLease.release(); }
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
        const listAuto =
          authorization.decision === "auto" &&
          authorization.automaticEligibility === "trusted_command_class";
        const bypassAuto = session.permissionMode === "bypass_permissions";
        emitTerminal(out, ok, {
          automaticEligibility: bypassAuto
            ? "bypass"
            : listAuto
              ? "trusted_command_class"
              : authorization.automaticEligibility === "fixed_inspection"
                ? "fixed_inspection"
                : "not_eligible",
          autoApplied: bypassAuto || listAuto,
        });
        this.completedToolCalls.set(ownerKey,{args:normalizedArgs,result:out}); return out;
      }

      // write
      if (!session.sessionWrite && session.permissionMode !== "bypass_permissions" && authorization.decision !== "auto") {
        let decision: string;
        try {
          decision = await this.waitPermission(
            call.id,
            "write",
            `Write: ${String(args.path ?? "")}`,
            executionOwner,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === "cancelled") {
            const msg = JSON.stringify({ error: "User denied write permission", execution: "not_executed" });
            emitTerminal(msg, false, {
              execution: "not_executed",
              status: "rejected",
              reasonCode: "authorization_refused",
              reason: "cancelled",
              automaticEligibility: authorization.automaticEligibility,
            });
            return msg;
          }
          throw err;
        }
        if (decision === "allow_session") session.sessionWrite = true;
        if (decision === "deny" || decision === "cancelled") {
          const msg = JSON.stringify({ error: "User denied write permission", execution: "not_executed" });
          emitTerminal(msg, false, {
            execution: "not_executed",
            status: "rejected",
            reasonCode: "authorization_refused",
            reason: decision === "cancelled" ? "cancelled" : "User denied write permission",
            automaticEligibility: authorization.automaticEligibility,
          });
          return msg;
        }
      }

      const editId = randomUUID();
      const edit = await prepareWriteEdit(
        this.workspaceRoot,
        name as "write_file" | "apply_patch",
        args,
        editId,
        session.permissionMode === "bypass_permissions",
      );
      session.pendingEdits.set(editId, edit);
      let action: "accept" | "reject";
      try {
        action = session.permissionMode === "bypass_permissions" || authorization.decision === "auto" || session.sessionWrite
          ? "accept"
          : await this.waitEdit(edit, executionOwner, call.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "cancelled") throw err;
        action = "reject";
      }
      if (action === "accept") {
        const lease = await this.mutation.acquire(this.workspaceRoot, call.id);
        try {
          // The edit was prepared before the cross-process lease was granted.
          // Re-read under the lease and reject a stale base rather than letting
          // a later session silently overwrite an overlapping mutation.
          const current = await fs.readFile(edit.absolutePath, "utf8").catch((e:any) => e?.code === "ENOENT" ? null : Promise.reject(e));
          const currentHash = this.mutation.baseHash(current);
          const expectedHash = this.mutation.baseHash(edit.previous);
          if (currentHash !== expectedHash) throw Object.assign(new Error("edit conflict"), { code: "edit_conflict" });
          const afterHash = crypto.createHash("sha256").update(edit.next).digest("hex");
          await this.editJournal.prepare({ editId: edit.id, workspace: this.workspaceRoot, kind: "content", target: edit.absolutePath, before: edit.previous, beforeHash: edit.previous === null ? null : crypto.createHash("sha256").update(edit.previous).digest("hex"), afterHash, diff: edit.diff, runId: executionOwner?.runId ?? `direct-${session.id}`, invocationId: call.id, policy: session.permissionMode ?? "review" });
          await applyPendingEdit(edit);
          await this.editJournal.markApplied(edit.id);
        } finally { lease.release(); }
        session.pendingEdits.delete(editId);
        this.notify("file_edit", {
          id: edit.id,
          path: edit.path,
          diff: edit.diff,
          status: "accepted",
          kind: "content",
        }, executionOwner);
        const out = JSON.stringify({
          ok: true,
          path: edit.path,
          status: "accepted",
        });
        const automaticallyApplied = session.permissionMode === "bypass_permissions" || authorization.decision === "auto";
        emitTerminal(out, true, { automaticEligibility: authorization.automaticEligibility, autoApplied: automaticallyApplied, editId: edit.id, diff: edit.diff, path: edit.path, kind: "content", recovery: { kind: "guarded_revert", available: true, status: "available" } });
        this.completedToolCalls.set(ownerKey,{args:normalizedArgs,result:out}); return out;
      }
      session.pendingEdits.delete(editId);
      this.notify("file_edit", {
        id: edit.id,
        path: edit.path,
        diff: edit.diff,
        status: "rejected",
        kind: "content",
      }, executionOwner);
      const out = JSON.stringify({
        ok: false,
        path: edit.path,
        status: "rejected",
      });
      emitTerminal(out, false, { editId: edit.id, diff: edit.diff, path: edit.path, kind: "content" });
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const out = JSON.stringify({ error: message });
      emitTerminal(out, false);
      return out;
    }
  }

  private mutationGateError(err: unknown): { reasonCode: string; reason: string } | null {
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    const gates = new Set(["missing_target", "non_regular_file", "non_regular_text", "dest_exists", "outside_workspace"]);
    if (code && gates.has(code)) return { reasonCode: code, reason: message || code };
    if (/escapes workspace/i.test(message)) return { reasonCode: "outside_workspace", reason: message };
    return null;
  }

  private async handleDeleteRenameTool(
    session: Session,
    call: ToolCall,
    name: "delete_file" | "rename_file",
    args: Record<string, unknown>,
    executionOwner: RunOwner | undefined,
    ownerKey: string,
    normalizedArgs: string,
    emitTerminal: (out: string, ok: boolean, extra?: Record<string, unknown>) => void,
  ): Promise<string> {
    const confined = name === "delete_file"
      ? await this.confinedTarget(String(args.path ?? ""))
      : (await this.confinedTarget(String(args.fromPath ?? ""))) && (await this.confinedTarget(String(args.toPath ?? "")));

    try {
      let edit: PendingEdit;
      try {
        const editId = randomUUID();
        edit = name === "delete_file"
          ? await prepareDeleteEdit(this.workspaceRoot, args, editId, session.permissionMode === "bypass_permissions")
          : await prepareRenameEdit(this.workspaceRoot, args, editId, session.permissionMode === "bypass_permissions");
      } catch (err) {
        const gate = this.mutationGateError(err);
        if (gate) {
          const msg = JSON.stringify({ error: gate.reason, execution: "not_executed", reasonCode: gate.reasonCode });
          emitTerminal(msg, false, {
            execution: "not_executed",
            status: "rejected",
            reasonCode: gate.reasonCode,
            reason: gate.reason,
            automaticEligibility: "not_eligible",
          });
          return msg;
        }
        throw err;
      }

      const authorization = this.authorization.authorize(
        { kind: "text_edit", regularText: true, exists: true },
        {
          mode: session.permissionMode ?? "review",
          confined,
          trustedCommandClasses: session.trustedCommandClasses ?? [],
        },
      );
      if (authorization.decision === "refuse") {
        const msg = JSON.stringify({ error: authorization.reason ?? "Tool refused" });
        emitTerminal(msg, false, {
          execution: "not_executed",
          status: "rejected",
          reasonCode: authorization.reason === "outside_workspace" ? "outside_workspace" : "authorization_refused",
          reason: authorization.reason ?? "Tool refused",
          automaticEligibility: authorization.automaticEligibility,
        });
        return msg;
      }

      if (!session.sessionWrite && session.permissionMode !== "bypass_permissions" && authorization.decision !== "auto") {
        let decision: string;
        try {
          decision = await this.waitPermission(
            call.id,
            "write",
            name === "delete_file"
              ? `Delete: ${String(args.path ?? "")}`
              : `Rename: ${String(args.fromPath ?? "")} → ${String(args.toPath ?? "")}`,
            executionOwner,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === "cancelled") {
            const msg = JSON.stringify({ error: "User denied write permission", execution: "not_executed" });
            emitTerminal(msg, false, {
              execution: "not_executed",
              status: "rejected",
              reasonCode: "authorization_refused",
              reason: "cancelled",
              automaticEligibility: authorization.automaticEligibility,
            });
            return msg;
          }
          throw err;
        }
        if (decision === "allow_session") session.sessionWrite = true;
        if (decision === "deny" || decision === "cancelled") {
          const msg = JSON.stringify({ error: "User denied write permission", execution: "not_executed" });
          emitTerminal(msg, false, {
            execution: "not_executed",
            status: "rejected",
            reasonCode: "authorization_refused",
            reason: decision === "cancelled" ? "cancelled" : "User denied write permission",
            automaticEligibility: authorization.automaticEligibility,
          });
          return msg;
        }
      }

      session.pendingEdits.set(edit.id, edit);
      let action: "accept" | "reject";
      try {
        action = session.permissionMode === "bypass_permissions" || authorization.decision === "auto" || session.sessionWrite
          ? "accept"
          : await this.waitEdit(edit, executionOwner, call.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "cancelled") throw err;
        action = "reject";
      }

      if (action === "accept") {
        const lease = await this.mutation.acquire(this.workspaceRoot, call.id);
        try {
          if (edit.kind === "delete") {
            const current = await fs.readFile(edit.absolutePath, "utf8").catch((e: any) => e?.code === "ENOENT" ? null : Promise.reject(e));
            if (this.mutation.baseHash(current) !== this.mutation.baseHash(edit.previous)) {
              throw Object.assign(new Error("edit conflict"), { code: "edit_conflict" });
            }
            await this.editJournal.prepare({
              editId: edit.id,
              workspace: this.workspaceRoot,
              kind: "delete",
              target: edit.absolutePath,
              before: edit.previous,
              beforeHash: crypto.createHash("sha256").update(edit.previous!).digest("hex"),
              afterHash: null,
              diff: null,
              runId: executionOwner?.runId ?? `direct-${session.id}`,
              invocationId: call.id,
              policy: session.permissionMode ?? "review",
            });
          } else {
            const current = await fs.readFile(edit.absoluteFromPath!, "utf8").catch((e: any) => e?.code === "ENOENT" ? null : Promise.reject(e));
            if (this.mutation.baseHash(current) !== this.mutation.baseHash(edit.previous)) {
              throw Object.assign(new Error("edit conflict"), { code: "edit_conflict" });
            }
            const fromRel = edit.fromPath ?? "";
            const toRel = edit.toPath ?? "";
            const caseOnly = fromRel !== toRel && fromRel.toLowerCase() === toRel.toLowerCase();
            const destExists = await fs.stat(edit.absoluteToPath!).then(() => true, () => false);
            if (destExists && !caseOnly) {
              throw Object.assign(new Error("edit conflict"), { code: "edit_conflict" });
            }
            const afterHash = crypto.createHash("sha256").update(edit.previous ?? "").digest("hex");
            await this.editJournal.prepare({
              editId: edit.id,
              workspace: this.workspaceRoot,
              kind: "rename",
              target: edit.absoluteToPath,
              fromPath: edit.fromPath,
              toPath: edit.toPath,
              fromPathAbs: edit.absoluteFromPath,
              toPathAbs: edit.absoluteToPath,
              before: edit.previous,
              beforeHash: afterHash,
              afterHash,
              diff: null,
              runId: executionOwner?.runId ?? `direct-${session.id}`,
              invocationId: call.id,
              policy: session.permissionMode ?? "review",
            });
          }
          await applyPendingEdit(edit);
          await this.editJournal.markApplied(edit.id);
        } finally { lease.release(); }
        session.pendingEdits.delete(edit.id);
        const acceptedPath = edit.kind === "rename" ? edit.toPath! : edit.path;
        this.notify("file_edit", {
          id: edit.id,
          editId: edit.id,
          path: acceptedPath,
          diff: edit.diff,
          status: "accepted",
          kind: edit.kind,
          fromPath: edit.fromPath ?? null,
          toPath: edit.toPath ?? null,
          toolCallId: call.id,
          invocationId: call.id,
        }, executionOwner);
        const out = JSON.stringify({ ok: true, path: acceptedPath, status: "accepted" });
        const automaticallyApplied = session.permissionMode === "bypass_permissions" || authorization.decision === "auto";
        emitTerminal(out, true, {
          automaticEligibility: authorization.automaticEligibility,
          autoApplied: automaticallyApplied,
          editId: edit.id,
          diff: edit.diff,
          path: acceptedPath,
          kind: edit.kind,
          fromPath: edit.fromPath ?? null,
          toPath: edit.toPath ?? null,
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        });
        this.completedToolCalls.set(ownerKey, { args: normalizedArgs, result: out });
        return out;
      }

      session.pendingEdits.delete(edit.id);
      this.notify("file_edit", {
        id: edit.id,
        path: edit.kind === "rename" ? edit.fromPath! : edit.path,
        diff: edit.diff,
        status: "rejected",
        kind: edit.kind,
        fromPath: edit.fromPath ?? null,
        toPath: edit.toPath ?? null,
      }, executionOwner);
      const out = JSON.stringify({ ok: false, path: edit.path, status: "rejected" });
      emitTerminal(out, false, {
        editId: edit.id,
        diff: edit.diff,
        path: edit.path,
        kind: edit.kind,
        fromPath: edit.fromPath ?? null,
        toPath: edit.toPath ?? null,
      });
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const out = JSON.stringify({ error: message });
      emitTerminal(out, false);
      return out;
    }
  }

  /** Backend test seam: executes the same production tool path used by prompt turns. */
  async executeTool(session: Session, call: ToolCall, owner?: RunOwner): Promise<string> {
    return this.handleToolCall(session, call, owner);
  }
}
