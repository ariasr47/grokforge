/**
 * Local session busy (Cancel showing / runStartedAt), not host global busy.
 * Another session may be running; this only blocks the session that owns the run.
 */
export function composerSendAdmitted(input: {
  text: string;
  sessionBusy: boolean;
  ownedRunActive: boolean;
  sendInFlight?: boolean;
}): boolean {
  if (!input.text.trim()) return false;
  if (input.sessionBusy || input.ownedRunActive || input.sendInFlight || pageSendInFlight) return false;
  return true;
}

/** Page-level latch: survives App remount; render cannot clobber it. */
let pageSendInFlight = false;

export function beginPageSend(): boolean {
  if (pageSendInFlight) return false;
  pageSendInFlight = true;
  return true;
}

export function endPageSend(): void {
  pageSendInFlight = false;
}

/** Composer Cancel vs Send. Terminal owned runs must not keep Cancel via a stale runStartedAt. */
export function composerChromeBusy(input: {
  activeNonTerminalRun: boolean;
  runStartedAt: number | null;
  ownedAllTerminal: boolean;
}): boolean {
  if (input.activeNonTerminalRun) return true;
  if (input.ownedAllTerminal) return false;
  return input.runStartedAt != null;
}

/** Cancel clicked while send is still admitting must not let the prompt run. */
export function cancelDuringAdmission(input: {
  cancelRequested: boolean;
  admitted: boolean;
}): "continue" | "abort_before_post" | "cancel_admitted_run" {
  if (!input.cancelRequested) return "continue";
  return input.admitted ? "cancel_admitted_run" : "abort_before_post";
}

/**
 * Queue ⇧⏎ (Task 11): while a run is busy, holding a draft is only useful
 * with real text and only while there is something to hold it for. The held
 * text and its "Queued · 1" chip are plain React state in App.tsx (a single
 * slot — queuing again replaces the held draft, it does not accumulate a
 * list); this is only the admission decision.
 */
export function queueAdmitted(input: { text: string; busy: boolean }): boolean {
  return input.busy && Boolean(input.text.trim());
}

/**
 * A held draft is queued against the session it was typed into (see
 * `{ sessionId, text }` in App.tsx). It may only ever flush into that same
 * session — never into whatever session happens to be selected when its
 * run ends, because `sendText` always targets the live selection. True
 * when the queued session is the one currently selected AND that session
 * is idle: either because it just went busy→idle while selected, or
 * because the user switched back to it after it had already finished
 * while they were elsewhere. A different session being selected, or the
 * queued session still being busy, both keep holding the draft.
 */
export function shouldFlushQueue(input: {
  queuedSessionId: string | null;
  currentSessionId: string | null;
  busy: boolean;
}): boolean {
  if (input.queuedSessionId == null) return false;
  if (input.queuedSessionId !== input.currentSessionId) return false;
  return !input.busy;
}
