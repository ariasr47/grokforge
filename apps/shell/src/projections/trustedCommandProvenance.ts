import type { TrustedCommandClassId } from "../lib/api";

/** Host-vouched list-auto only: executed shell with Trusted command-class eligibility. */
export function isListAutoExecuted(a: {
  execution?: string | null;
  automaticEligibility?: string | null;
  autoApplied?: boolean | null;
}): boolean {
  return (
    a.execution === "executed" &&
    a.automaticEligibility === "trusted_command_class" &&
    a.autoApplied === true
  );
}

/**
 * Cosmetic-only classification for the gate's session-allow button label —
 * does the command's leading token(s) look like a known trusted-command
 * class, regardless of whether that class is actually saved for this
 * workspace. Mirrors the server's leading-family detection
 * (packages/grok-acp/src/trusted-command-match.ts) but never consults the
 * saved set: the gate must not decide trust, only describe what "S" would
 * cover if the class were saved. Whitespace-token match only — good enough
 * for a label hint; the host remains the sole enforcement authority.
 */
export function matchTrustedCommandClassId(command: string): TrustedCommandClassId | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const first = tokens[0]!.toLowerCase();
  if (first === "npm" || first === "npx" || first === "cargo") return first;
  if (first === "git") {
    const sub = (tokens[1] ?? "").toLowerCase();
    if (sub === "status" || sub === "diff" || sub === "log" || sub === "show") {
      return `git:${sub}` as TrustedCommandClassId;
    }
  }
  return null;
}

/** "git:status" -> "git status" — matches the real catalog labels verbatim. */
export function trustedCommandClassLabel(id: TrustedCommandClassId): string {
  return id.replace(":", " ");
}
