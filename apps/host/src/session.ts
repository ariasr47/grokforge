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
import { stampCodeAgentFact, vendorSpawnEnv, type CodeAgentFact, type CodeRunAgentProvenance } from "./codeAgent.js";
import {
  ABSENT_NON_VENDOR,
  applyValidCommands,
  clearToAbsent,
  enterAwaiting,
  ignoreMalformed,
  markObtainFailed,
  markTransportDisconnect,
  type SkillsCatalogFact,
} from "./skillsCatalog.js";
import {
  ABSENT_NON_CODE_OR_NON_VENDOR,
  applyChildUpdate,
  clearToAbsent as clearChildAgentsToAbsent,
  enterHydrating,
  foldMembersFromUpdates,
  markObtainFailed as markChildAgentsObtainFailed,
  markReady,
  parseCompleteChildAgentFrame,
  type ChildAgentsMembershipFact,
} from "./childAgents.js";
import {
  ABSENT_FOR_NON_CODE_OR_NON_VENDOR,
  applyFetchMember,
  clearToAbsent as clearBrowserWorkToAbsent,
  enterHydrating as enterBrowserHydrating,
  foldMembersFromActivities,
  markObtainFailed as markBrowserObtainFailed,
  markReady as markBrowserReady,
  memberFromFetchActivity,
  type BrowserWorkMembershipFact,
  type FetchActivityInput,
} from "./browserWork.js";
import {
  ABSENT_FOR_NON_CODE_OR_NON_VENDOR as ABSENT_MCP_SERVERS,
  applyMcpMember,
  clearToAbsent as clearMcpServersToAbsent,
  enterHydrating as enterMcpHydrating,
  foldMembersFromUpdates as foldMcpMembersFromUpdates,
  markObtainFailed as markMcpObtainFailed,
  markReady as markMcpReady,
  memberFromUpdate,
  parseCompleteMcpFrame,
  type McpServersMembershipFact,
  type McpUpdateInput,
} from "./mcpServers.js";
import {
  ABSENT_FOR_NON_CODE_OR_NON_VENDOR as ABSENT_HOOKS,
  applyHookMember,
  clearToAbsent as clearHooksToAbsent,
  enterHydrating as enterHooksHydrating,
  foldMembersFromUpdates as foldHooksMembersFromUpdates,
  markObtainFailed as markHooksObtainFailed,
  markReady as markHooksReady,
  memberFromUpdate as memberFromHookUpdate,
  parseCompleteHookFrame,
  type HooksMembershipFact,
  type HookUpdateInput,
} from "./hooks.js";
import { decideSkillHandoff } from "./skillHandoff.js";
import { audit } from "./audit.js";
import { clampEffort, loadPolicy } from "./policy.js";
import { recordCompletedConversation } from "./shell-history.js";
import { resolveHostExecutionEnvironment, type ShellCapabilityView } from "./executionEnvironment.js";
import { RunJournal } from "./run-journal.js";
import { RunCoordinator } from "./run-coordinator.js";
import { randomUUID } from "node:crypto";
import type { ActivityRecord, ChatPackTurnVoucher, DecisionKind, FailureView, MutationKind, PlanRecord, PolicySnapshot, RunEventEnvelope, RunSnapshot, RunState, TerminalKind } from "./run-types.js";
import { exploringPlanRecord, planBodyFromVendorExit, planDecisionTitle, terminalPlanRecord } from "./plan-record.js";
import { dataDir } from "./channel.js";
import { WorkspacePolicyStore, type WorkspacePolicyView } from "./workspace-policy.js";
import {
  TrustedCommandClassStore,
  type TrustedCommandClassId,
  type TrustedCommandClassesView,
} from "./trusted-command-classes.js";
import { BypassActivation } from "./bypass-activation.js";
import { resolveProjectInstructions } from "./project-instructions.js";
import {
  CHAT_PACK_FILE_CAP,
  CHAT_PACK_FILE_CONTENTS_CAP,
  buildChatPackPromptSection,
  codeChatPackView,
  emptyChatPackView,
  membersAreEmpty,
  noteLengthOk,
  posixRelative,
  sumFileContentsLength,
  validatePinnedTextFile,
  type ChatPackView,
} from "./chat-pack.js";

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

function mutationKindOf(value: unknown): MutationKind | null {
  return value === "content" || value === "delete" || value === "rename" ? value : null;
}

function nullablePath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function activityRecordFromToolRun(
  ev: Extract<AcpUiEvent, { type: "tool_run" }> & { path?: string | null },
  policy: PolicySnapshot,
): ActivityRecord {
  const path =
    typeof (ev as { path?: unknown }).path === "string" && (ev as { path: string }).path.length > 0
      ? (ev as { path: string }).path
      : null;
  const kind = mutationKindOf((ev as { kind?: unknown }).kind);
  const titleRaw = (ev as { title?: unknown }).title;
  const acpToolKindRaw = (ev as { acpToolKind?: unknown }).acpToolKind;
  const urlRaw = (ev as { url?: unknown }).url;
  const snapRaw = (ev as { snapshotJournaled?: unknown }).snapshotJournaled;
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
    kind,
    fromPath: kind === "rename" ? nullablePath((ev as { fromPath?: unknown }).fromPath) : null,
    toPath: kind === "rename" ? nullablePath((ev as { toPath?: unknown }).toPath) : null,
    policy,
    automaticEligibility: ev.automaticEligibility ?? "not_eligible",
    autoApplied: ev.autoApplied === true,
    command: typeof ev.command === "string" ? ev.command : null,
    editId: ev.editId ?? null,
    recovery: ev.recovery ?? null,
    summary: typeof ev.summary === "string" ? ev.summary : ev.summary === null ? null : null,
    title: typeof titleRaw === "string" ? titleRaw : null,
    acpToolKind: typeof acpToolKindRaw === "string" ? acpToolKindRaw : null,
    url: typeof urlRaw === "string" ? urlRaw : null,
    snapshotJournaled: snapRaw === true,
  };
}

export function activityRecordFromProposedEdit(input: {
  editId: string;
  invocationId: string;
  path: string;
  diff: string | null;
  policy: PolicySnapshot;
  kind?: MutationKind | null;
  fromPath?: string | null;
  toPath?: string | null;
  name?: string;
}): ActivityRecord {
  const kind = input.kind ?? (typeof input.diff === "string" && input.diff.length > 0 ? "content" : null);
  return {
    activityId: input.invocationId,
    invocationId: input.invocationId,
    name: input.name ?? (kind === "delete" ? "delete_file" : kind === "rename" ? "rename_file" : "write_file"),
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: input.path },
    output: null,
    error: null,
    diff: input.diff,
    path: input.path,
    kind,
    fromPath: kind === "rename" ? nullablePath(input.fromPath) : null,
    toPath: kind === "rename" ? nullablePath(input.toPath) : null,
    policy: input.policy,
    automaticEligibility: "not_eligible",
    autoApplied: false,
    command: null,
    editId: input.editId,
    recovery: null,
    summary: null,
    title: null,
    acpToolKind: null,
    url: null,
    snapshotJournaled: false,
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
    path: input.action === "accept" && prior?.kind === "rename" ? prior.toPath : prior?.path ?? null,
    kind: prior?.kind ?? null,
    fromPath: prior?.fromPath ?? null,
    toPath: prior?.toPath ?? null,
    policy: input.policy,
    automaticEligibility: prior?.automaticEligibility ?? "not_eligible",
    autoApplied: false,
    command: null,
    editId: input.editId,
    recovery:
      input.action === "accept"
        ? { kind: "guarded_revert", available: true, status: "available" }
        : null,
    summary: prior?.summary ?? null,
    title: prior?.title ?? null,
    acpToolKind: prior?.acpToolKind ?? null,
    url: prior?.url ?? null,
    snapshotJournaled: prior?.snapshotJournaled === true,
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
    path: input.status === "reverted" && prior?.kind === "rename" ? prior.fromPath : prior?.path ?? null,
    kind: prior?.kind ?? null,
    fromPath: prior?.fromPath ?? null,
    toPath: prior?.toPath ?? null,
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
    summary: prior?.summary ?? null,
    title: prior?.title ?? null,
    acpToolKind: prior?.acpToolKind ?? null,
    url: prior?.url ?? null,
    snapshotJournaled: prior?.snapshotJournaled === true,
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
  chatPack: ChatPackView;
  codeAgent: CodeAgentFact | null;
  skillsCatalog: SkillsCatalogFact;
  childAgents: ChildAgentsMembershipFact;
  browserWork: BrowserWorkMembershipFact;
  mcpServers: McpServersMembershipFact;
  hooks: HooksMembershipFact;
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
  private pendingDecisions = new Map<string,{sessionId:string;runId:string;generation:number;invocationId:string;kind:DecisionKind;permissionKind?:"write"|"shell";status:"pending"|"accepted"|"declined"|"expired"|"kept_planning"|"cancelled";expiresAt:number;replyDialect?:"acp_result"|"grok_permission_respond"}>();
  /** In-memory queued vendor turn-end while an ask was already open at RPC return. */
  private queuedTurnEnd = new Map<string, { terminalKind: TerminalKind; failure: FailureView }>();
  private planEngaged = false;
  private planEngagementVouched = true;
  private lastReadyPlanRunId: string | null = null;
  private projectInstructionsCache: ProjectInstructionsPresenceView = { status: "absent", path: null, vouched: true };
  private projectInstructionsProbeRoot: string | null = null;
  private projectInstructionsVouched = true;
  private chatPackState: ChatPackView = emptyChatPackView(null);
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
  private codeAgent: CodeAgentFact | null = null;
  /** True only after both initialize and session/new succeeded for the current child. */
  private spawnLive = false;
  private skillsCatalog: SkillsCatalogFact = ABSENT_NON_VENDOR;
  private skillsObtainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly skillsCatalogObtainTimeoutMs: number;
  private skillsWarm: Promise<void> | null = null;
  private childAgents: ChildAgentsMembershipFact = ABSENT_NON_CODE_OR_NON_VENDOR;
  private browserWork: BrowserWorkMembershipFact = ABSENT_FOR_NON_CODE_OR_NON_VENDOR;
  private mcpServers: McpServersMembershipFact = ABSENT_MCP_SERVERS;
  private hooks: HooksMembershipFact = ABSENT_HOOKS;
  private lastOwnedRunId: string | null = null;

  constructor(stableSessionId?: string, opts?: { skillsCatalogObtainTimeoutMs?: number }) {
    this.stableClientSessionId = stableSessionId ?? null;
    this.runHydration = this.runCoordinator.hydrate(stableSessionId).then(() => this.restorePlanDecisions()).catch((error) => { throw Object.assign(new Error("Run journal unavailable"), { code: "journal_unavailable", cause: error }); });
    this.cfg = loadConfig();
    const timeoutRaw = Number(process.env.GROKFORGE_SKILLS_OBTAIN_TIMEOUT_MS);
    this.skillsCatalogObtainTimeoutMs =
      opts?.skillsCatalogObtainTimeoutMs ??
      (Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 15_000);
    if (!this.cfg.mode) this.cfg.mode = "chat";
    if (!this.cfg.effort) this.cfg.effort = "auto";
    if (this.cfg.mode === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
    } else if (this.cfg.lastWorkspace && fs.existsSync(this.cfg.lastWorkspace)) {
      this.workspace = this.cfg.lastWorkspace;
    }
    if (process.env.GROKFORGE_PLAN_UNVOUCHED === "1") this.planEngagementVouched = false;
    if (process.env.GROKFORGE_PROJECT_INSTRUCTIONS_UNVOUCHED === "1") this.projectInstructionsVouched = false;
    this.ready = this.hydrateWorkspacePolicy(this.workspace).then(() => this.refreshProjectInstructionsPresence()).then(() => {
      if (this.cfg.mode === "code" && this.workspace) this.eagerResolveCodeAgent();
    }).then(() => this.restoreChildAgentsFromJournal()).then(() => this.restoreBrowserWorkFromJournal()).then(() => this.restoreMcpServersFromJournal()).then(() => this.restoreHooksFromJournal());
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
      connected: Boolean(this.client && this.sessionId),
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
      chatPack: this.chatPackView(),
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      codeAgent: this.cfg.mode === "code" ? (this.codeAgent ?? null) : null,
      skillsCatalog: this.skillsCatalog,
      childAgents: this.childAgents,
      browserWork: this.browserWork,
      mcpServers: this.mcpServers,
      hooks: this.hooks,
    };
  }

  getSkillsCatalog(): SkillsCatalogFact {
    return this.skillsCatalog;
  }

  private vendorChildAgentsEligible(): boolean {
    return this.cfg.mode === "code" && this.codeAgent?.identity === "vendor";
  }

  private replaceChildAgents(next: ChildAgentsMembershipFact): void {
    const same =
      next.disposition === this.childAgents.disposition &&
      next.members === this.childAgents.members;
    this.childAgents = next;
    if (!same) this.broadcastState();
  }

  private syncChildAgentsEligibility(): void {
    if (!this.vendorChildAgentsEligible()) {
      this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
    }
  }

  private childUpdatesFromEvents(events: RunEventEnvelope[]): Array<{
    childId: string;
    identityLabel: string;
    status: "running" | "done" | "failed";
    eventSeq: number;
  }> {
    const out: Array<{
      childId: string;
      identityLabel: string;
      status: "running" | "done" | "failed";
      eventSeq: number;
    }> = [];
    for (const e of events) {
      if (e.type !== "child_agent_update" || e.payload.kind !== "child_agent_update") continue;
      const parsed = parseCompleteChildAgentFrame({
        childId: e.payload.childId,
        identityLabel: e.payload.identityLabel,
        status: e.payload.status,
      });
      if (!parsed) {
        log("warn", "malformed child_agent_update ignored", { sessionId: this.sessionId });
        continue;
      }
      out.push({ ...parsed, eventSeq: e.eventSeq });
    }
    return out;
  }

  private markChildAgentsReadyFromEvents(events: RunEventEnvelope[]): void {
    if (!this.vendorChildAgentsEligible()) {
      this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
      return;
    }
    this.replaceChildAgents(markReady(this.childAgents, foldMembersFromUpdates(this.childUpdatesFromEvents(events))));
  }

  private isJournalObtainFailure(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);
    return code === "journal_unavailable" || /journal_corrupt/.test(message);
  }

  private async restoreChildAgentsFromJournal(runId?: string | null, sessionId?: string | null): Promise<void> {
    if (!this.vendorChildAgentsEligible()) {
      this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
      return;
    }
    this.replaceChildAgents(enterHydrating(this.childAgents));
    try {
      await this.runHydration;
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceChildAgents(markChildAgentsObtainFailed(this.childAgents));
        return;
      }
      throw error;
    }
    try {
      let sid = sessionId ?? this.stableClientSessionId;
      let rid = runId ?? this.activeRunId ?? this.lastOwnedRunId;
      if (!rid || !sid) {
        const snapshots = await this.runCoordinator.listSnapshots();
        const owned = this.stableClientSessionId
          ? snapshots.filter((s) => s.sessionId === this.stableClientSessionId)
          : snapshots;
        const latest = owned.slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
        if (!latest) {
          this.replaceChildAgents(markReady(this.childAgents, []));
          return;
        }
        sid = latest.sessionId;
        rid = latest.runId;
      }
      const { events } = await this.runCoordinator.replay(sid, rid, 0);
      this.markChildAgentsReadyFromEvents(events);
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceChildAgents(markChildAgentsObtainFailed(this.childAgents));
        return;
      }
      throw error;
    }
  }

  private async applyLiveChildAgentEvent(ev: Extract<AcpUiEvent, { type: "child_agent" }>): Promise<void> {
    if (this.codeAgent?.identity !== "vendor") return;
    const runId = this.activeRunId ?? this.lastOwnedRunId;
    if (!runId) return;
    const run = this.runCoordinator.get(runId);
    if (!run) return;
    if (run.connectionGeneration !== this.connectionGeneration) return;
    const payload = {
      kind: "child_agent_update" as const,
      childId: ev.childId,
      identityLabel: ev.identityLabel,
      status: ev.status,
    };
    let envelope: RunEventEnvelope | undefined;
    try {
      if (run.state === "terminal") {
        if (ev.status !== "done" && ev.status !== "failed") return;
        envelope = await this.runCoordinator.appendAfterTerminalEvent(runId, payload, "child_agent_update");
      } else {
        envelope = await this.runCoordinator.appendOwnedEvent(
          runId,
          payload,
          "child_agent_update",
          this.connectionGeneration,
        );
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "stale_generation") return;
      log("warn", "child_agent_update journal apply failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      });
      return;
    }
    if (!envelope) return;
    const prior =
      this.childAgents.disposition === "ready" || this.childAgents.disposition === "hydrating"
        ? (this.childAgents.members ?? [])
        : [];
    const members = applyChildUpdate(prior, {
      childId: ev.childId,
      identityLabel: ev.identityLabel,
      status: ev.status,
      eventSeq: envelope.eventSeq,
    });
    this.replaceChildAgents(markReady(this.childAgents, members));
  }

  private vendorBrowserWorkEligible(): boolean {
    return this.cfg.mode === "code" && this.codeAgent?.identity === "vendor";
  }

  private replaceBrowserWork(next: BrowserWorkMembershipFact): void {
    const same =
      next.disposition === this.browserWork.disposition &&
      next.members === this.browserWork.members;
    this.browserWork = next;
    if (!same) this.broadcastState();
  }

  private syncBrowserWorkEligibility(): void {
    if (!this.vendorBrowserWorkEligible()) {
      this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
    }
  }

  private browserUpdatesFromEvents(events: RunEventEnvelope[]): FetchActivityInput[] {
    const out: FetchActivityInput[] = [];
    for (const e of events) {
      if (e.type !== "activity_update" || e.payload.kind !== "activity_update") continue;
      const a = e.payload.activity;
      out.push({
        toolCallId: a.invocationId || a.activityId,
        acpToolKind: a.acpToolKind ?? null,
        status: a.status,
        execution: a.execution,
        title: a.title ?? null,
        url: a.url ?? null,
        snapshotJournaled: a.snapshotJournaled === true,
        eventSeq: e.eventSeq,
      });
    }
    return out;
  }

  private markBrowserWorkReadyFromEvents(events: RunEventEnvelope[]): void {
    if (!this.vendorBrowserWorkEligible()) {
      this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
      return;
    }
    this.replaceBrowserWork(
      markBrowserReady(this.browserWork, foldMembersFromActivities(this.browserUpdatesFromEvents(events))),
    );
  }

  private async restoreBrowserWorkFromJournal(runId?: string | null, sessionId?: string | null): Promise<void> {
    if (!this.vendorBrowserWorkEligible()) {
      this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
      return;
    }
    this.replaceBrowserWork(enterBrowserHydrating(this.browserWork));
    try {
      await this.runHydration;
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceBrowserWork(markBrowserObtainFailed(this.browserWork));
        return;
      }
      throw error;
    }
    try {
      let sid = sessionId ?? this.stableClientSessionId;
      let rid = runId ?? this.activeRunId ?? this.lastOwnedRunId;
      if (!rid || !sid) {
        const snapshots = await this.runCoordinator.listSnapshots();
        const owned = this.stableClientSessionId
          ? snapshots.filter((s) => s.sessionId === this.stableClientSessionId)
          : snapshots;
        const latest = owned.slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
        if (!latest) {
          this.replaceBrowserWork(markBrowserReady(this.browserWork, []));
          return;
        }
        sid = latest.sessionId;
        rid = latest.runId;
      }
      const { events } = await this.runCoordinator.replay(sid, rid, 0);
      this.markBrowserWorkReadyFromEvents(events);
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceBrowserWork(markBrowserObtainFailed(this.browserWork));
        return;
      }
      throw error;
    }
  }

  private applyLiveBrowserWork(activity: ActivityRecord, eventSeq: number): void {
    if (!this.vendorBrowserWorkEligible()) {
      this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
      return;
    }
    const input: FetchActivityInput = {
      toolCallId: activity.invocationId || activity.activityId,
      acpToolKind: activity.acpToolKind ?? null,
      status: activity.status,
      execution: activity.execution,
      title: activity.title ?? null,
      url: activity.url ?? null,
      snapshotJournaled: activity.snapshotJournaled === true,
      eventSeq,
    };
    const priorMembers =
      this.browserWork.disposition === "ready" || this.browserWork.disposition === "hydrating"
        ? (this.browserWork.members ?? [])
        : [];
    if (input.toolCallId && input.acpToolKind === "fetch" && (input.execution === "not_executed" || input.status === "rejected")) {
      this.replaceBrowserWork(
        markBrowserReady(this.browserWork, priorMembers.filter((m) => m.toolCallId !== input.toolCallId)),
      );
      return;
    }
    const member = memberFromFetchActivity(input);
    if (!member) return;
    this.replaceBrowserWork(markBrowserReady(this.browserWork, applyFetchMember(priorMembers, member)));
  }

  private vendorMcpEligible(): boolean {
    return this.cfg.mode === "code" && this.codeAgent?.identity === "vendor";
  }

  private replaceMcpServers(next: McpServersMembershipFact): void {
    const same =
      next.disposition === this.mcpServers.disposition &&
      next.members === this.mcpServers.members;
    this.mcpServers = next;
    if (!same) this.broadcastState();
  }

  private syncMcpServersEligibility(): void {
    if (!this.vendorMcpEligible()) {
      this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
    }
  }

  private mcpUpdatesFromEvents(events: RunEventEnvelope[]): McpUpdateInput[] {
    const out: McpUpdateInput[] = [];
    for (const e of events) {
      if (e.type !== "mcp_server_update" || e.payload.kind !== "mcp_server_update") continue;
      const parsed = parseCompleteMcpFrame({
        serverId: e.payload.serverId,
        name: e.payload.name,
        status: e.payload.status,
      });
      if (!parsed) {
        if (typeof e.payload.serverId === "string" && e.payload.serverId) {
          out.push({
            serverId: e.payload.serverId,
            name: null,
            status: null,
            eventSeq: e.eventSeq,
            unrestorable: true,
          });
        } else {
          log("warn", "malformed mcp_server_update ignored", { sessionId: this.sessionId });
        }
        continue;
      }
      out.push({ ...parsed, eventSeq: e.eventSeq });
    }
    return out;
  }

  private markMcpServersReadyFromEvents(events: RunEventEnvelope[]): void {
    if (!this.vendorMcpEligible()) {
      this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
      return;
    }
    const members = foldMcpMembersFromUpdates(this.mcpUpdatesFromEvents(events));
    this.replaceMcpServers(markMcpReady(this.mcpServers, members));
  }

  private async restoreMcpServersFromJournal(runId?: string | null, sessionId?: string | null): Promise<void> {
    if (!this.vendorMcpEligible()) {
      this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
      return;
    }
    this.replaceMcpServers(enterMcpHydrating(this.mcpServers));
    try {
      await this.runHydration;
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceMcpServers(markMcpObtainFailed(this.mcpServers));
        return;
      }
      throw error;
    }
    try {
      let sid = sessionId ?? this.stableClientSessionId;
      let rid = runId ?? this.activeRunId ?? this.lastOwnedRunId;
      if (!rid || !sid) {
        const snapshots = await this.runCoordinator.listSnapshots();
        const owned = this.stableClientSessionId
          ? snapshots.filter((s) => s.sessionId === this.stableClientSessionId)
          : snapshots;
        const latest = owned.slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
        if (!latest) {
          this.replaceMcpServers(markMcpReady(this.mcpServers, []));
          return;
        }
        sid = latest.sessionId;
        rid = latest.runId;
      }
      const { events } = await this.runCoordinator.replay(sid, rid, 0);
      this.markMcpServersReadyFromEvents(events);
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceMcpServers(markMcpObtainFailed(this.mcpServers));
        return;
      }
      throw error;
    }
  }

  private async applyLiveMcpServerEvent(ev: Extract<AcpUiEvent, { type: "mcp_server" }>): Promise<void> {
    if (this.codeAgent?.identity !== "vendor") return;
    const runId = this.activeRunId ?? this.lastOwnedRunId;
    if (!runId) return;
    const run = this.runCoordinator.get(runId);
    if (!run) return;
    if (run.connectionGeneration !== this.connectionGeneration) return;
    const payload = {
      kind: "mcp_server_update" as const,
      serverId: ev.serverId,
      name: ev.name,
      status: ev.status,
    };
    let envelope: RunEventEnvelope | undefined;
    try {
      if (run.state === "terminal") {
        envelope = await this.runCoordinator.appendAfterTerminalEvent(runId, payload, "mcp_server_update");
      } else {
        envelope = await this.runCoordinator.appendOwnedEvent(
          runId,
          payload,
          "mcp_server_update",
          this.connectionGeneration,
        );
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "stale_generation") return;
      log("warn", "mcp_server_update journal apply failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      });
      return;
    }
    if (!envelope) return;
    const member = memberFromUpdate({
      serverId: ev.serverId,
      name: ev.name,
      status: ev.status,
      eventSeq: envelope.eventSeq,
    });
    if (!member) return;
    const prior =
      this.mcpServers.disposition === "ready" || this.mcpServers.disposition === "hydrating"
        ? (this.mcpServers.members ?? [])
        : [];
    this.replaceMcpServers(markMcpReady(this.mcpServers, applyMcpMember(prior, member)));
  }

  private vendorHooksEligible(): boolean {
    return this.cfg.mode === "code" && this.codeAgent?.identity === "vendor";
  }

  private replaceHooks(next: HooksMembershipFact): void {
    const same =
      next.disposition === this.hooks.disposition &&
      next.members === this.hooks.members;
    this.hooks = next;
    if (!same) this.broadcastState();
  }

  private syncHooksEligibility(): void {
    if (!this.vendorHooksEligible()) {
      this.replaceHooks(clearHooksToAbsent(this.hooks));
    }
  }

  private hookUpdatesFromEvents(events: RunEventEnvelope[]): HookUpdateInput[] {
    const out: HookUpdateInput[] = [];
    for (const e of events) {
      if (e.type !== "hook_update" || e.payload.kind !== "hook_update") continue;
      const parsed = parseCompleteHookFrame({
        hookId: e.payload.hookId,
        name: e.payload.name,
        status: e.payload.status,
      });
      if (!parsed) {
        if (typeof e.payload.hookId === "string" && e.payload.hookId) {
          out.push({
            hookId: e.payload.hookId,
            name: null,
            status: null,
            eventSeq: e.eventSeq,
            unrestorable: true,
          });
        } else {
          log("warn", "malformed hook_update ignored", { sessionId: this.sessionId });
        }
        continue;
      }
      out.push({ ...parsed, eventSeq: e.eventSeq });
    }
    return out;
  }

  private markHooksReadyFromEvents(events: RunEventEnvelope[]): void {
    if (!this.vendorHooksEligible()) {
      this.replaceHooks(clearHooksToAbsent(this.hooks));
      return;
    }
    const members = foldHooksMembersFromUpdates(this.hookUpdatesFromEvents(events));
    this.replaceHooks(markHooksReady(this.hooks, members));
  }

  private async restoreHooksFromJournal(runId?: string | null, sessionId?: string | null): Promise<void> {
    if (!this.vendorHooksEligible()) {
      this.replaceHooks(clearHooksToAbsent(this.hooks));
      return;
    }
    this.replaceHooks(enterHooksHydrating(this.hooks));
    try {
      await this.runHydration;
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceHooks(markHooksObtainFailed(this.hooks));
        return;
      }
      throw error;
    }
    try {
      let sid = sessionId ?? this.stableClientSessionId;
      let rid = runId ?? this.activeRunId ?? this.lastOwnedRunId;
      if (!rid || !sid) {
        const snapshots = await this.runCoordinator.listSnapshots();
        const owned = this.stableClientSessionId
          ? snapshots.filter((s) => s.sessionId === this.stableClientSessionId)
          : snapshots;
        const latest = owned.slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
        if (!latest) {
          this.replaceHooks(markHooksReady(this.hooks, []));
          return;
        }
        sid = latest.sessionId;
        rid = latest.runId;
      }
      const { events } = await this.runCoordinator.replay(sid, rid, 0);
      this.markHooksReadyFromEvents(events);
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        this.replaceHooks(markHooksObtainFailed(this.hooks));
        return;
      }
      throw error;
    }
  }

  private async applyLiveHookEvent(ev: Extract<AcpUiEvent, { type: "hook" }>): Promise<void> {
    if (this.codeAgent?.identity !== "vendor") return;
    const runId = this.activeRunId ?? this.lastOwnedRunId;
    if (!runId) return;
    const run = this.runCoordinator.get(runId);
    if (!run) return;
    if (run.connectionGeneration !== this.connectionGeneration) return;
    const payload = {
      kind: "hook_update" as const,
      hookId: ev.hookId,
      name: ev.name,
      status: ev.status,
    };
    let envelope: RunEventEnvelope | undefined;
    try {
      if (run.state === "terminal") {
        envelope = await this.runCoordinator.appendAfterTerminalEvent(runId, payload, "hook_update");
      } else {
        envelope = await this.runCoordinator.appendOwnedEvent(
          runId,
          payload,
          "hook_update",
          this.connectionGeneration,
        );
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "stale_generation") return;
      log("warn", "hook_update journal apply failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      });
      return;
    }
    if (!envelope) return;
    const member = memberFromHookUpdate({
      hookId: ev.hookId,
      name: ev.name,
      status: ev.status,
      eventSeq: envelope.eventSeq,
    });
    if (!member) return;
    const prior =
      this.hooks.disposition === "ready" || this.hooks.disposition === "hydrating"
        ? (this.hooks.members ?? [])
        : [];
    this.replaceHooks(markHooksReady(this.hooks, applyHookMember(prior, member)));
  }

  private async requestVendorHooksList(): Promise<void> {
    if (!this.vendorHooksEligible()) return;
    if (!this.client || !this.sessionId || !this.spawnLive) return;
    try {
      await this.client.listVendorHooks(this.sessionId);
    } catch (error) {
      log("warn", "vendor hooks list failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      });
    }
  }

  /** Idle vendor handshake so GET /api/state / WS can populate catalog without a Send. */
  warmSkillsCatalog(): void {
    if (this.cfg.mode !== "code") return;
    if (this.codeAgent?.identity !== "vendor") return;
    if (this.busy || this.activeRunId) return;
    if (this.client && this.sessionId && this.spawnLive) return;
    if (this.skillsWarm) return;
    this.skillsWarm = this.acquireCodeAgent(null)
      .catch((error) => {
        log("warn", "skills catalog warm failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.skillsWarm = null;
      });
  }

  private planEngagementView(): PlanEngagementView {
    if (this.cfg.mode !== "code") return { engaged: false, vouched: true };
    return { engaged: this.planEngaged, vouched: this.planEngagementVouched };
  }

  private chatPackView(): ChatPackView {
    if (this.cfg.mode === "code") return codeChatPackView();
    return this.chatPackState ?? emptyChatPackView(null);
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

  private chatPackBoundRoot(): string | null {
    if (this.cfg.mode === "chat") {
      return this.workspace || ensureChatRoot(this.cfg.chatRoot);
    }
    return this.workspace;
  }

  private adoptChatPackConversation(conversationId: string): void {
    if (this.chatPackState?.conversationId === conversationId) return;
    this.chatPackState = {
      conversationId,
      vouched: false,
      confirmFailed: false,
      members: { files: [], note: null },
      lastAttempt: this.chatPackState?.lastAttempt ?? "ok",
    };
  }

  private publishChatPackAndThrow(code: string, message: string): never {
    this.broadcastState();
    throw Object.assign(new Error(message), { code });
  }

  async applyChatPackMutation(body: {
    sessionId?: unknown;
    conversationId?: unknown;
    action?: unknown;
    path?: unknown;
    note?: unknown;
    members?: unknown;
  }): Promise<PublicState> {
    if (this.cfg.mode === "code") {
      throw Object.assign(new Error("Chat pack is not applicable in Code"), {
        code: "chat_pack_not_applicable",
      });
    }
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    if (!conversationId) {
      throw Object.assign(new Error("conversationId required"), { code: "invalid_request" });
    }
    const action = body.action;
    this.adoptChatPackConversation(conversationId);
    const root = this.chatPackBoundRoot();
    if (!root) {
      throw Object.assign(new Error("Chat pack root is not bound"), { code: "invalid_request" });
    }

    if (action === "pin_file") {
      if (typeof body.path !== "string" || !body.path) {
        throw Object.assign(new Error("path required"), { code: "invalid_request" });
      }
      const validated = await validatePinnedTextFile(root, body.path);
      if (!validated.ok) {
        this.chatPackState = {
          ...this.chatPackState,
          conversationId,
          lastAttempt: "pin_failed",
        };
        this.publishChatPackAndThrow("chat_pack_pin_refused", "Couldn’t pin that path.");
      }
      const files = this.chatPackState.members.files.slice();
      if (files.some((f) => f.path === validated.relativePath)) {
        this.chatPackState = {
          conversationId,
          vouched: true,
          confirmFailed: false,
          members: { files, note: this.chatPackState.members.note },
          lastAttempt: "ok",
        };
        this.broadcastState();
        return this.getState();
      }
      if (files.length >= CHAT_PACK_FILE_CAP) {
        this.chatPackState = {
          ...this.chatPackState,
          conversationId,
          lastAttempt: "pin_failed",
        };
        this.publishChatPackAndThrow("chat_pack_cap_refused", "Couldn’t pin that path.");
      }
      files.push({ path: validated.relativePath });
      this.chatPackState = {
        conversationId,
        vouched: true,
        confirmFailed: false,
        members: { files, note: this.chatPackState.members.note },
        lastAttempt: "ok",
      };
      this.broadcastState();
      return this.getState();
    }

    if (action === "unpin_file") {
      if (typeof body.path !== "string") {
        throw Object.assign(new Error("path required"), { code: "invalid_request" });
      }
      const candidates = new Set<string>([posixRelative(body.path)]);
      const validated = await validatePinnedTextFile(root, body.path);
      if (validated.ok) candidates.add(validated.relativePath);
      const files = this.chatPackState.members.files.filter((f) => !candidates.has(f.path));
      this.chatPackState = {
        conversationId,
        vouched: true,
        confirmFailed: false,
        members: { files, note: this.chatPackState.members.note },
        lastAttempt: "ok",
      };
      this.broadcastState();
      return this.getState();
    }

    if (action === "set_note") {
      if (typeof body.note !== "string") {
        throw Object.assign(new Error("note required"), { code: "invalid_request" });
      }
      if (!noteLengthOk(body.note)) {
        this.chatPackState = {
          ...this.chatPackState,
          conversationId,
          lastAttempt: "note_failed",
        };
        this.publishChatPackAndThrow("chat_pack_cap_refused", "Couldn’t save the pack note.");
      }
      const note = body.note === "" ? null : body.note;
      this.chatPackState = {
        conversationId,
        vouched: true,
        confirmFailed: false,
        members: { files: this.chatPackState.members.files, note },
        lastAttempt: "ok",
      };
      this.broadcastState();
      return this.getState();
    }

    if (action === "clear_note") {
      this.chatPackState = {
        conversationId,
        vouched: true,
        confirmFailed: false,
        members: { files: this.chatPackState.members.files, note: null },
        lastAttempt: "ok",
      };
      this.broadcastState();
      return this.getState();
    }

    if (action === "clear_pack") {
      this.chatPackState = {
        conversationId,
        vouched: true,
        confirmFailed: false,
        members: { files: [], note: null },
        lastAttempt: "ok",
      };
      this.broadcastState();
      return this.getState();
    }

    if (action === "hydrate") {
      const priorAttempt = this.chatPackState.lastAttempt;
      this.chatPackState = {
        conversationId,
        vouched: false,
        confirmFailed: false,
        members: { files: [], note: null },
        lastAttempt: priorAttempt,
      };
      this.broadcastState();

      const rawMembers = body.members;
      if (!rawMembers || typeof rawMembers !== "object") {
        throw Object.assign(new Error("members required"), { code: "invalid_request" });
      }
      const filesIn = Array.isArray((rawMembers as { files?: unknown }).files)
        ? ((rawMembers as { files: unknown[] }).files)
        : [];
      const noteIn = (rawMembers as { note?: unknown }).note;
      const submitted: string[] = [];
      const seen = new Set<string>();
      for (const entry of filesIn) {
        const p =
          entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string"
            ? posixRelative((entry as { path: string }).path)
            : "";
        if (!p || seen.has(p)) continue;
        seen.add(p);
        submitted.push(p);
      }
      const noteRaw = typeof noteIn === "string" ? noteIn : noteIn == null ? null : null;
      const noteOverCap = noteRaw != null && !noteLengthOk(noteRaw);
      if (submitted.length > CHAT_PACK_FILE_CAP || noteOverCap) {
        this.chatPackState = {
          conversationId,
          vouched: true,
          confirmFailed: false,
          members: { files: [], note: null },
          lastAttempt: "hydrate_failed",
        };
        this.publishChatPackAndThrow("chat_pack_cap_refused", "Couldn’t reconfirm the pack — over the pin cap.");
      }

      const armedFiles: Array<{ path: string }> = [];
      let dropped = false;
      for (const rel of submitted) {
        const validated = await validatePinnedTextFile(root, rel);
        if (!validated.ok) {
          dropped = true;
          continue;
        }
        armedFiles.push({ path: validated.relativePath });
      }
      const note = noteRaw === "" || noteRaw == null ? null : noteRaw;
      const confirmFail = process.env.GROKFORGE_CHAT_PACK_CONFIRM_FAIL === "1";
      this.chatPackState = {
        conversationId,
        vouched: !confirmFail,
        confirmFailed: confirmFail,
        members: { files: armedFiles, note },
        lastAttempt: dropped ? "hydrate_failed" : "ok",
      };
      this.broadcastState();
      return this.getState();
    }

    throw Object.assign(new Error("invalid chat-pack action"), { code: "invalid_request" });
  }

  async materializeChatPackForSend(input: {
    runId: string;
    sessionId: string;
    conversationId: string | null;
    connectionGeneration: number;
  }): Promise<{ promptSection: string | null; turn: ChatPackTurnVoucher }> {
    const conversationId = input.conversationId ?? "";
    const base = {
      runId: input.runId,
      sessionId: input.sessionId,
      conversationId,
      connectionGeneration: input.connectionGeneration,
    };
    const unconfirmed = (): { promptSection: string | null; turn: ChatPackTurnVoucher } => ({
      promptSection: null,
      turn: { ...base, inclusion: "unconfirmed", fault: null, files: [], noteIncluded: false },
    });
    const view = this.chatPackState ?? emptyChatPackView(null);
    if (!conversationId || view.conversationId !== conversationId) {
      return unconfirmed();
    }
    if (view.confirmFailed) {
      return {
        promptSection: null,
        turn: { ...base, inclusion: "confirm_failed", fault: null, files: [], noteIncluded: false },
      };
    }
    if (!view.vouched) {
      return unconfirmed();
    }
    if (membersAreEmpty(view.members)) {
      return {
        promptSection: null,
        turn: { ...base, inclusion: "not_included", fault: null, files: [], noteIncluded: false },
      };
    }
    const root = this.chatPackBoundRoot();
    if (!root) {
      const failing = view.members.files[0] ? [view.members.files[0]] : [];
      return {
        promptSection: null,
        turn: { ...base, inclusion: "materialization_fault", fault: "path", files: failing, noteIncluded: false },
      };
    }
    const loaded: Array<{ path: string; body: string }> = [];
    for (const member of view.members.files) {
      const validated = await validatePinnedTextFile(root, member.path);
      if (!validated.ok) {
        return {
          promptSection: null,
          turn: {
            ...base,
            inclusion: "materialization_fault",
            fault: "path",
            files: [{ path: member.path }],
            noteIncluded: false,
          },
        };
      }
      loaded.push({ path: validated.relativePath, body: validated.body });
    }
    if (sumFileContentsLength(loaded.map((f) => f.body)) > CHAT_PACK_FILE_CONTENTS_CAP) {
      return {
        promptSection: null,
        turn: { ...base, inclusion: "materialization_fault", fault: "over_cap", files: [], noteIncluded: false },
      };
    }
    const note = view.members.note;
    const promptSection = buildChatPackPromptSection({ note, files: loaded });
    return {
      promptSection,
      turn: {
        ...base,
        inclusion: "included",
        fault: null,
        files: loaded.map((f) => ({ path: f.path })),
        noteIncluded: note != null,
      },
    };
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

  /** Plan arm is for the next send. A finished turn with no plan dock must not leak it. */
  private releasePlanArmIfIdle(): boolean {
    if (!this.planEngaged) return false;
    if (this.hasPendingPlanDecision()) return false;
    this.planEngaged = false;
    return true;
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
    if (next === "chat") {
      this.codeAgent = null;
      this.clearSkillsCatalogToAbsent();
      this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
      this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
      this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
      this.replaceHooks(clearHooksToAbsent(this.hooks));
      await this.restartAgent();
    } else {
      await this.disposeAgentClient();
      if (this.workspace) this.eagerResolveCodeAgent();
      else this.codeAgent = null;
      this.syncChildAgentsEligibility();
      this.syncBrowserWorkEligibility();
      this.syncMcpServersEligibility();
      this.syncHooksEligibility();
      if (this.vendorChildAgentsEligible()) await this.restoreChildAgentsFromJournal();
      if (this.vendorBrowserWorkEligible()) await this.restoreBrowserWorkFromJournal();
      if (this.vendorMcpEligible()) await this.restoreMcpServersFromJournal();
      if (this.vendorHooksEligible()) await this.restoreHooksFromJournal();
    }
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

    await this.disposeAgentClient();
    this.eagerResolveCodeAgent();
    this.syncChildAgentsEligibility();
    this.syncBrowserWorkEligibility();
    this.syncMcpServersEligibility();
    this.syncHooksEligibility();
    if (this.vendorChildAgentsEligible()) await this.restoreChildAgentsFromJournal();
    if (this.vendorBrowserWorkEligible()) await this.restoreBrowserWorkFromJournal();
    if (this.vendorMcpEligible()) await this.restoreMcpServersFromJournal();
    if (this.vendorHooksEligible()) await this.restoreHooksFromJournal();
    await this.refreshProjectInstructionsPresence();
    this.broadcastState();
    return this.getState();
  }

  private eagerResolveCodeAgent(): void {
    this.codeAgent = stampCodeAgentFact({ kind: "resolving" });
    this.broadcastState();
    this.codeAgent = stampCodeAgentFact({ kind: "house" });
    this.clearSkillsCatalogToAbsent();
    this.syncChildAgentsEligibility();
    this.syncBrowserWorkEligibility();
    this.syncMcpServersEligibility();
    this.syncHooksEligibility();
    this.broadcastState();
  }

  private clearSkillsObtainTimer(): void {
    if (this.skillsObtainTimer) {
      clearTimeout(this.skillsObtainTimer);
      this.skillsObtainTimer = null;
    }
  }

  private replaceSkillsCatalog(next: SkillsCatalogFact, timer: "obtain" | "off"): void {
    const same =
      next.disposition === this.skillsCatalog.disposition && next.commands === this.skillsCatalog.commands;
    this.skillsCatalog = next;
    this.clearSkillsObtainTimer();
    if (timer === "obtain" && next.disposition === "awaiting_first_valid") {
      this.skillsObtainTimer = setTimeout(() => {
        this.skillsObtainTimer = null;
        if (this.codeAgent?.identity !== "vendor") return;
        const after = markObtainFailed(this.skillsCatalog);
        if (after.disposition === this.skillsCatalog.disposition && after.commands === this.skillsCatalog.commands) {
          return;
        }
        this.skillsCatalog = after;
        this.broadcastState();
      }, this.skillsCatalogObtainTimeoutMs);
      this.skillsObtainTimer.unref?.();
    }
    if (!same) this.broadcastState();
  }

  private clearSkillsCatalogToAbsent(): void {
    this.replaceSkillsCatalog(clearToAbsent(this.skillsCatalog), "off");
  }

  private withholdSkillsCatalogOnDisconnect(): void {
    if (this.codeAgent?.identity !== "vendor") {
      this.clearSkillsCatalogToAbsent();
      return;
    }
    this.replaceSkillsCatalog(markTransportDisconnect(this.skillsCatalog), "obtain");
  }

  private applyAvailableCommandsEvent(ev: Extract<AcpUiEvent, { type: "available_commands" }>): void {
    if (this.cfg.mode !== "code") return;
    if (this.codeAgent?.identity === "fallback" || this.codeAgent?.identity === "hard_fail") return;
    if (ev.valid && Array.isArray(ev.commands)) {
      const firstReady = this.skillsCatalog.disposition !== "ready";
      this.replaceSkillsCatalog(applyValidCommands(this.skillsCatalog, ev.commands), "off");
      if (firstReady) {
        log("info", "skills catalog ready", {
          count: ev.commands.length,
          sessionId: this.sessionId,
        });
      }
      return;
    }
    log("warn", "malformed available_commands ignored", { sessionId: this.sessionId });
    const next = ignoreMalformed(this.skillsCatalog);
    this.replaceSkillsCatalog(next, "off");
  }

  private async waitForSkillsCatalogAdvertisement(maxMs = 150): Promise<void> {
    if (this.codeAgent?.identity !== "vendor") return;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const d = this.skillsCatalog.disposition;
      if (d === "ready" || d === "obtain_failed") return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private async disposeAgentClient(): Promise<void> {
    await this.mintExecutionOwnerLostIfInFlight();
    this.pendingFallback = null;
    this.pendingPromptOrigin = null;
    this.spawnLive = false;
    this.clearSkillsCatalogToAbsent();
    if (!this.client) {
      this.sessionId = null;
      this.setBusy(false);
      return;
    }
    const prev = this.client;
    this.client = null;
    this.sessionId = null;
    try {
      await prev.dispose();
    } catch {
      /* ignore */
    }
    this.setBusy(false);
  }

  private grokAcpEnv(mode: "chat" | "code", token: string | null): Record<string, string> {
    return {
      ...Object.fromEntries(Object.entries(this.executionEnvironment.effectiveEnvironment).filter(([key]) => key !== "GROKFORGE_BYPASS_SECRET")),
      XAI_API_KEY: token ?? "",
      XAI_MODEL: this.cfg.model,
      GROKFORGE_MODE: mode,
      GROKFORGE_SHELL_ALLOWLIST: this.cfg.shellAllowlist === false ? "0" : "1",
      GROKFORGE_DATA_DIR: dataDir(),
    };
  }

  private vendorBaseEnv(): Record<string, string> {
    const base: Record<string, string> = {
      ...Object.fromEntries(Object.entries(this.executionEnvironment.effectiveEnvironment).filter(([key]) => key !== "GROKFORGE_BYPASS_SECRET")),
      XAI_MODEL: this.cfg.model,
      GROKFORGE_MODE: "code",
      GROKFORGE_SHELL_ALLOWLIST: this.cfg.shellAllowlist === false ? "0" : "1",
      GROKFORGE_DATA_DIR: dataDir(),
    };
    if (process.env.GROKFORGE_VENDOR_FIXTURE) {
      base.GROKFORGE_VENDOR_FIXTURE = process.env.GROKFORGE_VENDOR_FIXTURE;
    }
    return vendorSpawnEnv(base);
  }

  private attachCurrentClientHandlers(client: StdioAcpClient): void {
    this.client = client;
    this.spawnLive = false;
    const toolNames = new Map<string, string>();
    const gen = client;
    let eventChain: Promise<void> = Promise.resolve();
    client.onEvent((ev) => {
      eventChain = eventChain.then(async () => {
        if (this.client !== gen) return;
        if (ev.type === "available_commands") {
          this.applyAvailableCommandsEvent(ev);
          return;
        }
        if (ev.type === "child_agent") {
          await this.applyLiveChildAgentEvent(ev);
          return;
        }
        if (ev.type === "mcp_server") {
          await this.applyLiveMcpServerEvent(ev);
          return;
        }
        if (ev.type === "vendor_plan_exit") {
          const run = this.activeRunId ? this.runCoordinator.get(this.activeRunId) : undefined;
          if (!run || !this.activeRunId) {
            await this.client?.respondPlanExit?.(ev.id, "abandoned");
            return;
          }
          const body = planBodyFromVendorExit(
            ev.planContent,
            this.runCoordinator.getAccumulatedAnswer(this.activeRunId),
            await this.vendorPlanFileBody(run.runId, run.sessionId),
          );
          if (body) {
            await this.settlePlanPhase(run, "answered", body, String(ev.id));
          } else {
            // Empty `Plan: Exit` — let the vendor finish the plan text, then
            // stamp the dock from the accumulated answer at prompt done.
            await this.client?.respondPlanExit?.(ev.id, "approved");
          }
          await this.appendPostToolRunState(this.activeRunId, "terminal");
          return;
        }
        if (ev.type === "hook") {
          await this.applyLiveHookEvent(ev);
          return;
        }
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
          if (this.activeRunId) {
            const run = this.runCoordinator.get(this.activeRunId);
            if (run) {
              const activity = activityRecordFromToolRun(ev, run.policy);
              const envelope = await this.runCoordinator.appendOwnedEvent(this.activeRunId, { kind: "activity_update", activity }, "activity_update").catch(() => undefined);
              if (envelope) {
                await this.appendPostToolRunState(this.activeRunId, ev.lifecycle);
                this.applyLiveBrowserWork(activity, envelope.eventSeq);
                return;
              }
            }
          }
        }
        if (ev.type === "tool_run" && ev.lifecycle === "terminal" && ev.execution === "executed") {
          const name = toolNames.get(ev.toolCallId) || "tool";
          const meta = summarizeToolOutput(ev.output);
          if (ev.status === "failed") {
            log("warn", "tool failed", { id: ev.toolCallId, name, sessionId: this.sessionId, ...meta });
          } else {
            log("debug", "tool ok", { id: ev.toolCallId, name, sessionId: this.sessionId, ...meta });
          }
        }
        if (ev.type === "permission_request") {
          log("info", "permission requested", { id: ev.id, kind: ev.kind, detail: ev.detail.slice(0, 200) });
          if (this.activeRunId) {
            const run = this.runCoordinator.get(this.activeRunId);
            if (run) {
              const replyDialect = this.codeAgent?.identity === "vendor" ? "acp_result" as const : "grok_permission_respond" as const;
              const invocationId =
                typeof ev.toolCallId === "string" && ev.toolCallId ? ev.toolCallId : ev.id;
              this.pendingDecisions.set(ev.id, {
                sessionId: run.sessionId,
                runId: run.runId,
                generation: run.connectionGeneration,
                invocationId,
                kind: "permission",
                permissionKind: ev.kind,
                status: "pending",
                expiresAt: 0,
                replyDialect,
              });
              const envelope = await this.runCoordinator.appendOwnedEvent(this.activeRunId, {
                kind: "decision_request",
                request: {
                  requestId: ev.id,
                  invocationId,
                  kind: "permission",
                  status: "pending",
                  title: ev.kind === "shell" ? "Run shell" : "Write file",
                  detail: ev.detail,
                  expiresAt: null,
                  policy: run.policy,
                },
              }, "decision_request").catch(() => undefined);
              if (envelope) return;
            }
          }
        }
        if (ev.type === "file_edit") {
          if (ev.status !== "proposed") return;
          if (this.activeRunId) {
            const run = this.runCoordinator.get(this.activeRunId);
            if (run) {
              const editId = ev.editId ?? ev.id;
              const invocationId = ev.invocationId ?? ev.toolCallId ?? editId;
              this.pendingDecisions.set(ev.id, {
                sessionId: run.sessionId,
                runId: run.runId,
                generation: run.connectionGeneration,
                invocationId,
                kind: "diff",
                status: "pending",
                expiresAt: 0,
              });
              const envelope = await this.runCoordinator.appendOwnedEvent(this.activeRunId, {
                kind: "decision_request",
                request: {
                  requestId: ev.id,
                  invocationId,
                  kind: "diff",
                  status: "pending",
                  title: "Edit file",
                  detail: ev.path,
                  expiresAt: null,
                  policy: run.policy,
                },
              }, "decision_request").catch(() => undefined);
              const kind = ev.kind ?? (ev.diff ? "content" : null);
              const canJournal =
                Boolean(editId) &&
                ((kind === "content" && ev.path && typeof ev.diff === "string" && ev.diff.length > 0) ||
                  (kind === "delete" && ev.path) ||
                  (kind === "rename" && ev.fromPath && ev.toPath));
              if (canJournal) {
                const activity = activityRecordFromProposedEdit({
                  editId,
                  invocationId,
                  path: kind === "rename" ? String(ev.fromPath) : ev.path!,
                  diff: ev.diff ?? null,
                  kind: kind as MutationKind,
                  fromPath: ev.fromPath ?? null,
                  toPath: ev.toPath ?? null,
                  name: kind === "delete" ? "delete_file" : kind === "rename" ? "rename_file" : "write_file",
                  policy: run.policy,
                });
                await this.runCoordinator.appendOwnedEvent(this.activeRunId, { kind: "activity_update", activity }, "activity_update").catch(() => undefined);
              }
              if (envelope) return;
            }
          }
        }
        if (ev.type === "agent_log") {
          log(ev.level === "warn" ? "warn" : "debug", "agent stderr", { message: ev.message.slice(0, 500) });
          if (ev.level !== "warn") return;
        }
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
            return;
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
          this.pendingFallback.suppressNextDone = false;
          return;
        }
        if (this.activeRunId && ev.type === "text_delta" && ev.text) {
          const envelope = await this.runCoordinator
            .appendOwnedEvent(
              this.activeRunId,
              { kind: "message_delta", segmentId: `message-${this.activeRunId}`, delta: ev.text },
              "message_delta",
            )
            .catch(() => undefined);
          if (envelope) return;
        }
        if (this.activeRunId && ev.type === "thinking_delta" && ev.text) {
          const envelope = await this.runCoordinator
            .appendOwnedEvent(
              this.activeRunId,
              { kind: "reasoning_delta", segmentId: `reasoning-${this.activeRunId}`, delta: ev.text },
              "reasoning_delta",
            )
            .catch(() => undefined);
          if (envelope) return;
        }
        if (this.activeRunId && ev.type === "run_phase" && ev.phase !== "done") {
          const liveness = ev.phase === "tools" ? "tool" : "provider";
          const recovering = /recover/i.test(String(ev.detail ?? ""));
          const envelope = await this.runCoordinator.appendOwnedEvent(this.activeRunId, { kind: "run_state", state: recovering ? "recovering" : "running", liveness }, "run_state").catch(() => undefined);
          if (envelope) return;
        }
        const preLiveExit =
          !this.spawnLive &&
          this.cfg.mode === "code" &&
          ((ev.type === "error" && ev.code === "agent_exited") || (ev.type === "done" && ev.reason === "agent_exited"));
        if (preLiveExit) {
          if (this.client === gen) {
            this.client = null;
            this.sessionId = null;
          }
          return;
        }
        if (ev.type === "done" || ev.type === "error") {
          if (this.activeRunId) {
            const active = this.runCoordinator.get(this.activeRunId);
            const exited =
              (ev.type === "error" && ev.code === "agent_exited") ||
              (ev.type === "done" && ev.reason === "agent_exited");
            const cancelled =
              active?.state === "cancelling" ||
              (ev.type === "done" && ev.reason === "cancelled");
            const terminal: TerminalKind = cancelled
              ? "cancelled"
              : (ev.type === "error" || ev.reason === "error" || exited ? "failed" : "answered");
            // Plan Accept/Keep already queued an answered end and cancelled the
            // vendor TUI wait — don't CAS-finalize that cancel as cancelled.
            if (this.queuedTurnEnd.has(this.activeRunId) && !this.hasUnansweredAskForRun(this.activeRunId)) {
              await this.drainQueuedTurnEnd(this.activeRunId);
              this.emit(ev);
              return;
            }
            // Asks already open at RPC return win: queue completion; do not CAS-finalize yet.
            // Asks this completion itself will mint (plan settlePlanPhase) are not a hold —
            // only pre-existing pendingDecisions count here.
            if (terminal === "answered" && this.hasUnansweredAskForRun(this.activeRunId)) {
              this.queuedTurnEnd.set(this.activeRunId, { terminalKind: terminal, failure: null });
              await this.appendPostToolRunState(this.activeRunId, "terminal");
              this.setBusy(true);
              this.broadcastState();
              this.emit(ev);
              return;
            }
            this.queuedTurnEnd.delete(this.activeRunId);
            await this.cancelPendingToolDecisions(this.activeRunId);
            const failureCode = exited
              ? "agent_exited"
              : ev.type === "error"
                ? ({
                    missing_final_answer: "missing_final_answer",
                    provider_liveness_timeout: "provider_liveness_exhausted",
                    provider_liveness_exhausted: "provider_liveness_exhausted",
                    auth_missing: "authentication_required",
                    configuration_required: "configuration_required",
                    execution_owner_lost: "execution_owner_lost",
                    agent_exited: "agent_exited",
                  } as Record<string, "missing_final_answer" | "provider_liveness_exhausted" | "authentication_required" | "configuration_required" | "execution_owner_lost" | "agent_exited">)[ev.code] ?? "provider_unavailable"
                : null;
            if (active && (active.executionPhase === "plan" || this.planEngaged)) {
              await this.settlePlanPhase(active, terminal, this.runCoordinator.getAccumulatedAnswer(this.activeRunId) || null);
            }
            await this.runCoordinator.finalize(
              this.activeRunId,
              terminal,
              null,
              terminal === "failed"
                ? {
                    code: failureCode ?? "provider_unavailable",
                    message: exited
                      ? "The agent process exited."
                      : ev.type === "error" && ev.code === "missing_final_answer"
                        ? "No final answer was produced."
                        : "The run ended before a final answer. Your prompt and received output are preserved.",
                    retryable: true,
                    recoveryAction: "retry_prompt",
                  }
                : null,
            );
            this.activeRunId = null;
          }
          if (ev.type === "done" && ev.reason === "stop" && this.pendingFallback) {
            const pf = this.pendingFallback;
            if (pf.attemptIdx > 0) {
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
          this.releasePlanArmIfIdle();
          if (ev.type === "error" && ev.code === "agent_exited") {
            if (this.client === gen) {
              this.client = null;
              this.sessionId = null;
            }
            this.withholdSkillsCatalogOnDisconnect();
          }
          if (ev.type === "done" && ev.reason !== "error" && ev.reason !== "agent_exited" && this.pendingPromptOrigin) {
            recordCompletedConversation(this.pendingPromptOrigin);
          }
          this.pendingPromptOrigin = null;
          await this.reclaimTerminalContext(gen);
          this.broadcastState();
        }
        if (ev.type === "done") {
          log("debug", "agent done", { reason: ev.reason, sessionId: this.sessionId });
        }
        this.emit(ev);
      }).catch((error) => {
        log("error", "agent event handling failed", {
          message: error instanceof Error ? error.message : String(error),
          sessionId: this.sessionId,
        });
      });
    });
  }

  private async handshakeLive(client: StdioAcpClient, emitStartFailed: boolean): Promise<boolean> {
    const gen = client;
    try {
      await client.initialize();
      if (this.client !== gen) {
        try { await client.dispose(); } catch { /* ignore */ }
        return false;
      }
      const sid = await client.newSession();
      if (this.client !== gen) {
        try { await client.dispose(); } catch { /* ignore */ }
        return false;
      }
      this.sessionId = sid;
      this.connectionGeneration += 1;
      this.spawnLive = true;
      log("info", "agent session ready", {
        sessionId: this.sessionId,
        workspace: this.workspace,
        mode: this.cfg.mode,
      });
      return true;
    } catch (e) {
      this.spawnLive = false;
      if (this.client === gen) {
        this.client = null;
        this.sessionId = null;
      }
      try { await client.dispose(); } catch { /* ignore */ }
      log("error", "agent start failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      if (emitStartFailed) {
        this.emit({
          type: "error",
          code: "agent_start_failed",
          message: e instanceof Error ? e.message : "Failed to start agent session",
        });
      }
      return false;
    }
  }

  private async stampLiveProvenance(ownedRunId: string | null, provenance: CodeRunAgentProvenance): Promise<void> {
    if (!ownedRunId) return;
    await this.runCoordinator.stampCodeAgentProvenance(ownedRunId, provenance);
    const run = this.runCoordinator.get(ownedRunId);
    if (run) run.codeAgentProvenance = provenance;
  }

  private async acquireCodeAgent(ownedRunId: string | null): Promise<void> {
    if (!this.workspace) throw new Error("Open a workspace first");
    if (
      this.client &&
      this.sessionId &&
      this.spawnLive &&
      this.codeAgent?.identity === "house"
    ) {
      await this.stampLiveProvenance(ownedRunId, { identity: "house", fallbackReason: null });
      this.broadcastState();
      return;
    }
    await this.disposeAgentClient();
    const grokOk = await this.startGrokAcpChild(false);
    if (grokOk) {
      this.codeAgent = stampCodeAgentFact({ kind: "house" });
      this.clearSkillsCatalogToAbsent();
      this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
      this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
      this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
      this.replaceHooks(clearHooksToAbsent(this.hooks));
      await this.stampLiveProvenance(ownedRunId, { identity: "house", fallbackReason: null });
      this.broadcastState();
      return;
    }
    this.codeAgent = stampCodeAgentFact({ kind: "hard_fail" });
    this.clearSkillsCatalogToAbsent();
    this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
    this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
    this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
    this.replaceHooks(clearHooksToAbsent(this.hooks));
    this.broadcastState();
    throw Object.assign(new Error("Couldn't start an agent for Code."), { code: "hard_fail" });
  }

  private async startGrokAcpChild(emitStartFailed: boolean): Promise<boolean> {
    if (!this.workspace) return false;
    const { token, source } = await resolveApiKeyAsync(this.cfg);
    const { command, args } = this.agentEntry();
    const mode = this.cfg.mode === "code" ? "code" : "chat";
    log("info", "starting agent", { source, workspace: this.workspace, mode });
    const client = new StdioAcpClient({
      workspaceRoot: this.workspace,
      command,
      args,
      executionProfile: this.executionEnvironment.profile,
      env: Object.freeze(this.grokAcpEnv(mode, token ?? null)),
    });
    this.attachCurrentClientHandlers(client);
    return this.handshakeLive(client, emitStartFailed);
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
    if (this.cfg.mode === "code") {
      await this.acquireCodeAgent(this.activeRunId);
      return;
    }
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
      this.clearSkillsCatalogToAbsent();
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
      if (mode === "code") {
        if (!this.workspace) {
          this.broadcastState();
          return this.getState();
        }
        this.eagerResolveCodeAgent();
        this.broadcastState();
        return this.getState();
      }
      if (mode === "chat") {
        this.codeAgent = null;
        this.clearSkillsCatalogToAbsent();
        this.replaceChildAgents(clearChildAgentsToAbsent(this.childAgents));
        this.replaceBrowserWork(clearBrowserWorkToAbsent(this.browserWork));
        this.replaceMcpServers(clearMcpServersToAbsent(this.mcpServers));
        this.replaceHooks(clearHooksToAbsent(this.hooks));
        this.workspace = ensureChatRoot(this.cfg.chatRoot);
      } else if (!this.workspace) {
        this.broadcastState();
        return this.getState();
      }

      await this.startGrokAcpChild(true);
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
      /** Chat home this send belongs to — pack materialization is keyed by this id. */
      conversationId?: string;
      skillHandoff?: { name: string } | null;
    },
  ): Promise<RunSnapshot> {
    if (this.activeRunId && this.runCoordinator.get(this.activeRunId)?.state === "terminal") { this.activeRunId = null; this.pendingFallback = null; this.setBusy(false); }
    if (this.busy) {
      throw Object.assign(new Error("Agent is busy — wait or Cancel before sending again"), { code: "run_active" });
    }
    this.setBusy(true);
    try {
    await this.runHydration;
    this.cfg = loadConfig();
    this.stableClientSessionId = opts?.clientSessionId ?? this.stableClientSessionId;
    const mode = this.cfg.mode === "code" ? "code" : "chat";
    const executionPhase = this.resolveExecutionPhaseForAdmit(mode);
    if (mode === "chat") {
      this.workspace = ensureChatRoot(this.cfg.chatRoot);
    } else if (!this.workspace) {
      throw new Error("Open a workspace first");
    }
    // D1 ordering (F-2): set the attribution AFTER ensureAgent()/restartAgent()/acquire, never before.
    if (mode === "chat") {
      await this.ensureAgent();
    } else {
      await this.acquireCodeAgent(null);
    }
    if (!this.stableClientSessionId) this.stableClientSessionId = this.sessionId;
    this.pendingPromptOrigin = opts?.originKey ?? null;
    if (!this.client || !this.sessionId) {
      if (mode === "code" && this.codeAgent?.identity === "hard_fail") {
        throw Object.assign(new Error("Couldn't start an agent for Code."), { code: "hard_fail" });
      }
      throw new Error("Agent not connected");
    }

    if (this.codeAgent?.identity === "vendor") {
      await this.waitForSkillsCatalogAdvertisement();
    }
    const handoffDecision = decideSkillHandoff(opts?.skillHandoff, this.skillsCatalog, text);
    if (handoffDecision.action === "refuse") {
      throw Object.assign(new Error(handoffDecision.error), {
        code: handoffDecision.code,
        status: handoffDecision.status,
      });
    }

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

    const admitted = await this.runCoordinator.admit({
      sessionId: opts?.clientSessionId || this.sessionId,
      prompt: text,
      connectionGeneration: this.connectionGeneration,
      policy: workspacePolicy,
      model: { requestedModel: this.cfg.model, appliedModel: modelsChain[0], selectionProvenance: this.cfg.modelSelectionProvenance },
      executionPhase,
    });
    this.activeRunId = admitted.runId;
    this.lastOwnedRunId = admitted.runId;
    if (this.vendorChildAgentsEligible()) {
      this.replaceChildAgents(enterHydrating(this.childAgents));
      try {
        const folded = await this.runCoordinator.replay(admitted.sessionId, admitted.runId, 0);
        this.markChildAgentsReadyFromEvents(folded.events);
      } catch (error) {
        if (this.isJournalObtainFailure(error)) {
          this.replaceChildAgents(markChildAgentsObtainFailed(this.childAgents));
        } else {
          throw error;
        }
      }
    } else {
      this.syncChildAgentsEligibility();
    }
    if (this.vendorBrowserWorkEligible()) {
      this.replaceBrowserWork(enterBrowserHydrating(this.browserWork));
      try {
        const foldedBrowser = await this.runCoordinator.replay(admitted.sessionId, admitted.runId, 0);
        this.markBrowserWorkReadyFromEvents(foldedBrowser.events);
      } catch (error) {
        if (this.isJournalObtainFailure(error)) {
          this.replaceBrowserWork(markBrowserObtainFailed(this.browserWork));
        } else {
          throw error;
        }
      }
    } else {
      this.syncBrowserWorkEligibility();
    }
    if (this.vendorMcpEligible()) {
      this.replaceMcpServers(enterMcpHydrating(this.mcpServers));
      try {
        const foldedMcp = await this.runCoordinator.replay(admitted.sessionId, admitted.runId, 0);
        this.markMcpServersReadyFromEvents(foldedMcp.events);
      } catch (error) {
        if (this.isJournalObtainFailure(error)) {
          this.replaceMcpServers(markMcpObtainFailed(this.mcpServers));
        } else {
          throw error;
        }
      }
    } else {
      this.syncMcpServersEligibility();
    }
    if (this.vendorHooksEligible()) {
      this.replaceHooks(enterHooksHydrating(this.hooks));
      try {
        const foldedHooks = await this.runCoordinator.replay(admitted.sessionId, admitted.runId, 0);
        this.markHooksReadyFromEvents(foldedHooks.events);
      } catch (error) {
        if (this.isJournalObtainFailure(error)) {
          this.replaceHooks(markHooksObtainFailed(this.hooks));
        } else {
          throw error;
        }
      }
      await this.requestVendorHooksList();
    } else {
      this.syncHooksEligibility();
    }
    if (mode === "code") {
      const identity = this.codeAgent?.identity;
      if (identity === "vendor" || identity === "fallback") {
        await this.stampLiveProvenance(admitted.runId, {
          identity,
          fallbackReason: this.codeAgent?.fallbackReason ?? null,
        });
      }
    }
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
      executionPhase,
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
      let acpText = text;
      if (mode === "chat") {
        const voucher = await this.materializeChatPackForSend({
          runId: admitted.runId,
          sessionId: admitted.sessionId,
          conversationId: opts?.conversationId ?? null,
          connectionGeneration: admitted.connectionGeneration,
        });
        if (voucher.turn.inclusion === "included" && voucher.promptSection) {
          acpText = text + voucher.promptSection;
        }
        await this.runCoordinator.appendOwnedEvent(
          admitted.runId,
          { kind: "chat_pack", chatPack: voucher.turn },
          "chat_pack",
        ).catch(() => undefined);
      }
      if (this.pendingFallback) this.pendingFallback.text = acpText;
      await this.client.prompt(this.sessionId, acpText, {
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
      if (mode === "code") {
        if (handoffDecision.action === "accept") {
          await this.runCoordinator.stampSkillHandoffProvenance(admitted.runId, {
            kind: "consumed",
            name: handoffDecision.name,
          });
        } else {
          await this.runCoordinator.stampSkillHandoffProvenance(admitted.runId, {
            kind: "none",
            name: null,
          });
        }
      }
    } catch (e) {
      this.pendingFallback = null;
      if (mode === "code" && this.activeRunId) {
        await this.runCoordinator.stampSkillHandoffProvenance(this.activeRunId, { kind: "none", name: null }).catch(() => undefined);
      }
      if (this.activeRunId) {
        const queued = this.queuedTurnEnd.get(this.activeRunId);
        if (queued) {
          await this.drainQueuedTurnEnd(this.activeRunId);
        } else {
          await this.runCoordinator.finalize(this.activeRunId, "failed", null, { code: "provider_unavailable", message: "Prompt failed.", retryable: true, recoveryAction: "retry_prompt" });
          this.activeRunId = null;
        }
      }
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
    } catch (e) {
      if (!this.activeRunId) this.setBusy(false);
      throw e;
    }
  }
  async shutdown(): Promise<void> {
    this.clearSkillsObtainTimer();
    await this.mintExecutionOwnerLostIfInFlight();
    const c=this.client;
    this.client=null;
    this.sessionId=null;
    this.spawnLive = false;
    if(c) await c.dispose().catch(()=>undefined);
  }
  /** Release the ACP process once a run is terminal; journal/replay state remains owned here. */
  private async reclaimTerminalContext(gen: StdioAcpClient): Promise<void> {
    if (this.client !== gen || this.activeRunId || this.busy) return;
    if (this.codeAgent?.identity === "vendor" && this.spawnLive) {
      return;
    }
    this.client = null;
    this.sessionId = null;
    this.spawnLive = false;
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
    try {
      const result = await this.runCoordinator.replay(clientSessionId, runId, after);
      if (this.vendorChildAgentsEligible()) {
        this.markChildAgentsReadyFromEvents(result.events);
      }
      if (this.vendorBrowserWorkEligible()) {
        this.markBrowserWorkReadyFromEvents(result.events);
      }
      if (this.vendorMcpEligible()) {
        this.markMcpServersReadyFromEvents(result.events);
      }
      if (this.vendorHooksEligible()) {
        this.markHooksReadyFromEvents(result.events);
      }
      return result;
    } catch (error) {
      if (this.isJournalObtainFailure(error)) {
        if (this.vendorChildAgentsEligible()) {
          this.replaceChildAgents(markChildAgentsObtainFailed(this.childAgents));
        }
        if (this.vendorBrowserWorkEligible()) {
          this.replaceBrowserWork(markBrowserObtainFailed(this.browserWork));
        }
        if (this.vendorMcpEligible()) {
          this.replaceMcpServers(markMcpObtainFailed(this.mcpServers));
        }
        if (this.vendorHooksEligible()) {
          this.replaceHooks(markHooksObtainFailed(this.hooks));
        }
      }
      throw error;
    }
  }
  async cancelRun(runId: string, clientSessionId: string): Promise<RunSnapshot> {
    const run = this.getRun(runId, clientSessionId);
    if (!run) throw Object.assign(new Error("Run not found"), { code: "run_not_found" });
    if (run.state === "terminal") throw Object.assign(new Error("Run is terminal"), { code: "run_terminal" });
    this.queuedTurnEnd.delete(runId);
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
    if (ownership && run) { await this.runCoordinator.appendOwnedEvent(ownership.runId,{kind:"decision_request",request:{requestId:id,invocationId:pending?.invocationId??id,kind:"permission",status:decision==="deny"?"declined":"accepted",title:pending?.permissionKind==="shell"?"Run shell":"Write file",detail:"",expiresAt:null,policy:run.policy}},"decision_request").catch(()=>undefined); }
    if (ownership) await this.drainQueuedTurnEnd(ownership.runId);
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
    if (ownership) await this.drainQueuedTurnEnd(ownership.runId);
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
      title: planDecisionTitle(nextPlan.proposedMembers, nextPlan.body),
      detail: "",
      expiresAt: null,
      policy: run.policy,
    });
    this.pendingDecisions.delete(requestId);
    const vendorReplied = this.client?.respondPlanExit
      ? await this.client.respondPlanExit(requestId, action === "accept" ? "approved" : "cancelled")
      : false;
    if (vendorReplied) {
      await this.appendPostToolRunState(ownership.runId, "terminal");
      this.broadcastState();
      return status;
    }
    const live = this.runCoordinator.get(ownership.runId);
    if (live && live.state !== "terminal") {
      this.queuedTurnEnd.set(ownership.runId, { terminalKind: "answered", failure: null });
    }
    await this.drainQueuedTurnEnd(ownership.runId);
    this.broadcastState();
    return status;
  }

  private async vendorPlanFileBody(runId: string, sessionId: string): Promise<string | null> {
    let lastPath: string | null = null;
    let lastContent: string | null = null;
    try {
      const replayed = await this.replayRun(runId, sessionId, 0);
      for (const event of replayed.events) {
        if (event.type !== "activity_update" || event.payload.kind !== "activity_update") continue;
        const activity = event.payload.activity;
        const rawPath = typeof activity.path === "string" ? activity.path : "";
        if (!/plan\.md$/i.test(rawPath.replace(/\\/g, "/"))) continue;
        lastPath = rawPath;
        const input = activity.input;
        if (input && typeof input === "object") {
          const rec = input as Record<string, unknown>;
          const content = rec.content ?? rec.new_string ?? rec.body;
          if (typeof content === "string" && content.trim()) lastContent = content;
        }
      }
    } catch {
      /* fall through to disk */
    }
    if (lastContent?.trim()) return lastContent;
    if (lastPath) {
      try {
        const text = await fsPromises.readFile(lastPath, "utf8");
        if (text.trim()) return text;
      } catch {
        /* ignore */
      }
    }
    return null;
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

  private async settlePlanPhase(run: RunSnapshot, terminalKind: TerminalKind, body: string | null, requestId: string = randomUUID()): Promise<void> {
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
        title: planDecisionTitle(record.proposedMembers, record.body),
        detail: record.body ?? "",
        expiresAt: null,
        policy: run.policy,
      },
    }, "decision_request").catch(() => undefined);
  }

  private async appendPostToolRunState(runId: string, lifecycle: "pending" | "terminal"): Promise<void> {
    const run = this.runCoordinator.get(runId);
    if (!run || run.state === "terminal" || run.state === "cancelling") return;
    const journal = async (state: Exclude<RunState, "terminal">, liveness: "provider" | "tool" | "decision") => {
      await this.runCoordinator.appendOwnedEvent(runId, { kind: "run_state", state, liveness }, "run_state").catch(() => undefined);
    };
    if (lifecycle === "pending") {
      await journal("running", "tool");
      return;
    }
    let pendingDecision = false;
    for (const d of this.pendingDecisions.values()) {
      if (d.runId === run.runId && d.status === "pending") { pendingDecision = true; break; }
    }
    if (pendingDecision) {
      const current = this.runCoordinator.get(runId);
      if (current && current.state !== "running" && current.state !== "waiting_for_decision") {
        await journal("running", "decision");
      }
      await journal("waiting_for_decision", "decision");
      return;
    }
    await journal("running", "provider");
  }

  private hasUnansweredAskForRun(runId: string): boolean {
    for (const d of this.pendingDecisions.values()) {
      if (d.runId === runId && d.status === "pending" && !this.isDecisionExpired(d)) return true;
    }
    return false;
  }

  private async drainQueuedTurnEnd(runId: string): Promise<void> {
    if (this.hasUnansweredAskForRun(runId)) return;
    const queued = this.queuedTurnEnd.get(runId);
    if (!queued) return;
    const run = this.runCoordinator.get(runId);
    if (!run || run.state === "terminal" || run.state === "cancelling") {
      this.queuedTurnEnd.delete(runId);
      return;
    }
    this.queuedTurnEnd.delete(runId);
    if (run.executionPhase === "plan" || this.planEngaged) {
      const plan = await this.latestPlanRecord(runId, run.sessionId);
      if (plan?.status !== "accepted" && plan?.status !== "kept_planning" && plan?.status !== "cancelled") {
        await this.settlePlanPhase(run, queued.terminalKind, this.runCoordinator.getAccumulatedAnswer(runId) || null);
      }
    }
    await this.runCoordinator.finalize(runId, queued.terminalKind, null, queued.failure);
    if (this.activeRunId === runId) this.activeRunId = null;
    this.setBusy(false);
    this.releasePlanArmIfIdle();
    this.broadcastState();
  }

  private async mintExecutionOwnerLostIfInFlight(): Promise<void> {
    const runId = this.activeRunId;
    if (!runId) return;
    const run = this.runCoordinator.get(runId);
    this.queuedTurnEnd.delete(runId);
    if (!run || run.state === "terminal") {
      if (this.activeRunId === runId) this.activeRunId = null;
      this.setBusy(false);
      return;
    }
    await this.cancelPendingToolDecisions(runId);
    if (run.executionPhase === "plan") {
      await this.settlePlanPhase(run, "failed", this.runCoordinator.getAccumulatedAnswer(runId) || null);
    }
    await this.runCoordinator.finalize(runId, "failed", null, {
      code: "execution_owner_lost",
      message: "The run ended before a final answer. Your prompt and received output are preserved.",
      retryable: true,
      recoveryAction: "reconnect",
    });
    if (this.activeRunId === runId) this.activeRunId = null;
    this.setBusy(false);
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
