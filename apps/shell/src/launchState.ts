// F2 — launch state machine: pure phase-line selection (SPEC §4 "Starting
// phases", AC-U2). Kept pure and separate from App.tsx so "no elapsed time
// alone advances a phase, and no phase asserts progress the launcher does
// not supply" is testable without rendering.
import type { DesktopHostStatus, LaunchPhase } from "./api";

export const INITIAL_PHASE_LINE = "Starting Forge…";

/**
 * Binding copy (SPEC §4): `Starting Forge…` -> `Starting the local engine…`
 * -> `Connecting…`. `Almost ready…` is WITHDRAWN — it used to be set on the
 * first `ensure_host` success and was followed by health polls that could
 * all fail, asserting a nearness no launcher signal vouches for.
 *
 * Mapping (AC-U2): each phase line is shown ONLY for the launcher status it
 * maps to; no elapsed time alone advances a phase. A status whose `phase` is
 * not one this table maps returns the CALLER'S OWN previous line unchanged
 * (`previous`) rather than inventing progress.
 */
export function phaseLine(
  status: { phase: LaunchPhase } | null | undefined,
  previous: string,
): string {
  if (!status) return previous;
  if (status.phase === "starting") return "Starting the local engine…";
  if (status.phase === "ready") return "Connecting…";
  // "failed" carries no phase line of its own — the failure card (F3) takes
  // over rendering entirely once boot resolves to "error".
  return previous;
}

/** Slow-start line at ~8s, exactly this and nothing more (SPEC §4): no
 *  "this takes longer the first time" — no launcher signal vouches for a
 *  first-run phase. */
export const SLOW_START_LINE = "Still starting.";
export const SLOW_START_MS = 8_000;

/** The diagnostics action reveals itself at ~20s, spinner still running. */
export const DIAGNOSTICS_REVEAL_MS = 20_000;

/** True once a status resolved to a terminal, ready engine. */
export function isLaunchReady(status: DesktopHostStatus): boolean {
  return status.ok && status.phase === "ready";
}
