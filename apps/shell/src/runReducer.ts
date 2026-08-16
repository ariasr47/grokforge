export type RunState = "admitted" | "running" | "waiting_for_decision" | "recovering" | "cancelling" | "terminal";
export type TerminalKind = "answered" | "failed" | "cancelled";
export type RecoveryAction = "retry_prompt" | "open_settings" | "reconnect" | "export_diagnostics" | null;

export interface RunSnapshot {
  sessionId: string; runId: string; connectionGeneration: number; state: RunState;
  acceptedPrompt: string; admittedAt: string; updatedAt: string; lastEventSeq: number;
  policy: Record<string, unknown>; model: Record<string, unknown>;
  terminalKind: TerminalKind | null; finalAnswer: string | null; answerVouched: boolean;
  failure: { code: string; message: string; retryable: boolean; recoveryAction: RecoveryAction } | null;
}
export interface DecisionRequest { requestId: string; invocationId: string; kind: "permission" | "diff" | "recovery_confirmation"; status: "pending" | "accepted" | "declined" | "expired"; title: string; detail: string; expiresAt: string | null; policy: Record<string, unknown>; }
export interface ActivityRecord { activityId: string; invocationId: string; name: string; lifecycle: "pending" | "terminal"; execution: "executed" | "not_executed" | null; status: "running" | "succeeded" | "failed" | "rejected"; input: unknown; output: unknown | null; error: string | null; diff: string | null; policy: Record<string, unknown>; automaticEligibility: string; autoApplied: boolean; editId: string | null; recovery: { kind: "guarded_revert"; available: boolean; status: "available" | "pending" | "reverted" | "conflict" | "failed" } | null; }
export type RunEventPayload =
  | { kind: "run_started"; run: RunSnapshot }
  | { kind: "run_state"; state: Exclude<RunState, "terminal">; liveness: string | null }
  | { kind: "reasoning_delta"; segmentId: string; delta: string }
  | { kind: "answer_delta"; segmentId: string; delta: string }
  | { kind: "activity_update"; activity: ActivityRecord }
  | { kind: "decision_request"; request: DecisionRequest }
  | { kind: "run_terminal"; terminalKind: TerminalKind; finalAnswer: string | null; answerVouched: boolean; failure: RunSnapshot["failure"]; terminalAt: string };
export interface RunEventEnvelope { schemaVersion: 1; type: RunEventPayload["kind"]; sessionId: string; runId: string; eventSeq: number; connectionGeneration: number; occurredAt: string; payload: RunEventPayload; }
export interface RunProjection {
  runsById: Record<string, RunProjectionRun>; runOrder: string[]; sessionCursors: Record<string, number>;
}
export type RunProjectionState = RunProjection;
export interface RunProjectionRun extends RunSnapshot {
  reasoning: Record<string, string>; answer: Record<string, string>; activities: Record<string, ActivityRecord>; decisions: Record<string, DecisionRequest>;
  seenEventSeq: Set<number>; terminalEventSeq: number | null; lastEventSeq: number;
}
export function initialRunProjection(): RunProjection { return { runsById: {}, runOrder: [], sessionCursors: {} }; }
/** Admit the host snapshot without manufacturing an event sequence. The
 * snapshot is authoritative identity/state, while the journal events remain
 * the only source of cursor advancement. This matters when a fast host emits
 * run_started/terminal frames before POST /api/prompt resolves. */
export function mergeRunSnapshot(state: RunProjection, snapshot: RunSnapshot): RunProjection {
  const existing = state.runsById[snapshot.runId];
  if (existing && (existing.sessionId !== snapshot.sessionId || existing.connectionGeneration !== snapshot.connectionGeneration)) return state;
  // A late admission response must never downgrade an already terminal run;
  // terminal journal truth and its accumulated audit projection win.
  if (existing?.state === "terminal") return state;
  const run: RunProjectionRun = existing
    ? { ...cloneRun(existing), ...snapshot, lastEventSeq: existing.lastEventSeq }
    : { ...snapshot, reasoning: {}, answer: {}, activities: {}, decisions: {}, seenEventSeq: new Set(), terminalEventSeq: snapshot.state === "terminal" ? snapshot.lastEventSeq || null : null, lastEventSeq: 0 };
  return {
    runsById: { ...state.runsById, [snapshot.runId]: run },
    runOrder: state.runOrder.includes(snapshot.runId) ? state.runOrder : [...state.runOrder, snapshot.runId],
    sessionCursors: { ...state.sessionCursors },
  };
}
function cloneRun(r: RunProjectionRun): RunProjectionRun { return { ...r, reasoning: { ...r.reasoning }, answer: { ...r.answer }, activities: { ...r.activities }, decisions: { ...r.decisions }, seenEventSeq: new Set(r.seenEventSeq) }; }
export function reduceRunEvent(state: RunProjection, event: RunEventEnvelope): RunProjection {
  if (event.schemaVersion !== 1 || event.payload.kind !== event.type || !event.sessionId || !event.runId || event.eventSeq < 1) return state;
  const existing = state.runsById[event.runId];
  if (existing && (existing.sessionId !== event.sessionId || existing.connectionGeneration !== event.connectionGeneration)) return state;
  if (existing?.seenEventSeq.has(event.eventSeq)) return state;
  if (existing?.terminalEventSeq != null && event.eventSeq > existing.terminalEventSeq) return state;
  if (existing && event.eventSeq <= existing.lastEventSeq) return state;
  let run: RunProjectionRun;
  if (!existing) {
    if (event.type !== "run_started") return state;
    const snap = (event.payload as Extract<RunEventPayload, { kind: "run_started" }>).run;
    run = { ...snap, reasoning: {}, answer: {}, activities: {}, decisions: {}, seenEventSeq: new Set(), terminalEventSeq: null, lastEventSeq: 0 };
  } else run = cloneRun(existing);
  run.seenEventSeq.add(event.eventSeq); run.lastEventSeq = event.eventSeq;
  switch (event.payload.kind) {
    case "run_started": run = { ...run, ...event.payload.run }; break;
    case "run_state": run.state = event.payload.state; break;
    case "reasoning_delta": if (event.payload.delta) run.reasoning[event.payload.segmentId] = (run.reasoning[event.payload.segmentId] ?? "") + event.payload.delta; break;
    case "answer_delta": if (event.payload.delta) run.answer[event.payload.segmentId] = (run.answer[event.payload.segmentId] ?? "") + event.payload.delta; break;
    case "activity_update": run.activities[event.payload.activity.activityId] = event.payload.activity; break;
    case "decision_request": run.decisions[event.payload.request.requestId] = event.payload.request; break;
    case "run_terminal":
      run.state = "terminal"; run.terminalKind = event.payload.terminalKind; run.failure = event.payload.failure;
      run.answerVouched = event.payload.answerVouched;
      run.finalAnswer = event.payload.terminalKind === "answered" && event.payload.answerVouched && event.payload.finalAnswer?.trim() ? event.payload.finalAnswer : null;
      run.terminalEventSeq = event.eventSeq; break;
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
    runsById[run.runId] = { ...run, seenEventSeq: new Set(Array.isArray(run.seenEventSeq) ? run.seenEventSeq.filter((n): n is number => typeof n === "number") : []) };
    runOrder.push(run.runId);
  }
  return { runsById, runOrder, sessionCursors: value.cursors ?? {} };
}
