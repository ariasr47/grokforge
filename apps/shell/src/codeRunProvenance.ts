import type { ProductMode } from "./api";
import type { CatchUpSignal } from "./runChangeList";
import type { CodeRunAgentProvenance, RunProjectionRun } from "./runReducer";

export type CodeRunProvenanceProjection =
  | { state: "absent" }
  | { state: "hydrating" }
  | { state: "vendor" }
  | { state: "fallback"; reason: "cli_missing" | "spawn_failed" | null }
  | { state: "confirm_error" };

export type CodeRunProvenanceInput = {
  mode?: ProductMode | string | null;
  run?: Pick<RunProjectionRun, "state" | "codeAgentProvenance"> | null;
  catchUp?: CatchUpSignal;
};

export const CODE_RUN_VENDOR = "Grok Code";
export const CODE_RUN_FALLBACK = "Mini-Grok · fallback";
export const CODE_RUN_HYDRATING = "Confirming which agent ran…";
export const CODE_RUN_CONFIRM_ERROR = "Couldn't confirm which agent ran this turn.";
export const CODE_RUN_FALLBACK_CLI = "Mini-Grok · fallback · Grok CLI not found";
export const CODE_RUN_FALLBACK_SPAWN = "Mini-Grok · fallback · Couldn't start Grok agent";

function fromStamp(stamp: CodeRunAgentProvenance): CodeRunProvenanceProjection {
  if (stamp.identity === "vendor") return { state: "vendor" };
  return { state: "fallback", reason: stamp.fallbackReason ?? null };
}

/**
 * Quiet per-Code-run provenance. Never invents vendor from agentName / PATH.
 * Catch-up open → hydrating. Missing stamp on a live run → hydrating.
 * Terminal / catch-up failed without a stamp → confirm_error.
 */
export function projectCodeRunProvenance(
  input: CodeRunProvenanceInput,
): CodeRunProvenanceProjection {
  if (input.mode !== "code") return { state: "absent" };
  const run = input.run ?? null;
  if (!run) return { state: "absent" };

  const stamp = run.codeAgentProvenance ?? null;
  const catchUp = input.catchUp?.phase ?? "closed";

  if (catchUp === "open") return { state: "hydrating" };

  if (stamp?.identity === "vendor" || stamp?.identity === "fallback") {
    return fromStamp(stamp);
  }

  if (catchUp === "failed") return { state: "confirm_error" };
  if (run.state !== "terminal") return { state: "hydrating" };
  // Old journals / no post-live stamp: invent nothing (not a voucher failure).
  return { state: "absent" };
}

export function codeRunProvenanceCopy(p: CodeRunProvenanceProjection): string {
  switch (p.state) {
    case "hydrating":
      return CODE_RUN_HYDRATING;
    case "vendor":
      return CODE_RUN_VENDOR;
    case "fallback":
      if (p.reason === "cli_missing") return CODE_RUN_FALLBACK_CLI;
      if (p.reason === "spawn_failed") return CODE_RUN_FALLBACK_SPAWN;
      return CODE_RUN_FALLBACK;
    case "confirm_error":
      return CODE_RUN_CONFIRM_ERROR;
    default:
      return "";
  }
}
