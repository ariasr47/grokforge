/** Dock / gate chrome copy. Host grants last until the folder changes. */
export const SETTLE_CARD_BELOW = "Settle the card below";
export const SETTLE_IN_DOCK = "Settle this in the card below.";

// Shell tier (amber) — Grok wants to run a shell command.
export const GATE_SHELL_TITLE = "Grok wants to run a command";
export const GATE_SHELL_POLICY = "Review policy · asks before shell";
export const GATE_EDIT_COMMAND = "Edit command";

// Write tier (amber) — Grok wants to write a file.
export const GATE_WRITE_TITLE = "Grok wants to write a file";
export const GATE_WRITE_POLICY = "Review policy · asks before write";
export const GATE_TRUST_FOLDER = "Trust this folder";

// Shared permission (shell/write) actions.
export const GATE_ALLOW = "Allow";
export const GATE_ALLOW_SESSION_FALLBACK = "Allow for this session";
export const GATE_DENY = "Deny";

/** S action label — the matched trusted command class, or the generic fallback. */
export function gateAllowSessionLabel(classLabel: string | null): string {
  return classLabel ? `Allow ${classLabel} for this session` : GATE_ALLOW_SESSION_FALLBACK;
}

// Plan tier (violet) — Grok proposes a plan before editing.
export const GATE_PLAN_POLICY = "Plan · no edits applied";
export const PLAN_DOCK_EMPTY = "Plan complete · no changes";
export const PLAN_END_EMPTY = "End Plan · no changes proposed";
export const PLAN_ACCEPT = "Accept plan";
export const PLAN_KEEP = "Keep planning";
export const PLAN_SETTLING = "Updating plan decision…";
export const PLAN_DECISION_FAILURE =
  "Couldn’t record that plan decision. The proposal is unchanged.";

/** Ready-plan headline — the one dynamic gate title (member count varies). */
export function planReadyTitle(memberCount: number): string {
  return `Plan ready · ${memberCount} file${memberCount === 1 ? "" : "s"} would change`;
}

// Ask tier (cyan) — a recovery_confirmation-style question with numbered options.
export const GATE_ASK_TITLE = "Grok has a question";
export const GATE_ASK_POLICY = "blocks the run until answered";
export const GATE_ASK_ELSE = "Ask something else";

export type LiveRevealPlan = "keep-end" | "show-header" | "skip";

/** At the live end, keep following the bottom. Do not jump to the first tool header. */
export function planLiveActivityReveal(
  atLiveEnd: boolean,
  hasHeader: boolean,
): LiveRevealPlan {
  if (atLiveEnd) return "keep-end";
  if (hasHeader) return "show-header";
  return "skip";
}
