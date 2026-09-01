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
