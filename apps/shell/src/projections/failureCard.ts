// F3 — the six failure cards and the class -> card mapping (SPEC §5). The
// mapping is SPEC §5's table verbatim and is NOT a design choice: it is
// implemented as a pure function so it is testable without rendering
// (spire-tech-contract-consume: only react to reason/osError, never invent a
// cause the launcher did not supply).
import type { LaunchReason } from "../lib/api";

export type CardId =
  | "neutral"
  | "engine-stopped"
  | "no-connection"
  | "missing-file"
  | "windows-blocked"
  | "refused-copy";

export interface FailureStatus {
  reason: LaunchReason | null;
  osError: number | null;
}

/**
 * SPEC §5. Governing integrity rule: a cause-named card renders ONLY when
 * the launcher supplies that reason code AND the sub-signal that card is
 * keyed on. Otherwise the neutral card ships — one vague-but-true card beats
 * five confident ones of which two are guesses.
 */
export function cardFor(status: FailureStatus): CardId {
  switch (status.reason) {
    case "entry_missing":
      return "missing-file";
    case "runtime_missing":
      if (status.osError === 2 || status.osError === 3) return "missing-file";
      if ([5, 225, 226, 740].includes(status.osError ?? -1)) return "windows-blocked";
      return "neutral"; // unclassified OS error (row 4)
    case "crashed":
      return "engine-stopped";
    case "health_timeout":
      return "neutral";
    case "port_unavailable":
      return "no-connection";
    case "origin_refused":
      return "refused-copy";
    case "foreign_host":
      return "neutral"; // row 9: unreachable in prod; an invariant break if it ever fires
    case "unknown":
    case null:
    default:
      return "neutral";
  }
}

export interface CardCopy {
  headline: string;
  body: string;
  /** Rendered in this order: primary first, secondary (if any) second. */
  primaryAction: "try-again" | "save-diagnostics";
  secondaryAction: "try-again" | "save-diagnostics" | null;
  /** AC-U5: card 6 (refused-copy) must render NO Try again at all — the
   *  allowlist is a compile-time constant against a frozen origin, so retry
   *  is provably futile. */
  retryOffered: boolean;
}

/** Card copy verbatim from SPEC.md §5 "Card copy" (1-6). Do not paraphrase —
 *  the copy carries withdrawn claims (no nodejs.org, no "Try again" on card
 *  6, no security-software attribution on card 5) that must stay withdrawn. */
export const CARD_COPY: Record<CardId, CardCopy> = {
  neutral: {
    headline: "Forge couldn't reach its engine.",
    body:
      "Forge starts a small program on this PC to talk to Grok. It didn't answer this time. " +
      "Try again — if it keeps happening, save a troubleshooting file and send it to whoever set Forge up.",
    primaryAction: "try-again",
    secondaryAction: "save-diagnostics",
    retryOffered: true,
  },
  "engine-stopped": {
    headline: "Forge's engine stopped right after starting.",
    body: "Try again. If it keeps stopping, save a troubleshooting file and send it on.",
    primaryAction: "try-again",
    secondaryAction: "save-diagnostics",
    retryOffered: true,
  },
  "no-connection": {
    headline: "Forge couldn't get a connection on this PC.",
    body:
      "Forge needs a free connection on this PC to reach its engine, and every one it tried was taken. " +
      "If you have another copy of Forge open, close it and try again — otherwise save a troubleshooting " +
      "file and send it to whoever set Forge up.",
    primaryAction: "try-again",
    secondaryAction: "save-diagnostics",
    retryOffered: true,
  },
  "missing-file": {
    headline: "Part of Forge is missing.",
    body:
      "A file Forge needs isn't in its installation folder. Installing Forge again puts that file back. " +
      "If you didn't move or delete anything, save a troubleshooting file and send it to whoever set Forge up.",
    primaryAction: "save-diagnostics",
    secondaryAction: "try-again",
    retryOffered: true,
  },
  "windows-blocked": {
    headline: "Windows blocked Forge from starting its engine.",
    body:
      "Forge tried to run a file inside its own installation and Windows refused. If you use antivirus " +
      "or Windows Security, check it for a blocked or quarantined item named Forge, then try again.",
    primaryAction: "try-again",
    secondaryAction: "save-diagnostics",
    retryOffered: true,
  },
  "refused-copy": {
    headline: "Forge's engine won't accept this app.",
    body:
      "Forge started its engine on this PC, but the engine refused this copy of Forge. Trying again " +
      "won't change that. Save a troubleshooting file and send it to whoever set Forge up — this needs " +
      "an updated version of Forge.",
    primaryAction: "save-diagnostics",
    secondaryAction: null,
    retryOffered: false,
  },
};
