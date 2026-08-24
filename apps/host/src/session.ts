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
import { resolveHostExecutionEnvironment, type ShellCapabilityView } from "./executionEnvironment.js";
import { RunJournal } from "./run-journal.js";
import { RunCoordinator } from "./run-coordinator.js";
import { randomUUID } from "node:crypto";
import type { ActivityRecord, DecisionKind, PlanRecord, PolicySnapshot, RunEventEnvelope, RunSnapshot, TerminalKind } from "./run-types.js";
import { exploringPlanRecord, planDecisionTitle, terminalPlanRecord } from "./plan-record.js";
import { dataDir } from "./channel.js";
import { WorkspacePolicyStore, type WorkspacePolicyView } from "./workspace-policy.js";
import {
  TrustedCommandClassStore,
  type TrustedCommandClassId,
  type TrustedCommandClassesView,
} from "./trusted-command-classes.js";
import { BypassActivation } from "./bypass-activation.js";
import { resolveProjectInstructions } from "./project-instructions.js";

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
  | RunEventEnvelope
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

export function activityRecordFromToolRun(
  ev: Extract<AcpUiEvent, { type: "tool_run" }> & { path?: string | null },
  policy: PolicySnapshot,
): ActivityRecord {
  const path =
    typeof (ev as { path?: unknown }).path === "string" && (ev as { path: string }).path.length > 0
      ? (ev as { path: string }).path
      : null;
  return {
    activityId: ev.activityId,
    invocationId: ev.toolCallId,
    name: ev.name ?? "tool",
    lifecycle: ev.lifecycle,
    execution: ev.execution,
    status: ev.status,
    input: ev.input,
    output: ev.output,
    error: ev.error ?? ev.reason ?? ev.reasonCode,
    diff: ev.diff ?? null,
    path,
    policy,
    automaticEligibility: ev.automaticEligibility ?? "not_eligible",
    autoApplied: ev.autoApplied === true,
    command: typeof ev.command === "string" ? ev.command : null,
    editId: ev.editId ?? null,
    recovery: ev.recovery ?? null,
  };
}

export function activityRecordFromProposedEdit(input: {
  editId: string;
  invocationId: string;
  path: string;
  diff: string;
  policy: PolicySnapshot;
}): ActivityRecord {
  return {
    activityId: input.editId,
    invocationId: input.invocationId,
    name: "write_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: input.path },
    output: null,
    error: null,
    diff: input.diff,
    path: input.path,
    policy: input.policy,
    automaticEligibility: "not_eligible",
    autoApplied: false,
    command: null,
    editId: input.editId,
    recovery: null,
  };
}

export function retainActivityAfterDiff(
  prior: ActivityRecord | null | undefined,
  input: {
    editId: string;
    invocationId: string;
    action: "accept" | "reject";
    policy: PolicySnapshot;
  },
): ActivityRecord {
  return {
    activityId: prior?.activityId ?? input.editId,
    invocationId: input.invocationId,
    name: prior?.name ?? "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: input.action === "accept" ? "succeeded" : "rejected",
    input: prior?.input ?? null,
    output: prior?.output ?? null,
    error: null,
    diff: prior?.diff ?? null,
    path: prior?.path ?? null,
    policy: input.policy,
    automaticEligibility: prior?.automaticEligibility ?? "not_eligible",
    autoApplied: false,
    command: null,
    editId: input.editId,
    recovery: null,
  };
}

export function retainActivityAfterRecovery(
  prior: ActivityRecord | null | undefined,
  input: {
    editId: string;
    status: "reverted" | "conflict";
    fallbackDiff: string | null;
    policy: PolicySnapshot;
  },
): ActivityRecord {
  return {
    activityId: prior?.activityId ?? input.editId,
    invocationId: prior?.invocationId ?? "",
    name: prior?.name ?? "edit",
    lifecycle: "terminal",
    execution: "executed",
    status: input.status === "reverted" ? "succeeded" : "failed",
    input: prior?.input ?? null,
    output: prior?.output ?? null,
    error: input.status === "reverted" ? null : "Edit not reverted",
    diff: prior?.diff ?? input.fallbackDiff,
    path: prior?.path ?? null,
    policy: input.policy,
    automaticEligibility: prior?.automaticEligibility ?? "text_edit",
    autoApplied: prior?.autoApplied === true,
    command: prior?.command ?? null,
    editId: input.editId,
    recovery: {
      kind: "guarded_revert",
      available: prior?.recovery?.available ?? true,
      status: input.status,
    },
  };
}

export function classifyToolRunLog(event: Extract<AcpUiEvent, { type: "tool_run" }>): { message: "tool_not_executed" | "tool_failed" | null; fields: Record<string, unknown> } {
  if (event.lifecycle !== "terminal") return { message: null, fields: {} };
  if (event.execution === "not_executed" && event.status === "rejected") return { message: "tool_not_executed", fields: { toolCallId:event.toolCallId, command:event.command, reasonCode:event.reasonCode, reason:event.reason, shellDisplayName:event.shellDisplayName } };
  if (event.execution === "executed" && event.status === "failed") return { message: "tool_failed", fields: { toolCallId:event.toolCallId, command:event.command, error:event.error } };
  return { message: null, fields: {} };
}

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
  shellCapability: ShellCapabilityView;
  modelSelectionProvenance: "inherited" | "explicit";
  modelMigrationRule: "legacy_grok_4_to_grok_4_6" | null;
  activeRunCount: number;
  session: { sessionId:string; activeRunId:string|null; effectivePermissionMode:"review"|"trusted_workspace"|"bypass_permissions" } | null;
  permissionPolicy: { status:"confirmed"; workspace:string; storedMode:"review"|"trusted_workspace"|null; effectiveMode:"review"|"trusted_workspace"; source:"default"|"saved"|"fallback"; revision:string; fallbackReason:"missing"|"invalid"|"unreadable"|null; savedForWorkspace:boolean };
  bypassPermissions: { unlocked:boolean; available:boolean; activeForSession:boolean; blockedReason:"managed_disabled"|"local_attestation_required"|"unlock_required"|null; confirmationVersion:number|null };
  planEngagement: PlanEngagementView;
  projectInstructions: ProjectInstructionsPresenceView;
}

export type PlanEngagementView = { engaged: boolean; vouched: boolean };

/** Workspace recipe presence for the bound root. Always present on PublicState. */
export type ProjectInstructionsPresenceView = {
  status: "present" | "absent" | "failed";
  path: string | null;
  vouched: boolean;
};

export class AgentSession {
  private client: StdioAcpClient | null = null;
  private sessionId: string | null = null;
  private stableClientSessionId: string | null = null;
  private workspace: string | null = null;
  private busy = false;
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
  private readonly runCoordinator = new RunCoordinator(new RunJournal(dataDir()), (event) => this.emit(event));
  private readonly runHydration: Promise<void>;
  private readonly workspacePolicies = new WorkspacePolicyStore(dataDir());
  private policyView: WorkspacePolicyView | null = null;
  private readonly trustedCommandClasses = new TrustedCommandClassStore(dataDir());
  private trustedClassesView: TrustedCommandClassesView | null = null;
  private trustedClassesSnapshot: TrustedCommandClassId[] = [];
  private bypassActive = false;
  private static readonly activation = new BypassActivation(process.env.GROKFORGE_BYPASS_SECRET ?? "");
  private bypassView() {
    const managedDisabled = process.env.GROKFORGE_MANAGED_BYPASS_DISABLED === "1" || process.env.GROKFORGE_BYPASS_DISABLED === "1";
    const available = AgentSession.activation.available && !managedDisabled;
    return { unlocked: false, available, activeForSession: this.bypassActive, blockedReason: managedDisabled ? "managed_disabled" as const : (available ? "unlock_required" as const : "local_attestation_required" as const), confirmationVersion: null };
  }
  private activeRunId: string | null = null;
  private connectionGeneration = 0;
  private sessionWriteGrant = false;
  private sessionShellGrant = false;
  private pendingDecisions = new Map<string,{sessionId:string;runId:string;generation:number;invocationId:string;kind:DecisionKind;permissionKind?:"write"|"shell";status:"pending"|"accepted"|"declined"|"expired"|"kept_planning"|"cancelled";expiresAt:number}>();
  private planEngaged = false;
  private planEngagementVouched = true;
  private lastReadyPlanRunId: string | null = null;
  private projectInstructionsCache: ProjectInstructionsPresenceView = { status: "absent", path: null, vouched: true };
  private projectInstructionsProbeRoot: string | null = null;
  private projectInstructionsVouched = true;
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
  private readonly executionEnvironment = resolveHostExecutionEnvironment({ platform: process.platform, environment: process.env });
  private readonly ready: Promise<void>;

  constructor(stableSessionId?: string) {
    this.stableClientSessionId = stableSessionId ?? null;
    this.runHydration = this.runCoordinator.hydrate(stableSessionId).then(() => this.restorePlanDecisions()).catch((error) => { throw Object.assign(new Error("Run journal unavailable"), { code: "journal_unavailable", cause: error }); });
    this.cfg = loadConfig();
    if (!this.cfg.mode) this.cfg.mode = "chat";
    if (!this.cfg.effort) this.cfg.effort = "auto";
    if (this.cfg.mode === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
    } else if (this.cfg.lastWorkspace && fs.existsSync(this.cfg.lastWorkspace)) {
      this.workspace = this.cfg.lastWorkspace;
    }
    if (process.env.GROKFORGE_PLAN_UNVOUCHED === "1") this.planEngagementVouched = false;
    if (process.env.GROKFORGE_PROJECT_INSTRUCTIONS_UNVOUCHED === "1") this.projectInstructionsVouched = false;
    this.ready = this.hydrateWorkspacePolicy(this.workspace).then(() => this.refreshProjectInstructionsPresence());
  }

  private async hydrateWorkspacePolicy(workspace: string | null): Promise<void> {
    if (!workspace) return;
    try {
      this.policyView = await this.workspacePolicies.read(workspace);
    } catch {
      this.policyView = { status: "confirmed", workspace: path.resolve(workspace), storedMode: null, effectiveMode: "review", source: "fallback", revision: "fallback", fallbackReason: "invalid", savedForWorkspace: false };
    }
    try {
      this.trustedClassesView = await this.trustedCommandClasses.read(workspace);
      this.trustedClassesSnapshot = this.trustedClassesView.classes.slice();
    } catch {
      this.trustedClassesView = null;
      this.trustedClassesSnapshot = [];
    }
  }

  /** State surfaces await this before reading the first post-reload snapshot. */
  async awaitReady(): Promise<void> { await this.ready; }

  /** Refresh current-workspace policy so legacy state reflects stable-session saves. */
  async refreshWorkspacePolicy(): Promise<void> {
    await this.ready;
    if (!this.workspace) return;
    try { this.policyView = await this.workspacePolicies.read(this.workspace); }
    catch { /* retain the confirmed fallback already established during hydration */ }
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
      shellCapability: this.executionEnvironment.publicView,
      modelSelectionProvenance: this.cfg.modelSelectionProvenance,
      modelMigrationRule: null,
      activeRunCount: this.busy ? 1 : 0,
      session: this.stableClientSessionId ? { sessionId: this.stableClientSessionId, activeRunId: this.activeRunId, effectivePermissionMode: this.bypassActive ? "bypass_permissions" : (this.policyView?.effectiveMode ?? "review") } : null,
      permissionPolicy: this.policyView ?? { status:"confirmed", workspace:this.workspace || "", storedMode:null, effectiveMode:"review", source:"fallback", revision:"fallback", fallbackReason:"missing", savedForWorkspace:false },
      bypassPermissions: this.bypassView(),
      planEngagement: this.planEngagementView(),
      projectInstructions: this.projectInstructionsView(),
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
    };
  }

  private planEngagementView(): PlanEngagementView {
    if (this.cfg.mode !== "code") return { engaged: false, vouched: true };
    return { engaged: this.planEngaged, vouched: this.planEngagementVouched };
  }

  private projectInstructionsView(): ProjectInstructionsPresenceView {
    if (this.cfg.mode !== "code" || !this.workspace) {
      return { status: "absent", path: null, vouched: true };
    }
    const vouched =
      this.projectInstructionsVouched !== false &&
      process.env.GROKFORGE_PROJECT_INSTRUCTIONS_UNVOUCHED !== "1";
    const cache = this.projectInstructionsCache ?? { status: "absent" as const, path: null };
    return {
      status: cache.status,
      path: cache.path,
      vouched,
    };
  }

  async refreshProjectInstructionsPresence(): Promise<void> {
    if (process.env.GROKFORGE_PROJECT_INSTRUCTIONS_UNVOUCHED === "1") {
      this.projectInstructionsVouched = false;
    }
    if (this.cfg.mode !== "code" || !this.workspace) {
      this.projectInstructionsCache = { status: "absent", path: null, vouched: true };
      this.projectInstructionsProbeRoot = null;
      return;
    }
    const root = this.workspace;
    if (this.projectInstructionsProbeRoot !== root) {
      this.projectInstructionsCache = { status: "absent", path: null, vouched: false };
      this.projectInstructionsProbeRoot = root;
    }
    const snap = await resolveProjectInstructions(root);
    if (this.workspace !== root || this.cfg.mode !== "code") return;
    this.projectInstructionsCache = {
      status: snap.status,
      path: snap.path,
      vouched:
        this.projectInstructionsVouched &&
        process.env.GROKFORGE_PROJECT_INSTRUCTIONS_UNVOUCHED !== "1",
    };
  }

  setProjectInstructionsVouched(vouched: boolean): PublicState {
    this.projectInstructionsVouched = vouched;
    this.projectInstructionsCache = { ...this.projectInstructionsCache, vouched };
    this.broadcastState();
    return this.getState();
  }

  setPlanEngagement(engaged: boolean): PublicState {
    if (this.cfg.mode !== "code") {
      throw Object.assign(new Error("Plan is not applicable in Chat"), { code: "plan_not_applicable" });
    }
    if (!this.planEngagementVouched) {
      throw Object.assign(new Error("Plan engagement cannot be vouched"), { code: "plan_engagement_unvouched" });
    }
    if (!engaged) this.cancelPendingPlanDecision();
    this.planEngaged = engaged;
    this.broadcastState();
    return this.getState();
  }

  /** Test seam: flipping vouched false→true clears engaged. */
  setPlanEngagementVouched(vouched: boolean): PublicState {
    const was = this.planEngagementVouched;
    this.planEngagementVouched = vouched;
    if (!was && vouched) this.planEngaged = false;
    this.broadcastState();
    return this.getState();
  }

  resolveExecutionPhaseForAdmit(mode: ProductMode = this.cfg.mode === "code" ? "code" : "chat"): "plan" | "execute" {
    if (mode === "code") {
      if (!this.planEngagementVouched) {
        throw Object.assign(new Error("Plan engagement cannot be vouched"), { code: "plan_engagement_unvouched" });
      }
      if (this.hasPendingPlanDecision()) {
        throw Object.assign(new Error("A plan decision is still pending"), { code: "plan_decision_pending" });
      }
    }
    return mode === "code" && this.planEngaged && this.planEngagementVouched ? "plan" : "execute";
  }

  private hasPendingPlanDecision(): boolean {
    for (const pending of this.pendingDecisions.values()) {
      if (pending.kind === "plan" && pending.status === "pending") return true;
    }
    return false;
  }

  private isDecisionExpired(_pending: { kind: DecisionKind; expiresAt: number } | undefined): boolean {
    return false;
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
      this.cfg.modelSelectionProvenance = "explicit";
      this.cfg.modelMigrationVersion = 1;
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
    await this.refreshProjectInstructionsPresence();
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
    this.sessionWriteGrant = false;
    this.sessionShellGrant = false;
    this.projectInstructionsCache = { status: "absent", path: null, vouched: false };
    this.projectInstructionsProbeRoot = resolved;
    // Hydrate the durable workspace policy before the first state snapshot. A
    // fresh AgentSession must never report fallback Review when a confirmed
    // policy already exists on disk.
    this.policyView = await this.workspacePolicies.read(resolved);
    this.trustedClassesView = await this.trustedCommandClasses.read(resolved);
    this.trustedClassesSnapshot = this.trustedClassesView.classes.slice();
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
    await this.refreshProjectInstructionsPresence();
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
        executionProfile: this.executionEnvironment.profile,
        env: Object.freeze({
          ...Object.fromEntries(Object.entries(this.executionEnvironment.effectiveEnvironment).filter(([key]) => key !== "GROKFORGE_BYPASS_SECRET")),
          XAI_API_KEY: token ?? "",
          XAI_MODEL: this.cfg.model,
          GROKFORGE_MODE: mode,
          GROKFORGE_SHELL_ALLOWLIST:
            this.cfg.shellAllowlist === false ? "0" : "1",
          GROKFORGE_DATA_DIR: dataDir(),
        }),
      });
      this.client = client;
      /** Cache tool names for result logging. */
      const toolNames = new Map<string, string>();
      const gen = client; // capture for exit handler
      // ACP notifications are delivered by StdioAcpClient without awaiting listeners. Keep a
      // per-generation FIFO so activity/decision events are durably appended before a following
      // done/error can finalize the run. A replaced client is rejected at the queue boundary.
      let eventChain: Promise<void> = Promise.resolve();
      client.onEvent((ev) => {
        eventChain = eventChain.then(async () => {
        // Ignore events from a disposed/replaced client
        if (this.client !== gen) return;
        if (ev.type === "project_instructions" && this.activeRunId) {
          const run = this.runCoordinator.get(this.activeRunId);
          if (run) {
            const voucher = {
              runId: run.runId,
              sessionId: run.sessionId,
              connectionGeneration: run.connectionGeneration,
              inclusion: ev.inclusion,
              path: ev.inclusion === "not_included" ? null : ev.path,
            };
            await this.runCoordinator.appendOwnedEvent(
              this.activeRunId,
              { kind: "project_instructions", projectInstructions: voucher },
              "project_instructions",
            ).catch(() => undefined);
          }
          return;
        }
        if (ev.type === "tool_run") {
          toolNames.set(ev.toolCallId, ev.name ?? "tool");
          const taxonomy = classifyToolRunLog(ev);
          if (taxonomy.message) log("warn", taxonomy.message, taxonomy.fields);
          log("debug", "tool request", {
            id: ev.toolCallId,
            name: ev.name,
            sessionId: this.sessionId,
          });
          if (this.activeRunId) { const run=this.runCoordinator.get(this.activeRunId); if(run){ const activity=activityRecordFromToolRun(ev, run.policy); const envelope=await this.runCoordinator.appendOwnedEvent(this.activeRunId,{kind:"activity_update",activity},"activity_update").catch(()=>undefined); if(envelope){ return;} } }
        }
        if (ev.type === "tool_run" && ev.lifecycle === "terminal" && ev.execution === "executed") {
          const name = toolNames.get(ev.toolCallId) || "tool";
          const meta = summarizeToolOutput(ev.output);
          if (ev.status === "failed") {
            log("warn", "tool failed", {
              id: ev.toolCallId,
              name,
              sessionId: this.sessionId,
              ...meta,
            });
          } else {
            log("debug", "tool ok", {
              id: ev.toolCallId,
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
          if (this.activeRunId) { const run=this.runCoordinator.get(this.activeRunId); if(run){ this.pendingDecisions.set(ev.id,{sessionId:run.sessionId,runId:run.runId,generation:run.connectionGeneration,invocationId:ev.id,kind:"permission",permissionKind:ev.kind,status:"pending",expiresAt:0}); const envelope=await this.runCoordinator.appendOwnedEvent(this.activeRunId,{kind:"decision_request",request:{requestId:ev.id,invocationId:ev.id,kind:"permission",status:"pending",title:ev.kind==="shell"?"Run shell":"Write file",detail:ev.detail,expiresAt:null,policy:run.policy}},"decision_request").catch(()=>undefined); if(envelope){ return;} } }
        }
        if (ev.type === "file_edit") {
          if (ev.status !== "proposed") { return; }
          if (this.activeRunId) {
            const run=this.runCoordinator.get(this.activeRunId);
            if(run){
              const editId=ev.editId??ev.id;
              const invocationId=ev.invocationId??ev.toolCallId??editId;
              this.pendingDecisions.set(ev.id,{sessionId:run.sessionId,runId:run.runId,generation:run.connectionGeneration,invocationId,kind:"diff",status:"pending",expiresAt:0});
              const envelope=await this.runCoordinator.appendOwnedEvent(this.activeRunId,{kind:"decision_request",request:{requestId:ev.id,invocationId,kind:"diff",status:"pending",title:"Edit file",detail:ev.path,expiresAt:null,policy:run.policy}},"decision_request").catch(()=>undefined);
              if (ev.path && ev.diff && editId) {
                const activity=activityRecordFromProposedEdit({editId,invocationId,path:ev.path,diff:ev.diff,policy:run.policy});
                await this.runCoordinator.appendOwnedEvent(this.activeRunId,{kind:"activity_update",activity},"activity_update").catch(()=>undefined);
              }
              if(envelope){ return; }
            }
          }
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
                  runId: this.activeRunId ?? "",
                  connectionGeneration: this.connectionGeneration,
                  policy: this.workspace ? await this.workspacePolicies.snapshot(this.workspace, this.bypassActive) : { workspace:"", storedMode:null, effectiveMode:"review" as const, source:"fallback" as const, revision:"fallback", fallbackReason:"missing" as const, snapshottedAt:new Date().toISOString() },
                  executionPhase: this.runCoordinator.get(this.activeRunId ?? "")?.executionPhase ?? "execute",
                  sessionWrite: this.sessionWriteGrant,
                  sessionShell: this.sessionShellGrant,
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
        if (this.activeRunId && ev.type === "text_delta" && ev.text) {
          await this.runCoordinator.appendOwnedEvent(this.activeRunId, { kind: "answer_delta", segmentId: `answer-${this.activeRunId}`, delta: ev.text }, "answer_delta").catch(() => undefined);
        }
        if (this.activeRunId && ev.type === "thinking_delta" && ev.text) {
          await this.runCoordinator.appendOwnedEvent(this.activeRunId, { kind: "reasoning_delta", segmentId: `reasoning-${this.activeRunId}`, delta: ev.text }, "reasoning_delta").catch(() => undefined);
        }
        if (this.activeRunId && ev.type === "run_phase" && ev.phase !== "done") {
          const liveness = ev.phase === "tools" ? "tool" : "provider";
          const recovering = ev.phase === "waiting_model" || /recover/i.test(String(ev.detail ?? ""));
          const envelope = await this.runCoordinator.appendOwnedEvent(this.activeRunId, { kind: "run_state", state: recovering ? "recovering" : "running", liveness }, "run_state").catch(() => undefined);
          if (envelope) return;
        }
        if (ev.type === "done" || ev.type === "error") {
          if (this.activeRunId) {
            const active = this.runCoordinator.get(this.activeRunId);
            await this.cancelPendingToolDecisions(this.activeRunId);
            const terminal = active?.state === "cancelling" ? "cancelled" : (ev.type === "done" && ev.reason !== "error" ? "answered" : "failed");
            const failureCode = ev.type === "error" ? ({missing_final_answer:"missing_final_answer",provider_liveness_timeout:"provider_liveness_exhausted",provider_liveness_exhausted:"provider_liveness_exhausted",auth_missing:"authentication_required",configuration_required:"configuration_required",execution_owner_lost:"execution_owner_lost"} as Record<string,any>)[ev.code] ?? "provider_unavailable" : null;
            if (active?.executionPhase === "plan") {
              await this.settlePlanPhase(active, terminal, this.runCoordinator.getAccumulatedAnswer(this.activeRunId) || null);
            }
            await this.runCoordinator.finalize(this.activeRunId, terminal, null,
              ev.type === "error" ? { code: failureCode, message: ev.code === "missing_final_answer" ? "No final answer was produced." : "Provider execution failed.", retryable: true, recoveryAction: "retry_prompt" } : null);
            this.activeRunId = null;
          }
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
          await this.reclaimTerminalContext(gen);
          this.broadcastState();
        }
        if (ev.type === "done") {
          log("debug", "agent done", {
            reason: ev.reason,
            sessionId: this.sessionId,
          });
        }
        this.emit(ev);
        }).catch((error) => {
          log("error", "agent event handling failed", {
            message: error instanceof Error ? error.message : String(error),
            sessionId: this.sessionId,
          });
        });
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
        this.connectionGeneration += 1;
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
      /** Stable shell session identity; ACP session id remains private to this host context. */
      clientSessionId?: string;
    },
  ): Promise<RunSnapshot> {
    await this.runHydration;
    if (this.activeRunId && this.runCoordinator.get(this.activeRunId)?.state === "terminal") { this.activeRunId = null; this.pendingFallback = null; this.setBusy(false); }
    if (this.busy) {
      throw new Error("Agent is busy — wait or Cancel before sending again");
    }
    this.cfg = loadConfig();
    this.stableClientSessionId = opts?.clientSessionId ?? this.stableClientSessionId;
    const mode = this.cfg.mode === "code" ? "code" : "chat";
    const executionPhase = this.resolveExecutionPhaseForAdmit(mode);
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
    if (!this.stableClientSessionId) this.stableClientSessionId = this.sessionId;
    this.pendingPromptOrigin = opts?.originKey ?? null;
    if (!this.client || !this.sessionId) throw new Error("Agent not connected");

    const rawSelected = isEffort(effortOverride)
      ? effortOverride
      : isEffort(this.cfg.effort)
        ? this.cfg.effort
        : "auto";
    const effortPolicy = loadPolicy();
    const selected = clampEffort(rawSelected, effortPolicy.maxEffort);
    const workspacePolicy = this.workspace ? await this.workspacePolicies.snapshot(this.workspace, this.bypassActive) : { workspace: "", storedMode: null, effectiveMode: "review" as const, source: "fallback" as const, revision: "fallback", fallbackReason: "missing" as const, snapshottedAt: new Date().toISOString() };
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
    const admitted = await this.runCoordinator.admit({
      sessionId: opts?.clientSessionId || this.sessionId,
      prompt: text,
      connectionGeneration: this.connectionGeneration,
      policy: workspacePolicy,
      model: { requestedModel: this.cfg.model, appliedModel: modelsChain[0], selectionProvenance: this.cfg.modelSelectionProvenance },
      executionPhase,
    });
    this.activeRunId = admitted.runId;
    if (executionPhase === "plan") {
      await this.runCoordinator.appendOwnedEvent(admitted.runId, {
        kind: "plan_record",
        plan: exploringPlanRecord({
          runId: admitted.runId,
          sessionId: admitted.sessionId,
          connectionGeneration: admitted.connectionGeneration,
          policy: admitted.policy,
        }),
      }, "plan_record").catch(() => undefined);
    }
    this.broadcastState();
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
        runId: this.activeRunId ?? "",
        connectionGeneration: this.connectionGeneration,
        policy: workspacePolicy,
        trustedCommandClasses: this.trustedClassesSnapshot.slice(),
        executionPhase,
        sessionWrite: this.sessionWriteGrant,
        sessionShell: this.sessionShellGrant,
      });
    } catch (e) {
      this.pendingFallback = null;
      if (this.activeRunId) { await this.runCoordinator.finalize(this.activeRunId, "failed", null, { code: "provider_unavailable", message: "Prompt failed.", retryable: true, recoveryAction: "retry_prompt" }); this.activeRunId = null; }
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
    return admitted;
  }
  async shutdown(): Promise<void> { const c=this.client; this.client=null; this.sessionId=null; if(c) await c.dispose().catch(()=>undefined); }
  /** Release the ACP process once a run is terminal; journal/replay state remains owned here. */
  private async reclaimTerminalContext(gen: StdioAcpClient): Promise<void> {
    if (this.client !== gen || this.activeRunId || this.busy) return;
    this.client = null;
    this.sessionId = null;
    await gen.dispose().catch(() => undefined);
  }

  async getWorkspacePolicy(workspace: string): Promise<WorkspacePolicyView> {
    const p = await this.workspacePolicies.read(workspace);
    if (this.workspace && path.resolve(this.workspace) === path.resolve(p.workspace)) this.policyView = p;
    return p;
  }
  async getTrustedCommandClasses(workspace: string): Promise<TrustedCommandClassesView> {
    const v = await this.trustedCommandClasses.read(workspace);
    if (
      this.workspace &&
      path.resolve(this.workspace) === path.resolve(v.workspace)
    ) {
      this.trustedClassesView = v;
    }
    return v;
  }
  async saveTrustedCommandClasses(
    workspace: string,
    classes: unknown,
    expectedRevision: string,
  ): Promise<TrustedCommandClassesView> {
    if (
      this.activeRunId &&
      this.runCoordinator.get(this.activeRunId)?.state !== "terminal"
    ) {
      throw Object.assign(new Error("run active"), { code: "run_active" });
    }
    const saved = await this.trustedCommandClasses.save(
      workspace,
      classes,
      expectedRevision,
    );
    // W2: refresh authorization snapshot only when save is for this session's bound workspace
    if (
      this.workspace &&
      path.resolve(this.workspace) === path.resolve(saved.workspace)
    ) {
      this.trustedClassesView = saved;
      this.trustedClassesSnapshot = saved.classes.slice();
    }
    this.emit({ type: "state", state: this.getState() });
    return saved;
  }
  async saveWorkspacePolicy(workspace: string, mode: "review" | "trusted_workspace"): Promise<WorkspacePolicyView> {
    const p = await this.workspacePolicies.save(workspace, mode); this.policyView = p; this.emit({type:"state", state:this.getState()}); return p;
  }
  async setPermissionMode(mode: "workspace" | "bypass_permissions", activationToken?: string) {
    if (!this.stableClientSessionId) throw Object.assign(new Error("session not found"), { code: "session_not_found" });
    // Validate all rejection boundaries before mutating session state. In
    // particular, a managed deployment must reject Bypass even when a valid
    // capability token is supplied, and an active run must remain untouched.
    if (mode === "bypass_permissions" && (process.env.GROKFORGE_MANAGED_BYPASS_DISABLED === "1" || process.env.GROKFORGE_BYPASS_DISABLED === "1")) {
      throw Object.assign(new Error("Bypass is disabled by managed policy"), { code: "bypass_managed_disabled" });
    }
    if (this.activeRunId && this.runCoordinator.get(this.activeRunId)?.state !== "terminal") {
      throw Object.assign(new Error("run active"), { code: "run_active" });
    }
    if (mode === "bypass_permissions") {
      const desktopPid = Number(process.env.GROKFORGE_DESKTOP_PID ?? 0) || undefined;
      if (!activationToken || !AgentSession.activation.verify(activationToken, this.stableClientSessionId, desktopPid, process.pid)) throw Object.assign(new Error("Invalid activation token"), {code:"bypass_activation_invalid"});
      this.bypassActive = true;
    }
    if (mode !== "bypass_permissions") this.bypassActive = false;
    const p = this.policyView ?? (this.workspace ? await this.getWorkspacePolicy(this.workspace) : null);
    return {sessionId:this.stableClientSessionId,effectivePermissionMode:this.bypassActive?"bypass_permissions":(p?.effectiveMode??"review"),bypassPermissions:this.bypassView()};
  }

  private setBusy(next: boolean): void {
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

  getRun(runId: string, clientSessionId?: string): RunSnapshot | undefined {
    const run = this.runCoordinator.get(runId);
    return run && (!clientSessionId || run.sessionId === clientSessionId) ? run : undefined;
  }

  async findActivityForEdit(runId: string, sessionId: string, editId: string, invocationId?: string): Promise<ActivityRecord | null> {
    const result = await this.replayRun(runId, sessionId, 0);
    let byEdit: ActivityRecord | null = null;
    let byInv: ActivityRecord | null = null;
    for (const event of result.events) {
      if (event.type !== "activity_update" || event.payload.kind !== "activity_update") continue;
      const activity = event.payload.activity;
      if (editId && activity.editId === editId) byEdit = activity;
      else if (invocationId && activity.invocationId === invocationId) byInv = activity;
    }
    return byEdit ?? byInv;
  }

  async appendActivity(runId: string, activity: ActivityRecord): Promise<void> {
    try {
      await this.runCoordinator.appendOwnedEvent(runId, { kind: "activity_update", activity }, "activity_update");
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : String(error);
      if (code !== "run_terminal" && !/not active|run terminal/.test(message)) throw error;
      await this.runCoordinator.appendSettlementActivity(runId, activity);
    }
  }
  getActiveRunId(): string | null { return this.activeRunId; }
  async replayRun(runId: string, clientSessionId: string, after = 0) {
    await this.runHydration;
    return this.runCoordinator.replay(clientSessionId, runId, after);
  }
  async cancelRun(runId: string, clientSessionId: string): Promise<RunSnapshot> {
    const run = this.getRun(runId, clientSessionId);
    if (!run) throw Object.assign(new Error("Run not found"), { code: "run_not_found" });
    if (run.state === "terminal") throw Object.assign(new Error("Run is terminal"), { code: "run_terminal" });
    await this.runCoordinator.cancel(runId);
    if (this.client) await this.client.cancel({ sessionId: this.sessionId || clientSessionId, runId, connectionGeneration: run.connectionGeneration });
    return this.runCoordinator.get(runId)!;
  }

  async permission(id: string, decision: PermissionDecision, ownership?: {sessionId:string;runId:string;connectionGeneration:number}, invocationId?: string): Promise<"accepted"|"declined"> {
    if (!this.client) throw new Error("Agent not connected");
    if (ownership && !this.getRun(ownership.runId, ownership.sessionId)) throw Object.assign(new Error("decision not found"), {code:"decision_not_found"});
    const run = ownership ? this.runCoordinator.get(ownership.runId) : undefined;
    if (run?.state === "terminal") throw Object.assign(new Error("Run is terminal"), { code: "run_terminal" });
    const pending=this.pendingDecisions.get(id); const expired = this.isDecisionExpired(pending); if(ownership&&(!pending||pending.sessionId!==ownership.sessionId||pending.runId!==ownership.runId||pending.generation!==ownership.connectionGeneration||pending.kind!=="permission"||pending.status!=="pending"||expired||pending.invocationId!==invocationId)) throw Object.assign(new Error(expired?"decision expired":"decision not found"),{code:expired?"request_expired":"decision_not_found"});
    await this.client.respondPermission(id, decision, ownership);
    log("debug","permission acknowledged",{id,decision,runId:ownership?.runId,sessionId:ownership?.sessionId});
    if (decision === "allow_session") {
      if (pending?.permissionKind === "write") this.sessionWriteGrant = true;
      if (pending?.permissionKind === "shell") this.sessionShellGrant = true;
    }
    if(pending) pending.status=decision==="deny"?"declined":"accepted";
    if (pending) this.pendingDecisions.delete(id);
    if (ownership && run) { await this.runCoordinator.appendOwnedEvent(ownership.runId,{kind:"decision_request",request:{requestId:id,invocationId:pending?.invocationId??id,kind:"permission",status:decision==="deny"?"declined":"accepted",title:"Permission",detail:"",expiresAt:null,policy:run.policy}},"decision_request").catch(()=>undefined); }
    return decision === "deny" ? "declined" : "accepted";
  }

  async diffAction(id: string, action: "accept" | "reject", ownership?: {sessionId:string;runId:string;connectionGeneration:number}, invocationId?: string): Promise<"accepted"|"declined"> {
    if (!this.client) throw new Error("Agent not connected");
    if (ownership && !this.getRun(ownership.runId, ownership.sessionId)) throw Object.assign(new Error("decision not found"), {code:"decision_not_found"});
    const run = ownership ? this.runCoordinator.get(ownership.runId) : undefined;
    if (run?.state === "terminal") throw Object.assign(new Error("Run is terminal"), { code: "run_terminal" });
    const pending=this.pendingDecisions.get(id); const expired = this.isDecisionExpired(pending); if(ownership&&(!pending||pending.sessionId!==ownership.sessionId||pending.runId!==ownership.runId||pending.generation!==ownership.connectionGeneration||pending.kind!=="diff"||pending.status!=="pending"||expired||pending.invocationId!==invocationId)) throw Object.assign(new Error(expired?"decision expired":"decision not found"),{code:expired?"request_expired":"decision_not_found"});
    await this.client.respondEdit(id, action, this.sessionId ?? undefined, ownership);
    if(pending) pending.status=action==="accept"?"accepted":"declined";
    if (pending) this.pendingDecisions.delete(id);
    if (ownership && run) { await this.runCoordinator.appendOwnedEvent(ownership.runId,{kind:"decision_request",request:{requestId:id,invocationId:pending?.invocationId??id,kind:"diff",status:action==="accept"?"accepted":"declined",title:"Edit",detail:"",expiresAt:null,policy:run.policy}},"decision_request").catch(()=>undefined); }
    return action === "accept" ? "accepted" : "declined";
  }

  async planAction(
    requestId: string,
    action: "accept" | "keep_planning",
    ownership: { sessionId: string; runId: string; connectionGeneration: number },
    invocationId: string,
  ): Promise<"accepted" | "kept_planning"> {
    const pending = this.pendingDecisions.get(requestId);
    if (action !== "accept" && action !== "keep_planning") {
      throw Object.assign(new Error("invalid plan action"), { code: "invalid_request" });
    }
    if (
      !pending ||
      pending.kind !== "plan" ||
      pending.status !== "pending" ||
      pending.sessionId !== ownership.sessionId ||
      pending.runId !== ownership.runId ||
      pending.generation !== ownership.connectionGeneration ||
      pending.invocationId !== invocationId
    ) {
      throw Object.assign(new Error("decision not found"), { code: "decision_not_found" });
    }
    let run = this.getRun(ownership.runId, ownership.sessionId);
    if (!run) {
      try { run = (await this.replayRun(ownership.runId, ownership.sessionId)).run; }
      catch { throw Object.assign(new Error("decision not found"), { code: "decision_not_found" }); }
    }
    const status = action === "accept" ? "accepted" : "kept_planning";
    pending.status = status;
    if (action === "accept") this.planEngaged = false;
    const plan = await this.latestPlanRecord(ownership.runId, ownership.sessionId);
    const nextPlan: PlanRecord = {
      runId: run.runId,
      sessionId: run.sessionId,
      connectionGeneration: run.connectionGeneration,
      status,
      body: plan?.body ?? null,
      proposedMembers: plan?.proposedMembers ?? [],
      policy: run.policy,
      executionPhase: "plan",
    };
    await this.appendPlanSettlement(run.runId, nextPlan, {
      requestId,
      invocationId: pending.invocationId,
      kind: "plan",
      status,
      title: planDecisionTitle(nextPlan.proposedMembers),
      detail: "",
      expiresAt: null,
      policy: run.policy,
    });
    this.broadcastState();
    return status;
  }

  private async latestPlanRecord(runId: string, sessionId: string): Promise<PlanRecord | null> {
    try {
      const replayed = await this.replayRun(runId, sessionId, 0);
      let latest: PlanRecord | null = null;
      for (const event of replayed.events) {
        if (event.payload.kind === "plan_record") latest = event.payload.plan;
      }
      return latest;
    } catch {
      return null;
    }
  }

  private async appendPlanSettlement(
    runId: string,
    plan: PlanRecord,
    request: { requestId: string; invocationId: string; kind: "plan"; status: "accepted" | "kept_planning" | "cancelled"; title: string; detail: string; expiresAt: null; policy: PolicySnapshot },
  ): Promise<void> {
    const live = this.runCoordinator.get(runId);
    if (live && live.state !== "terminal") {
      await this.runCoordinator.appendOwnedEvent(runId, { kind: "plan_record", plan }, "plan_record").catch(() => undefined);
      await this.runCoordinator.appendOwnedEvent(runId, { kind: "decision_request", request }, "decision_request").catch(() => undefined);
      return;
    }
    await this.runCoordinator.appendAfterTerminalEvent(runId, { kind: "plan_record", plan }, "plan_record").catch(() => undefined);
    await this.runCoordinator.appendAfterTerminalEvent(runId, { kind: "decision_request", request }, "decision_request").catch(() => undefined);
  }

  private async settlePlanPhase(run: RunSnapshot, terminalKind: TerminalKind, body: string | null): Promise<void> {
    const record = terminalPlanRecord({
      runId: run.runId,
      sessionId: run.sessionId,
      connectionGeneration: run.connectionGeneration,
      policy: run.policy,
      terminalKind,
      body: body && body.trim() ? body : null,
    });
    if (record.status === "ready" && this.lastReadyPlanRunId && this.lastReadyPlanRunId !== run.runId) {
      const prior = await this.latestPlanRecord(this.lastReadyPlanRunId, run.sessionId);
      if (prior && (prior.status === "kept_planning" || prior.status === "ready")) {
        await this.runCoordinator.appendAfterTerminalEvent(this.lastReadyPlanRunId, {
          kind: "plan_record",
          plan: { ...prior, status: "superseded" },
        }, "plan_record").catch(() => undefined);
      }
    }
    await this.runCoordinator.appendOwnedEvent(run.runId, { kind: "plan_record", plan: record }, "plan_record").catch(() => undefined);
    if (record.status !== "ready") return;
    this.lastReadyPlanRunId = run.runId;
    const requestId = randomUUID();
    this.pendingDecisions.set(requestId, {
      sessionId: run.sessionId,
      runId: run.runId,
      generation: run.connectionGeneration,
      invocationId: requestId,
      kind: "plan",
      status: "pending",
      expiresAt: 0,
    });
    await this.runCoordinator.appendOwnedEvent(run.runId, {
      kind: "decision_request",
      request: {
        requestId,
        invocationId: requestId,
        kind: "plan",
        status: "pending",
        title: planDecisionTitle(record.proposedMembers),
        detail: record.body ?? "",
        expiresAt: null,
        policy: run.policy,
      },
    }, "decision_request").catch(() => undefined);
  }

  private async cancelPendingToolDecisions(runId: string): Promise<void> {
    const run = this.runCoordinator.get(runId);
    for (const [id, pending] of [...this.pendingDecisions]) {
      if (pending.runId !== runId) continue;
      if (pending.kind === "plan") continue;
      if (pending.status !== "pending") {
        this.pendingDecisions.delete(id);
        continue;
      }
      pending.status = "cancelled";
      if (run) {
        await this.runCoordinator.appendOwnedEvent(runId, {
          kind: "decision_request",
          request: {
            requestId: id,
            invocationId: pending.invocationId,
            kind: pending.kind,
            status: "cancelled",
            title: pending.kind === "diff" ? "Edit file" : "Permission",
            detail: "",
            expiresAt: null,
            policy: run.policy,
          },
        }, "decision_request").catch(() => undefined);
      }
      this.pendingDecisions.delete(id);
    }
  }

  private cancelPendingPlanDecision(): void {
    for (const [id, pending] of this.pendingDecisions) {
      if (pending.kind !== "plan" || pending.status !== "pending") continue;
      pending.status = "cancelled";
      void this.latestPlanRecord(pending.runId, pending.sessionId).then(async (plan) => {
        const run = this.getRun(pending.runId, pending.sessionId);
        const policy = run?.policy ?? plan?.policy;
        if (!policy) return;
        await this.appendPlanSettlement(pending.runId, {
          runId: pending.runId,
          sessionId: pending.sessionId,
          connectionGeneration: pending.generation,
          status: "cancelled",
          body: plan?.body ?? null,
          proposedMembers: plan?.proposedMembers ?? [],
          policy,
          executionPhase: "plan",
        }, {
          requestId: id,
          invocationId: pending.invocationId,
          kind: "plan",
          status: "cancelled",
          title: "Planning cancelled",
          detail: "",
          expiresAt: null,
          policy,
        });
      }).catch(() => undefined);
    }
  }

  private async restorePlanDecisions(): Promise<void> {
    const snapshots = await this.runCoordinator.listSnapshots();
    const owned = this.stableClientSessionId
      ? snapshots.filter((snap) => snap.sessionId === this.stableClientSessionId)
      : snapshots;
    for (const snap of owned) {
      let replayed;
      try { replayed = await this.runCoordinator.replay(snap.sessionId, snap.runId, 0); }
      catch { continue; }
      let latestPlan: PlanRecord | null = null;
      let latestDecision: { requestId: string; invocationId: string; status: string } | null = null;
      for (const event of replayed.events) {
        if (event.payload.kind === "plan_record") latestPlan = event.payload.plan;
        if (event.payload.kind === "decision_request" && event.payload.request.kind === "plan") {
          latestDecision = event.payload.request;
        }
      }
      if (latestPlan?.status === "kept_planning" || latestPlan?.status === "ready") {
        this.lastReadyPlanRunId = snap.runId;
      }
      if (latestDecision?.status === "pending") {
        this.pendingDecisions.set(latestDecision.requestId, {
          sessionId: snap.sessionId,
          runId: snap.runId,
          generation: snap.connectionGeneration,
          invocationId: latestDecision.invocationId,
          kind: "plan",
          status: "pending",
          expiresAt: 0,
        });
      }
    }
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
