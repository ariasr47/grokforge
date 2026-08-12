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
  | { type: "tool_request"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; output: unknown }
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
      id?: string;
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
  env?: Record<string, string>;
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
