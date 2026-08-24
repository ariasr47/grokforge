import { memo } from "react";
import {
  PACK_TURN_CONFIRM_ERROR,
  PACK_TURN_HYDRATING,
  PACK_TURN_INCLUDED,
  PACK_TURN_NOT_INCLUDED,
  packTurnFaultCopy,
  type ChatPackTurnProjection,
} from "./chatPackTurn";

export {
  PACK_TURN_CONFIRM_ERROR,
  PACK_TURN_HYDRATING,
  PACK_TURN_INCLUDED,
  PACK_TURN_NOT_INCLUDED,
  packTurnFaultCopy,
};

export type ChatPackTurnChipProps = {
  projection: ChatPackTurnProjection;
};

function restoredCopy(projection: Extract<ChatPackTurnProjection, { state: "restored" }>): {
  text: string;
  tone: "included" | "empty" | "error";
} | null {
  if (projection.inclusion === "included") {
    return { text: PACK_TURN_INCLUDED, tone: "included" };
  }
  if (projection.inclusion === "not_included") {
    return { text: PACK_TURN_NOT_INCLUDED, tone: "empty" };
  }
  if (projection.inclusion === "materialization_fault") {
    return { text: packTurnFaultCopy(projection.fault), tone: "error" };
  }
  return { text: PACK_TURN_CONFIRM_ERROR, tone: "error" };
}

export const ChatPackTurnChip = memo(function ChatPackTurnChip({
  projection,
}: ChatPackTurnChipProps) {
  if (projection.state === "absent") return null;

  let text = "";
  let tone: "included" | "empty" | "error" | "pending" = "pending";

  switch (projection.state) {
    case "hydrating":
      text = PACK_TURN_HYDRATING;
      tone = "pending";
      break;
    case "included":
      text = PACK_TURN_INCLUDED;
      tone = "included";
      break;
    case "not_included":
      text = PACK_TURN_NOT_INCLUDED;
      tone = "empty";
      break;
    case "materialization_fault":
      text = packTurnFaultCopy(projection.fault);
      tone = "error";
      break;
    case "confirm_error":
      text = PACK_TURN_CONFIRM_ERROR;
      tone = "error";
      break;
    case "restored": {
      const restored = restoredCopy(projection);
      if (!restored) return null;
      text = restored.text;
      tone = restored.tone;
      break;
    }
  }

  return (
    <span
      className={`chat-pack-turn is-${tone}`}
      data-chat-pack-turn={projection.state}
      role={tone === "error" ? "alert" : "status"}
    >
      {text}
    </span>
  );
});
