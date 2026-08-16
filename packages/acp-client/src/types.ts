/** Normalized UI events emitted by the ACP host client. */
export type AcpUiEvent =
  | { type: "text_delta"; text: string }
  /** Summarized model reasoning / think-aloud (when API provides it). */
  | { type: "thinking_delta"; text: string }
  /** High-level run phase for progress UI. */
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
  | { type: "agent_log"; level: "debug" | "info" | "warn"; message: string };

export type AuthMode = "signed_out" | "api_key" | "sub_pool";

export type PermissionDecision = "allow_once" | "allow_session" | "deny";

export interface AgentSpawnConfig {
  /** Absolute path to workspace root (agent cwd). */
  workspaceRoot: string;
  /** Command to spawn, e.g. "node". */
  command: string;
  /** Args for the agent process. */
  args: string[];
  env: Readonly<Record<string, string>>;
  executionProfile: HostExecutionProfile;
}

export type ToolReasonCode = "shell_resolution_failed" | "unsupported_platform" | "shell_dialect_incompatible" | "leading_command_unresolved";
export type HostExecutionProfile =
  | { status: "available"; platform: string; osFamily: "windows" | "macos" | "linux"; executable: string; argvPrefix: readonly string[]; displayName: string; dialect: "cmd" | "posix"; pathSeparator: "\\" | "/"; syntax: { quoting: string; chaining: string; redirection: string } }
  | { status: "unavailable"; platform: string; osFamily: "windows" | "macos" | "linux" | "unsupported"; executable: null; argvPrefix: readonly []; displayName: null; dialect: null; pathSeparator: "\\" | "/"; syntax: null; reasonCode: "shell_resolution_failed" | "unsupported_platform"; reason: string };
export type ToolRunEvent = {
  type: "tool_run"; schemaVersion: 2; activityId: string; toolCallId: string; lifecycle: "pending" | "terminal"; execution: null | "executed" | "not_executed"; status: "running" | "succeeded" | "failed" | "rejected"; name: string | null; input: unknown | null; summary: string | null; command: string | null; output: string | null; error: string | null; reasonCode: ToolReasonCode | null; reason: string | null; shellDisplayName: string | null; detailAvailable: boolean;
};
export function isValidToolRunEvent(value: unknown): value is ToolRunEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  const required = ["schemaVersion", "type", "activityId", "toolCallId", "lifecycle", "execution", "status", "name", "input", "summary", "command", "output", "error", "reasonCode", "reason", "shellDisplayName", "detailAvailable"];
  if (required.some((key) => !(key in e)) || e.schemaVersion !== 2 || e.type !== "tool_run" || typeof e.activityId !== "string" || !e.activityId || typeof e.toolCallId !== "string" || !e.toolCallId || typeof e.detailAvailable !== "boolean") return false;
  if (!["name", "summary", "command", "output", "error", "reasonCode", "reason", "shellDisplayName"].every((key) => e[key] === null || typeof e[key] === "string")) return false;
  const reasonCodes = new Set(["shell_resolution_failed", "unsupported_platform", "shell_dialect_incompatible", "leading_command_unresolved"]);
  if (e.lifecycle === "pending") return e.execution === null && e.status === "running" && e.output === null && e.error === null && e.reasonCode === null && e.reason === null;
  if (e.lifecycle !== "terminal") return false;
  if (e.execution === "not_executed") return e.status === "rejected" && typeof e.command === "string" && !!e.command && typeof e.reasonCode === "string" && reasonCodes.has(e.reasonCode) && typeof e.reason === "string" && !!e.reason && e.error === null;
  if (e.execution === "executed" && e.status === "succeeded") return e.reasonCode === null && e.reason === null && e.error === null;
  if (e.execution === "executed" && e.status === "failed") return typeof e.error === "string" && !!e.error && e.reasonCode === null && e.reason === null;
  return false;
}

export interface PromptOptions {
  model?: string;
  reasoning_effort?: "low" | "medium" | "high";
}

export interface AcpClient {
  initialize(): Promise<void>;
  newSession(): Promise<string>;
  prompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions,
  ): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  onEvent(handler: (event: AcpUiEvent) => void): () => void;
  respondPermission(id: string, decision: PermissionDecision): Promise<void>;
  respondEdit?(
    id: string,
    action: "accept" | "reject",
    sessionId?: string,
  ): Promise<void>;
}
