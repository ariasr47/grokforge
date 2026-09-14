/** Normalized UI events emitted by the ACP host client. */
// AcpUiEvent is vendor ACP session/update, not a Forge classifier.
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
      kind: "write" | "shell" | "ask";
      detail: string;
      /** Vendor toolCallId when present — File changes membership joins on this, not the RPC id. */
      toolCallId?: string | null;
    }
  | {
      type: "file_edit";
      path: string;
      diff: string | null;
      status: "proposed" | "accepted" | "rejected";
      id: string;
      editId?: string;
      invocationId?: string;
      toolCallId?: string;
      kind?: "content" | "delete" | "rename";
      fromPath?: string | null;
      toPath?: string | null;
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
      type: "project_instructions";
      schemaVersion: 1;
      status: "present" | "absent" | "failed";
      inclusion: "included" | "not_included" | "failed";
      path: string | null;
      bodyByteLength: number | null;
    }
  | {
      type: "usage";
      schemaVersion: 1;
      /** Real prompt-token count the provider reported — never estimated. */
      promptTokens: number;
      /** Model catalog's sourced context window, or null when unknown. */
      contextWindow: number | null;
    }
  | {
      type: "available_commands";
      commands: Array<{ name: string; description: string | null }> | null;
      valid: boolean;
    }
  | {
      type: "child_agent";
      childId: string;
      identityLabel: string;
      status: "running" | "done" | "failed";
    }
  | {
      type: "mcp_server";
      serverId: string;
      name: string | null;
      status: "connected" | "idle" | "error";
    }
  | {
      type: "hook";
      hookId: string;
      name: string | null;
      status: "running" | "idle" | "done" | "failed";
    }
  | {
      type: "vendor_plan_exit";
      id: string;
      planContent: string | null;
    };

export type AuthMode = "signed_out" | "api_key" | "sub_pool";

// Shell Allow may include an edited command string.
export type PermissionDecision = "allow_once" | "allow_session" | "deny" | `option:${number}`;

/** Ownership tuple carried on every prompt-owned ACP frame. */
export interface AcpOwnership {
  sessionId: string;
  runId: string;
  connectionGeneration: number;
}

export interface AgentSpawnConfig {
  /** Absolute path to workspace root (agent cwd). */
  workspaceRoot: string;
  /** Command to spawn, e.g. "node". */
  command: string;
  /** Args for the agent process. */
  args: string[];
  env: Readonly<Record<string, string>>;
  executionProfile: HostExecutionProfile;
  /** Vendor Code initialize — exact string "default". Omit for grok-acp. */
  initializePermissionMode?: "default";
  /** Vendor grok agent: call `authenticate` after session/new. Omit for grok-acp. */
  authenticateMethod?: "cached_token";
}

export type ToolReasonCode = "shell_resolution_failed" | "unsupported_platform" | "shell_dialect_incompatible" | "leading_command_unresolved" | "protected_recursive_delete" | "outside_workspace" | "authorization_refused" | "plan_phase_refused" | "missing_target" | "non_regular_file" | "non_regular_text" | "dest_exists";
export type HostExecutionProfile =
  | { status: "available"; platform: string; osFamily: "windows" | "macos" | "linux"; executable: string; argvPrefix: readonly string[]; displayName: string; dialect: "cmd" | "posix"; pathSeparator: "\\" | "/"; syntax: { quoting: string; chaining: string; redirection: string } }
  | { status: "unavailable"; platform: string; osFamily: "windows" | "macos" | "linux" | "unsupported"; executable: null; argvPrefix: readonly []; displayName: null; dialect: null; pathSeparator: "\\" | "/"; syntax: null; reasonCode: "shell_resolution_failed" | "unsupported_platform"; reason: string };
export type ToolRunEvent = {
  type: "tool_run"; schemaVersion: 2; activityId: string; toolCallId: string; lifecycle: "pending" | "terminal"; execution: null | "executed" | "not_executed"; status: "running" | "succeeded" | "failed" | "rejected"; name: string | null; input: unknown | null; summary: string | null; command: string | null; output: string | null; error: string | null; reasonCode: ToolReasonCode | null; reason: string | null; shellDisplayName: string | null; detailAvailable: boolean;
  automaticEligibility?: "read" | "fixed_inspection" | "text_edit" | "bypass" | "trusted_command_class" | "not_eligible";
  autoApplied?: boolean;
  editId?: string | null;
  diff?: string | null;
  path?: string | null;
  kind?: "content" | "delete" | "rename" | null;
  fromPath?: string | null;
  toPath?: string | null;
  recovery?: null | { kind: "guarded_revert"; available: boolean; status: "available" | "pending" | "reverted" | "conflict" | "failed" };
  /** Preserved public ACP ToolKind. Elevation requires literal "fetch". */
  acpToolKind?: string | null;
  /** Vouched URL from named vendor keys — never invent. */
  url?: string | null;
  /** Vouched title from the vendor `title` key — never invent. */
  title?: string | null;
  /** Caption-only snapshot signal (v1). No media bytes. */
  snapshotJournaled?: boolean;
};
export function isValidToolRunEvent(value: unknown): value is ToolRunEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  const required = ["schemaVersion", "type", "activityId", "toolCallId", "lifecycle", "execution", "status", "name", "input", "summary", "command", "output", "error", "reasonCode", "reason", "shellDisplayName", "detailAvailable"];
  if (required.some((key) => !(key in e)) || e.schemaVersion !== 2 || e.type !== "tool_run" || typeof e.activityId !== "string" || !e.activityId || typeof e.toolCallId !== "string" || !e.toolCallId || typeof e.detailAvailable !== "boolean") return false;
  if (!["name", "summary", "command", "output", "error", "reasonCode", "reason", "shellDisplayName"].every((key) => e[key] === null || typeof e[key] === "string")) return false;
  const reasonCodes = new Set(["shell_resolution_failed", "unsupported_platform", "shell_dialect_incompatible", "leading_command_unresolved", "protected_recursive_delete", "outside_workspace", "authorization_refused", "plan_phase_refused", "missing_target", "non_regular_file", "non_regular_text", "dest_exists"]);
  if (e.lifecycle === "pending") return e.execution === null && e.status === "running" && e.output === null && e.error === null && e.reasonCode === null && e.reason === null;
  if (e.lifecycle !== "terminal") return false;
  if (e.execution === "not_executed") return e.status === "rejected" && (e.name === "run_shell" ? typeof e.command === "string" && !!e.command : e.command === null) && typeof e.reasonCode === "string" && reasonCodes.has(e.reasonCode) && typeof e.reason === "string" && !!e.reason && e.error === null;
  if (e.execution === "executed" && e.status === "succeeded") return e.reasonCode === null && e.reason === null && e.error === null;
  if (e.execution === "executed" && e.status === "failed") return typeof e.error === "string" && !!e.error && e.reasonCode === null && e.reason === null;
  return false;
}

export interface PromptOptions {
  model?: string;
  reasoning_effort?: "low" | "medium" | "high";
  /** Stable prompt ownership; required by reliable-run callers. */
  runId?: string;
  connectionGeneration?: number;
  policy?: Record<string, unknown>;
  /** Frozen Trusted command-class ids for this generation (host-owned). */
  trustedCommandClasses?: readonly string[];
  history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Snapshotted at host admit; immutable for this run ownership. */
  executionPhase?: "plan" | "execute";
  /** Host-held Always-this-chat grants, restored after ACP reclaim. */
  sessionWrite?: boolean;
  sessionShell?: boolean;
  /** Workspace-relative writes the user denied this session; sessionWrite must not cover them. */
  deniedWritePaths?: readonly string[];
}

export interface AcpClient {
  initialize(): Promise<void>;
  newSession(): Promise<string>;
  prompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions,
  ): Promise<void>;
  cancel?(ownership?: AcpOwnership): Promise<void>;
  dispose(): Promise<void>;
  onEvent(handler: (event: AcpUiEvent) => void): () => void;
  respondPermission(id: string, decision: PermissionDecision, ownership?: AcpOwnership, command?: string): Promise<void>;
  respondEdit?(
    id: string,
    action: "accept" | "reject",
    sessionId?: string,
    ownership?: AcpOwnership,
  ): Promise<void>;
  respondPlanExit?(id: string, outcome: "approved" | "cancelled" | "abandoned"): Promise<boolean>;
}
