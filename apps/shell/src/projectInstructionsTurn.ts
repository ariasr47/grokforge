import type { ProductMode } from "./api";
import { recognizedProjectInstructionPath } from "./projectInstructionsComposer";
import type { CatchUpSignal } from "./runChangeList";
import type {
  ProjectInstructionsInclusion,
  ProjectInstructionsTurnVoucher,
  RunProjectionRun,
} from "./runReducer";

export type ProjectInstructionsTurnProjection =
  | { state: "absent" }
  | { state: "hydrating" }
  | { state: "included"; path: string }
  | { state: "not_included" }
  | { state: "failed"; path: string | null }
  | { state: "confirm_error" }
  | { state: "restored"; inclusion: ProjectInstructionsInclusion; path: string | null };

export type ProjectInstructionsTurnOptions = {
  mode?: ProductMode | string | null;
};

export const PI_TURN_HYDRATING = "Confirming project instructions for this turn…";
export const PI_TURN_NOT_INCLUDED = "No project instructions for this turn";
export const PI_TURN_FAILED = "Couldn’t resolve project instructions for this turn.";
export const PI_TURN_CONFIRM_ERROR =
  "Couldn’t confirm whether project instructions were included on this turn.";

export function piTurnIncluded(path: string): string {
  return `Included · ${path}`;
}

function fromVoucher(
  voucher: ProjectInstructionsTurnVoucher,
): ProjectInstructionsTurnProjection {
  if (voucher.inclusion === "included") {
    const path = recognizedProjectInstructionPath(voucher.path);
    if (path) return { state: "included", path };
    return { state: "absent" };
  }
  if (voucher.inclusion === "failed") {
    return { state: "failed", path: voucher.path };
  }
  return { state: "not_included" };
}

export function projectProjectInstructionsTurn(
  run: Pick<RunProjectionRun, "projectInstructions">,
  catchUp: CatchUpSignal,
  opts: ProjectInstructionsTurnOptions = {},
): ProjectInstructionsTurnProjection {
  if (opts.mode === "chat") return { state: "absent" };

  const voucher = run.projectInstructions ?? null;

  if (catchUp.phase === "open") return { state: "hydrating" };

  if (catchUp.phase === "failed") {
    if (voucher) {
      return {
        state: "restored",
        inclusion: voucher.inclusion,
        path: voucher.path,
      };
    }
    return { state: "confirm_error" };
  }

  if (!voucher) return { state: "absent" };
  return fromVoucher(voucher);
}
