export type RunState = "admitted" | "running" | "waiting_for_decision" | "recovering" | "cancelling" | "terminal";
export type TerminalKind = "answered" | "failed" | "cancelled";
export type RecoveryAction = "retry_prompt" | "open_settings" | "reconnect" | "export_diagnostics" | null;
export type ExecutionPhase = "plan" | "execute";
export type PlanProposedMember = { summary: string; path: string | null };
export type PlanRecordStatus =
  | "exploring"
  | "ready"
  | "accepted"
  | "kept_planning"
  | "superseded"
  | "cancelled"
  | "failed";
export type PlanRecord = {
  runId: string;
  sessionId: string;
  connectionGeneration: number;
  status: PlanRecordStatus;
  body: string | null;
  proposedMembers: PlanProposedMember[];
  policy: Record<string, unknown>;
  executionPhase: "plan";
};

export type ProjectInstructionsInclusion = "included" | "not_included" | "failed";

export type ProjectInstructionsTurnVoucher = {
  runId: string;
  sessionId: string;
  connectionGeneration: number;
  inclusion: ProjectInstructionsInclusion;
  path: string | null;
};

export type ChatPackInclusion =
  | "included"
  | "not_included"
  | "materialization_fault"
  | "unconfirmed"
  | "confirm_failed";
export type ChatPackFault = "path" | "over_cap" | null;
export type ChatPackTurnVoucher = {
  runId: string;
  sessionId: string;
  conversationId: string;
  connectionGeneration: number;
  inclusion: ChatPackInclusion;
  fault: ChatPackFault;
  files: Array<{ path: string }>;
  noteIncluded: boolean;
};

/** Immutable post-live stamp on an owned Code run. Null on Chat / until live. */
export type CodeRunAgentProvenance = {
  identity: "vendor" | "fallback" | "house";
  fallbackReason: "cli_missing" | "spawn_failed" | null;
};

/** Host-vouched armed `/name` delivery. Null on Chat / until send settlement. */
export type SkillHandoffProvenance = {
  kind: "consumed" | "none";
  name: string | null;
};

/** Host failure.code values the shell consumes. `agent_exited` is post-live child death. */
export type FailureCode =
  | "missing_final_answer"
  | "provider_unavailable"
  | "provider_liveness_exhausted"
  | "execution_owner_lost"
  | "agent_exited"
  | "interrupted"
  | "journal_unavailable"
  | "configuration_required"
  | "authentication_required"
  | "edit_conflict"
  | "internal_error";

export interface RunSnapshot {
  sessionId: string; runId: string; connectionGeneration: number; state: RunState;
  acceptedPrompt: string; admittedAt: string; updatedAt: string; lastEventSeq: number;
  policy: Record<string, unknown>; model: Record<string, unknown>;
  terminalKind: TerminalKind | null; finalAnswer: string | null; answerVouched: boolean;
  failure: { code: string; message: string; retryable: boolean; recoveryAction: RecoveryAction } | null;
  /** Snapshotted at admit. Missing on old journals is treated as execute for non-plan UI. */
  executionPhase?: ExecutionPhase;
  /**
   * Post-live Code-agent stamp. Missing on old journals → null (never invent
   * vendor from agentName). Explicit null overwrites a prior stamp.
   */
  codeAgentProvenance?: CodeRunAgentProvenance | null;
  /**
   * Post-send Code handoff stamp. Missing on old journals → null (never invent
   * consumed). Explicit null overwrites a prior stamp.
   */
  skillHandoffProvenance?: SkillHandoffProvenance | null;
}
export interface DecisionRequest { requestId: string; invocationId: string; kind: "permission" | "diff" | "recovery_confirmation" | "plan"; status: "pending" | "accepted" | "declined" | "expired" | "kept_planning" | "cancelled"; title: string; detail: string; expiresAt: string | null; policy: Record<string, unknown>; }
export type MutationKind = "content" | "delete" | "rename";
export interface ActivityRecord {
  activityId: string;
  invocationId: string;
  name: string;
  lifecycle: "pending" | "terminal";
  execution: "executed" | "not_executed" | null;
  status: "running" | "succeeded" | "failed" | "rejected";
  input: unknown;
  output: unknown | null;
  error: string | null;
  diff: string | null;
  path: string | null;
  /** Host-vouched mutation kind. Null/absent for non-members and legacy content. Never inferred from tool name. */
  kind?: MutationKind | null;
  fromPath?: string | null;
  toPath?: string | null;
  policy: Record<string, unknown>;
  automaticEligibility: string;
  autoApplied: boolean;
  command: string | null;
  editId: string | null;
  recovery: { kind: "guarded_revert"; available: boolean; status: "available" | "pending" | "reverted" | "conflict" | "failed" } | null;
  /** Mapped from child tool_run.summary when present. Null when omitted. */
  summary?: string | null;
  /** Optional child/event title when present. Null when omitted. */
  title?: string | null;
  /** Preserved public ACP ToolKind. Elevation requires literal "fetch". */
  acpToolKind?: string | null;
  /** Vouched URL from named vendor keys — never invent. */
  url?: string | null;
  /** Caption-only snapshot signal (v1). */
  snapshotJournaled?: boolean;
}

function nonemptyPath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function vouchedMutationKind(value: unknown): MutationKind | null {
  return value === "content" || value === "delete" || value === "rename" ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeActivity(incoming: ActivityRecord): ActivityRecord {
  return {
    ...incoming,
    command: incoming.command ?? null,
    path: nonemptyPath(incoming.path),
    kind: vouchedMutationKind(incoming.kind),
    fromPath: nonemptyPath(incoming.fromPath),
    toPath: nonemptyPath(incoming.toPath),
    summary: nullableString(incoming.summary),
    title: nullableString(incoming.title),
    acpToolKind:
      incoming.acpToolKind === null || typeof incoming.acpToolKind === "string"
        ? incoming.acpToolKind
        : null,
    url: nullableString(incoming.url),
    snapshotJournaled: incoming.snapshotJournaled === true,
  };
}
export type ChildAgentStatus = "running" | "done" | "failed";

export type RunChildAgentMember = {
  childId: string;
  identityLabel: string;
  status: ChildAgentStatus;
  firstEventSeq: number;
};

/** Real prompt-token count the provider reported, plus whatever context
 *  window the model catalog has sourced for the active model — null when
 *  the catalog has no real published number. House/guest rule: neither
 *  field is ever estimated. */
export type UsageVoucher = { promptTokens: number; contextWindow: number | null };

export type RunEventPayload =
  | { kind: "run_started"; run: RunSnapshot }
  | { kind: "run_state"; state: Exclude<RunState, "terminal">; liveness: string | null }
  | { kind: "reasoning_delta"; segmentId: string; delta: string }
  | { kind: "answer_delta"; segmentId: string; delta: string }
  | { kind: "message_delta"; segmentId: string; delta: string }
  | { kind: "activity_update"; activity: ActivityRecord }
  | { kind: "decision_request"; request: DecisionRequest }
  | { kind: "plan_record"; plan: PlanRecord }
  | { kind: "project_instructions"; projectInstructions: ProjectInstructionsTurnVoucher }
  | { kind: "chat_pack"; chatPack: ChatPackTurnVoucher }
  | { kind: "child_agent_update"; childId: string; identityLabel: string; status: ChildAgentStatus }
  | ({ kind: "usage" } & UsageVoucher)
  | { kind: "run_terminal"; terminalKind: TerminalKind; finalAnswer: string | null; answerVouched: boolean; failure: RunSnapshot["failure"]; terminalAt: string };
export interface RunEventEnvelope { schemaVersion: 1; type: RunEventPayload["kind"]; sessionId: string; runId: string; eventSeq: number; connectionGeneration: number; occurredAt: string; payload: RunEventPayload; }
/** Token-storm kinds. Reduce immediately; paint at most once per frame. */
export function isRunStreamDelta(kind: RunEventPayload["kind"]): boolean {
  return kind === "answer_delta" || kind === "reasoning_delta" || kind === "message_delta";
}
/** Host may append these after run_terminal (plan Accept, child finish). */
export const POST_TERMINAL_EVENT_TYPES = ["child_agent_update", "decision_request", "plan_record"] as const;
export function isPostTerminalEventType(type: string): boolean {
  return (POST_TERMINAL_EVENT_TYPES as readonly string[]).includes(type);
}

/** Host journals Revert after run_terminal. Dropping it re-offers Revert on reload. */
export function isPostTerminalRecoveryUpdate(run: RunProjectionRun, event: RunEventEnvelope): boolean {
  if (event.type !== "activity_update" || event.payload.kind !== "activity_update") return false;
  const incoming = event.payload.activity;
  if (!run.activities[incoming.activityId]) return false;
  const status = incoming.recovery?.status;
  return status === "reverted" || status === "conflict" || status === "failed" || status === "pending";
}
export interface RunProjection {
  runsById: Record<string, RunProjectionRun>; runOrder: string[]; sessionCursors: Record<string, number>;
}
export type RunProjectionState = RunProjection;
export type LiveContentKind = "thought" | "message" | "tool";
export interface RunProjectionRun extends RunSnapshot {
  reasoning: Record<string, string>;
  answer: Record<string, string>;
  /** Mid-turn narration from message_delta. Distinct from thought and vouched Answer. */
  message: Record<string, string>;
  activities: Record<string, ActivityRecord>;
  decisions: Record<string, DecisionRequest>;
  seenEventSeq: Set<number>; terminalEventSeq: number | null; lastEventSeq: number;
  plan?: PlanRecord | null;
  projectInstructions?: ProjectInstructionsTurnVoucher | null;
  chatPack?: ChatPackTurnVoucher | null;
  /** Latest real usage the engine reported for this run. Null/absent until
   *  the first model response with usage lands — never fabricated. */
  usage?: UsageVoucher | null;
  /** Last journaled run_state.liveness. Shell-derive only — not a new wire field. */
  liveness?: string | null;
  /** Newest applied live content kind. Shell-derive only — not a run_state payload slot. */
  lastContentKind?: LiveContentKind | null;
  /** True after a terminal tool + journaled {state:running, liveness:provider} until newer live content. */
  postToolProviderWait?: boolean;
  /** Identity-keyed child-work fold. Empty by default — never invent members. */
  childAgents?: Record<string, RunChildAgentMember>;
}

function emptyStores(): Pick<RunProjectionRun, "reasoning" | "answer" | "message" | "activities" | "decisions" | "liveness" | "lastContentKind" | "postToolProviderWait" | "childAgents"> {
  return {
    reasoning: {},
    answer: {},
    message: {},
    activities: {},
    decisions: {},
    liveness: null,
    lastContentKind: null,
    postToolProviderWait: false,
    childAgents: {},
  };
}
export function initialRunProjection(): RunProjection { return { runsById: {}, runOrder: [], sessionCursors: {} }; }
/** Admit the host snapshot without manufacturing an event sequence. The
 * snapshot is authoritative identity/state, while the journal events remain
 * the only source of cursor advancement. This matters when a fast host emits
 * run_started/terminal frames before POST /api/prompt resolves. */
function snapshotProvenance(
  snapshot: RunSnapshot,
  existing: RunProjectionRun | undefined,
): CodeRunAgentProvenance | null {
  if ("codeAgentProvenance" in snapshot) return snapshot.codeAgentProvenance ?? null;
  return existing?.codeAgentProvenance ?? null;
}

function snapshotSkillHandoffProvenance(
  snapshot: RunSnapshot,
  existing: RunProjectionRun | undefined,
): SkillHandoffProvenance | null {
  if ("skillHandoffProvenance" in snapshot) return snapshot.skillHandoffProvenance ?? null;
  return existing?.skillHandoffProvenance ?? null;
}

export function mergeRunSnapshot(state: RunProjection, snapshot: RunSnapshot): RunProjection {
  const existing = state.runsById[snapshot.runId];
  if (existing && (existing.sessionId !== snapshot.sessionId || existing.connectionGeneration !== snapshot.connectionGeneration)) return state;
  // A late admission response must never downgrade an already terminal run;
  // terminal journal truth and its accumulated audit projection win.
  // Fast WS terminal can beat POST /api/prompt: still accept a late stamp when
  // the terminal projection has none (do not invent; do not rewrite a stamp).
  if (existing?.state === "terminal") {
    const stamped = snapshotProvenance(snapshot, existing);
    const handoff = snapshotSkillHandoffProvenance(snapshot, existing);
    if (
      stamped === existing.codeAgentProvenance &&
      handoff === existing.skillHandoffProvenance
    ) {
      return state;
    }
    if (!existing.codeAgentProvenance && !existing.skillHandoffProvenance && !stamped && !handoff) {
      return state;
    }
    if (existing.codeAgentProvenance && existing.skillHandoffProvenance) return state;
    return {
      ...state,
      runsById: {
        ...state.runsById,
        [snapshot.runId]: {
          ...existing,
          codeAgentProvenance: existing.codeAgentProvenance ?? stamped,
          skillHandoffProvenance: existing.skillHandoffProvenance ?? handoff,
        },
      },
    };
  }
  const codeAgentProvenance = snapshotProvenance(snapshot, existing);
  const skillHandoffProvenance = snapshotSkillHandoffProvenance(snapshot, existing);
  const run: RunProjectionRun = existing
    ? { ...cloneRun(existing), ...snapshot, lastEventSeq: existing.lastEventSeq, plan: existing.plan, projectInstructions: existing.projectInstructions, chatPack: existing.chatPack, usage: existing.usage, codeAgentProvenance, skillHandoffProvenance }
    : { ...snapshot, ...emptyStores(), seenEventSeq: new Set(), terminalEventSeq: snapshot.state === "terminal" ? snapshot.lastEventSeq || null : null, lastEventSeq: 0, plan: null, projectInstructions: null, chatPack: null, usage: null, codeAgentProvenance, skillHandoffProvenance };
  return {
    runsById: { ...state.runsById, [snapshot.runId]: run },
    runOrder: state.runOrder.includes(snapshot.runId) ? state.runOrder : [...state.runOrder, snapshot.runId],
    sessionCursors: { ...state.sessionCursors },
  };
}
function cloneRun(r: RunProjectionRun): RunProjectionRun {
  return {
    ...r,
    reasoning: { ...r.reasoning },
    answer: { ...r.answer },
    message: { ...(r.message ?? {}) },
    activities: { ...r.activities },
    decisions: { ...r.decisions },
    seenEventSeq: new Set(r.seenEventSeq),
    plan: r.plan,
    projectInstructions: r.projectInstructions ?? null,
    chatPack: r.chatPack ?? null,
    usage: r.usage ?? null,
    liveness: r.liveness ?? null,
    lastContentKind: r.lastContentKind ?? null,
    postToolProviderWait: Boolean(r.postToolProviderWait),
    codeAgentProvenance: r.codeAgentProvenance ?? null,
    skillHandoffProvenance: r.skillHandoffProvenance ?? null,
    childAgents: { ...(r.childAgents ?? {}) },
  };
}
export function reduceRunEvent(state: RunProjection, event: RunEventEnvelope): RunProjection {
  if (event.schemaVersion !== 1 || event.payload.kind !== event.type || !event.sessionId || !event.runId || event.eventSeq < 1) return state;
  const existing = state.runsById[event.runId];
  if (existing && (existing.sessionId !== event.sessionId || existing.connectionGeneration !== event.connectionGeneration)) return state;
  if (existing?.seenEventSeq.has(event.eventSeq)) return state;
  if (existing?.terminalEventSeq != null && event.eventSeq > existing.terminalEventSeq) {
    // Host appends plan Accept and Revert stamps after run_terminal.
    if (!isPostTerminalEventType(event.type) && !isPostTerminalRecoveryUpdate(existing, event)) return state;
  }
  if (existing && event.eventSeq <= existing.lastEventSeq) return state;
  let run: RunProjectionRun;
  if (!existing) {
    if (event.type !== "run_started") return state;
    const snap = (event.payload as Extract<RunEventPayload, { kind: "run_started" }>).run;
    run = { ...snap, ...emptyStores(), seenEventSeq: new Set(), terminalEventSeq: null, lastEventSeq: 0, plan: null, projectInstructions: null, chatPack: null, usage: null, codeAgentProvenance: snap.codeAgentProvenance ?? null, skillHandoffProvenance: snap.skillHandoffProvenance ?? null };
  } else run = cloneRun(existing);
  run.seenEventSeq.add(event.eventSeq); run.lastEventSeq = event.eventSeq;
  switch (event.payload.kind) {
    case "run_started": {
      const incoming = event.payload.run;
      run = {
        ...run,
        ...incoming,
        message: run.message ?? {},
        codeAgentProvenance: "codeAgentProvenance" in incoming
          ? incoming.codeAgentProvenance ?? null
          : run.codeAgentProvenance ?? null,
        skillHandoffProvenance: "skillHandoffProvenance" in incoming
          ? incoming.skillHandoffProvenance ?? null
          : run.skillHandoffProvenance ?? null,
      };
      break;
    }
    case "run_state": {
      run.state = event.payload.state;
      run.liveness = event.payload.liveness;
      if (event.payload.liveness === "provider" && event.payload.state === "running") {
        const activities = Object.values(run.activities);
        const pending = activities.some((a) => a.lifecycle === "pending");
        const hasTerminalTool = activities.some((a) => a.lifecycle === "terminal");
        run.postToolProviderWait = !pending && hasTerminalTool;
      } else if (event.payload.liveness === "tool" || event.payload.liveness === "decision") {
        run.postToolProviderWait = false;
      }
      break;
    }
    case "reasoning_delta":
      if (event.payload.delta) {
        const prev = run.reasoning[event.payload.segmentId] ?? "";
        // After a tool, the next thinking burst is a new paragraph — live G5
        // journaled "." then write_file then "Now" as "top.Now".
        const glue =
          prev &&
          run.lastContentKind === "tool" &&
          !/\s$/.test(prev) &&
          !/^\s/.test(event.payload.delta)
            ? "\n"
            : "";
        run.reasoning[event.payload.segmentId] = prev + glue + event.payload.delta;
        run.lastContentKind = "thought";
        run.postToolProviderWait = false;
      }
      break;
    case "answer_delta":
      if (event.payload.delta) run.answer[event.payload.segmentId] = (run.answer[event.payload.segmentId] ?? "") + event.payload.delta;
      break;
    case "message_delta":
      if (event.payload.delta) {
        run.message[event.payload.segmentId] = (run.message[event.payload.segmentId] ?? "") + event.payload.delta;
        run.lastContentKind = "message";
        run.postToolProviderWait = false;
      }
      break;
    case "activity_update": {
      const incoming = event.payload.activity;
      run.activities[incoming.activityId] = normalizeActivity(incoming);
      run.lastContentKind = "tool";
      if (incoming.lifecycle === "pending") {
        run.postToolProviderWait = false;
      }
      break;
    }
    case "decision_request": {
      const incoming = event.payload.request;
      const prev = run.decisions[incoming.requestId];
      // Host settle/cancel frames reuse the id with a generic title and empty
      // detail. Keep the first specific title/detail so the run surface still
      // names the class (Run shell / Edit file) after the run is terminal.
      const blankIncomingDetail = !incoming.detail;
      run.decisions[incoming.requestId] = {
        ...prev,
        ...incoming,
        title: prev?.title && blankIncomingDetail ? prev.title : incoming.title,
        detail: blankIncomingDetail && prev?.detail ? prev.detail : incoming.detail,
      };
      break;
    }
    case "plan_record": run.plan = event.payload.plan; break;
    case "project_instructions":
      if (event.type === "project_instructions" && event.payload.kind === "project_instructions") {
        run.projectInstructions = event.payload.projectInstructions;
      }
      break;
    case "chat_pack":
      if (event.type === "chat_pack" && event.payload.kind === "chat_pack") {
        run.chatPack = event.payload.chatPack;
      }
      break;
    case "usage":
      if (event.type === "usage" && event.payload.kind === "usage") {
        run.usage = { promptTokens: event.payload.promptTokens, contextWindow: event.payload.contextWindow };
      }
      break;
    case "child_agent_update": {
      const { childId, identityLabel, status } = event.payload;
      if (!childId || !identityLabel.trim() || (status !== "running" && status !== "done" && status !== "failed")) break;
      if (!run.childAgents) run.childAgents = {};
      const prev = run.childAgents[childId];
      run.childAgents[childId] = {
        childId,
        identityLabel,
        status,
        firstEventSeq: prev?.firstEventSeq ?? event.eventSeq,
      };
      break;
    }
    case "run_terminal":
      run.state = "terminal"; run.terminalKind = event.payload.terminalKind; run.failure = event.payload.failure;
      run.answerVouched = event.payload.answerVouched;
      run.finalAnswer = event.payload.terminalKind === "answered" && event.payload.answerVouched && event.payload.finalAnswer?.trim() ? event.payload.finalAnswer : null;
      run.terminalEventSeq = event.eventSeq;
      run.postToolProviderWait = false;
      break;
  }
  const runsById = { ...state.runsById, [event.runId]: run };
  const runOrder = state.runOrder.includes(event.runId) ? state.runOrder : [...state.runOrder, event.runId];
  const sessionCursors = { ...state.sessionCursors, [event.sessionId]: Math.max(state.sessionCursors[event.sessionId] ?? 0, event.eventSeq) };
  return { runsById, runOrder, sessionCursors };
}
export function reduceRunEvents(state: RunProjection, events: RunEventEnvelope[]): RunProjection { return events.reduce(reduceRunEvent, state); }

export function persistableRunProjection(state: RunProjection): unknown {
  return { runs: state.runOrder.map((id) => state.runsById[id]).filter(Boolean).map((run) => ({ ...run, seenEventSeq: [...run.seenEventSeq] })), cursors: state.sessionCursors };
}
export function restoreRunProjection(raw: unknown): RunProjection {
  if (!raw || typeof raw !== "object") return initialRunProjection();
  const value = raw as { runs?: unknown[]; cursors?: Record<string, number> };
  const runsById: Record<string, RunProjectionRun> = {};
  const runOrder: string[] = [];
  for (const item of value.runs ?? []) {
    if (!item || typeof item !== "object") continue;
    const run = item as RunProjectionRun & { seenEventSeq?: unknown };
    if (!run.runId || !run.sessionId) continue;
    const activities: Record<string, ActivityRecord> = {};
    for (const [activityId, activity] of Object.entries(run.activities ?? {})) {
      if (!activity || typeof activity !== "object") continue;
      activities[activityId] = normalizeActivity(activity);
    }
    runsById[run.runId] = {
      ...run,
      reasoning: run.reasoning ?? {},
      answer: run.answer ?? {},
      message: run.message ?? {},
      activities,
      plan: run.plan ?? null,
      projectInstructions: run.projectInstructions ?? null,
      chatPack: run.chatPack ?? null,
      usage: run.usage ?? null,
      codeAgentProvenance: run.codeAgentProvenance ?? null,
      skillHandoffProvenance: run.skillHandoffProvenance ?? null,
      liveness: run.liveness ?? null,
      lastContentKind: run.lastContentKind ?? null,
      postToolProviderWait: Boolean(run.postToolProviderWait),
      childAgents: run.childAgents ?? {},
      seenEventSeq: new Set(Array.isArray(run.seenEventSeq) ? run.seenEventSeq.filter((n): n is number => typeof n === "number") : []),
    };
    runOrder.push(run.runId);
  }
  return { runsById, runOrder, sessionCursors: value.cursors ?? {} };
}

/**
 * Every run's vouched final answer, keyed by runId. This is the exact
 * notion of "the reply" promptSendHistory.ts's foldRunAnswersIntoHistory
 * already relies on to fold a v1 run's answer into follow-up history
 * (useComposerSend.ts builds an identical runId -> answer map inline at
 * send time) — factored out here so another caller (Home's chat-home
 * preview) can reuse the same rule instead of inventing a second one for
 * what counts as a real reply. A run with no terminal event yet, a
 * terminal event that isn't `answered`, or an unvouched/empty answer
 * simply has no entry — callers degrade by falling back to whatever they
 * showed before a run existed.
 */
export function vouchedAnswersByRunId(projection: RunProjection): Record<string, string> {
  const out: Record<string, string> = {};
  for (const run of Object.values(projection.runsById)) {
    if (run.answerVouched && run.finalAnswer?.trim()) out[run.runId] = run.finalAnswer;
  }
  return out;
}
