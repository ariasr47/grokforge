import type { ProductMode } from "../lib/api";
import type { CatchUpSignal } from "./runChangeList";
import type {
  ChatPackFault,
  ChatPackInclusion,
  ChatPackTurnVoucher,
  RunProjectionRun,
} from "./runReducer";

export type ChatPackTurnProjection =
  | { state: "absent" }
  | { state: "hydrating" }
  | { state: "included"; files: Array<{ path: string }>; noteIncluded: boolean }
  | { state: "not_included" }
  | { state: "materialization_fault"; fault: "path" | "over_cap"; files: Array<{ path: string }> }
  | { state: "confirm_error" }
  | {
      state: "restored";
      inclusion: "included" | "not_included" | "materialization_fault" | "confirm_failed";
      fault: ChatPackFault;
      files: Array<{ path: string }>;
      noteIncluded: boolean;
    };

export type ChatPackTurnOptions = {
  mode?: ProductMode | string | null;
};

export const PACK_TURN_INCLUDED = "Included pack";
export const PACK_TURN_NOT_INCLUDED = "No pack for this turn";
export const PACK_TURN_HYDRATING = "Confirming pack for this turn…";
export const PACK_TURN_FAULT_PATH =
  "Couldn’t include a pinned file on this turn.";
export const PACK_TURN_FAULT_OVER_CAP =
  "Couldn’t include the pack on this turn — over the 80,000-character send cap.";
export const PACK_TURN_CONFIRM_ERROR =
  "Couldn’t confirm whether the pack was included on this turn.";

function fromVoucher(voucher: ChatPackTurnVoucher): ChatPackTurnProjection {
  if (voucher.inclusion === "included") {
    return {
      state: "included",
      files: voucher.files,
      noteIncluded: voucher.noteIncluded,
    };
  }
  if (voucher.inclusion === "not_included") return { state: "not_included" };
  if (voucher.inclusion === "materialization_fault") {
    const fault = voucher.fault === "over_cap" ? "over_cap" : "path";
    return { state: "materialization_fault", fault, files: voucher.files };
  }
  if (voucher.inclusion === "confirm_failed") return { state: "confirm_error" };
  return { state: "hydrating" };
}

export function projectChatPackTurn(
  run: Pick<RunProjectionRun, "chatPack">,
  catchUp: CatchUpSignal,
  opts: ChatPackTurnOptions = {},
): ChatPackTurnProjection {
  if (opts.mode !== "chat") return { state: "absent" };

  const voucher = run.chatPack ?? null;

  if (catchUp.phase === "open") return { state: "hydrating" };

  if (catchUp.phase === "failed") {
    if (
      voucher &&
      (voucher.inclusion === "included" ||
        voucher.inclusion === "not_included" ||
        voucher.inclusion === "materialization_fault" ||
        voucher.inclusion === "confirm_failed")
    ) {
      return {
        state: "restored",
        inclusion: voucher.inclusion,
        fault: voucher.fault,
        files: voucher.files,
        noteIncluded: voucher.noteIncluded,
      };
    }
    return { state: "confirm_error" };
  }

  if (!voucher) return { state: "absent" };
  return fromVoucher(voucher);
}

export function packTurnFaultCopy(fault: ChatPackFault): string {
  if (fault === "over_cap") return PACK_TURN_FAULT_OVER_CAP;
  return PACK_TURN_FAULT_PATH;
}

export type { ChatPackInclusion, ChatPackFault };
