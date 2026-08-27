import type { CodeAgentFact, ProductMode } from "./api";

export type CodeAgentComposerProjection =
  | { state: "absent_chat" }
  | { state: "checking" }
  | { state: "vendor" }
  | { state: "fallback"; reason: "cli_missing" | "spawn_failed" | null }
  | { state: "hard_fail" }
  | {
      state: "offline_unconfirmed";
      last: Exclude<
        CodeAgentComposerProjection,
        { state: "absent_chat" | "checking" | "offline_unconfirmed" }
      >;
    };

export type CodeAgentComposerInput = {
  mode?: ProductMode | string | null;
  codeAgent?: CodeAgentFact | null;
  /** Host/WS health — NOT pre-acquire PublicState.connected. */
  transportOk: boolean;
};

export const CODE_AGENT_CHECKING = "Checking Grok agent…";
export const CODE_AGENT_VENDOR = "Grok Code";
export const CODE_AGENT_VENDOR_TITLE =
  "Code turns use the Grok agent when the Grok CLI is available.";
export const CODE_AGENT_FALLBACK_CLI = "Mini-Grok · Grok CLI not found";
export const CODE_AGENT_FALLBACK_SPAWN = "Mini-Grok · Couldn't start Grok agent";
export const CODE_AGENT_FALLBACK_GENERIC = "Mini-Grok";
export const CODE_AGENT_HARD_FAIL = "Couldn't start an agent for Code.";
export const CODE_AGENT_OFFLINE = "Reconnect to confirm which agent is running.";
export const CODE_AGENT_FALLBACK_CLI_TITLE =
  "Code is using Mini-Grok because the Grok CLI wasn’t found.";
export const CODE_AGENT_FALLBACK_SPAWN_TITLE =
  "Code is using Mini-Grok because the Grok agent didn’t start.";

function readyIdentity(
  fact: CodeAgentFact,
): Extract<
  CodeAgentComposerProjection,
  { state: "vendor" } | { state: "fallback" } | { state: "hard_fail" }
> | null {
  if (fact.identity === "vendor") return { state: "vendor" };
  if (fact.identity === "fallback") {
    return { state: "fallback", reason: fact.fallbackReason };
  }
  if (fact.identity === "hard_fail" || fact.resolveStatus === "hard_fail") {
    return { state: "hard_fail" };
  }
  return null;
}

/**
 * Closed composer precedence — exactly one winner:
 * 1. not Code → absent_chat
 * 2. missing fact / resolving → checking (never invent vendor)
 * 3. hard_fail
 * 4. transport down → last vouched vendor/fallback (never upgrade fallback→vendor)
 * 5. vendor / fallback
 */
export function projectCodeAgentComposer(
  input: CodeAgentComposerInput,
): CodeAgentComposerProjection {
  if (input.mode !== "code") return { state: "absent_chat" };
  const fact = input.codeAgent ?? null;
  if (!fact) return { state: "checking" };
  if (fact.resolveStatus === "resolving") return { state: "checking" };
  if (fact.resolveStatus === "hard_fail" || fact.identity === "hard_fail") {
    return { state: "hard_fail" };
  }
  if (!input.transportOk) {
    const last = readyIdentity(fact);
    if (last && last.state !== "hard_fail") {
      return { state: "offline_unconfirmed", last };
    }
    return { state: "checking" };
  }
  if (fact.identity === "vendor") return { state: "vendor" };
  if (fact.identity === "fallback") {
    return { state: "fallback", reason: fact.fallbackReason };
  }
  return { state: "checking" };
}

export function codeAgentPrimaryCopy(p: CodeAgentComposerProjection): string {
  switch (p.state) {
    case "checking":
      return CODE_AGENT_CHECKING;
    case "vendor":
      return CODE_AGENT_VENDOR;
    case "fallback":
      return p.reason === "cli_missing"
        ? CODE_AGENT_FALLBACK_CLI
        : p.reason === "spawn_failed"
          ? CODE_AGENT_FALLBACK_SPAWN
          : CODE_AGENT_FALLBACK_GENERIC;
    case "hard_fail":
      return CODE_AGENT_HARD_FAIL;
    case "offline_unconfirmed":
      return CODE_AGENT_OFFLINE;
    default:
      return "";
  }
}

export function codeAgentTitle(p: CodeAgentComposerProjection): string | undefined {
  switch (p.state) {
    case "vendor":
      return CODE_AGENT_VENDOR_TITLE;
    case "fallback":
      if (p.reason === "cli_missing") return CODE_AGENT_FALLBACK_CLI_TITLE;
      if (p.reason === "spawn_failed") return CODE_AGENT_FALLBACK_SPAWN_TITLE;
      return undefined;
    case "offline_unconfirmed":
      return CODE_AGENT_OFFLINE;
    default:
      return undefined;
  }
}

export function codeAgentIdentityKind(
  p: CodeAgentComposerProjection,
): "vendor" | "fallback" | "hard_fail" | null {
  if (p.state === "vendor" || p.state === "fallback" || p.state === "hard_fail") {
    return p.state;
  }
  if (p.state === "offline_unconfirmed") return codeAgentIdentityKind(p.last);
  return null;
}
