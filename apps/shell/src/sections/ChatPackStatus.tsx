import { memo } from "react";
import {
  PACK_COMPOSER_ARMED_TOOLTIP,
  PACK_COMPOSER_CONFIRM_ERROR,
  PACK_COMPOSER_EMPTY,
  PACK_COMPOSER_HYDRATE_CAP,
  PACK_COMPOSER_HYDRATE_PATH,
  PACK_COMPOSER_LOADING,
  PACK_COMPOSER_NOTE_FAILED,
  PACK_COMPOSER_OFFLINE,
  PACK_COMPOSER_PIN_FAILED,
  packArmedLabel,
  type ChatPackComposerProjection,
} from "../projections/chatPackComposer";

export {
  PACK_COMPOSER_ARMED_TOOLTIP,
  PACK_COMPOSER_CONFIRM_ERROR,
  PACK_COMPOSER_EMPTY,
  PACK_COMPOSER_HYDRATE_CAP,
  PACK_COMPOSER_HYDRATE_PATH,
  PACK_COMPOSER_LOADING,
  PACK_COMPOSER_NOTE_FAILED,
  PACK_COMPOSER_OFFLINE,
  PACK_COMPOSER_PIN_FAILED,
  packArmedLabel,
};

export type ChatPackStatusProps = {
  projection: ChatPackComposerProjection;
  onToggleInventory?: () => void;
  inventoryOpen?: boolean;
};

function composerCopy(projection: ChatPackComposerProjection): {
  text: string;
  tone: "armed" | "empty" | "error" | "pending";
  title?: string;
} | null {
  switch (projection.state) {
    case "absent_code":
      return null;
    case "loading":
      return { text: PACK_COMPOSER_LOADING, tone: "pending" };
    case "offline":
      return { text: PACK_COMPOSER_OFFLINE, tone: "pending" };
    case "confirm_error":
      return { text: PACK_COMPOSER_CONFIRM_ERROR, tone: "error" };
    case "empty":
      return { text: PACK_COMPOSER_EMPTY, tone: "empty" };
    case "armed":
      return {
        text: packArmedLabel(projection.fileCount, projection.hasNote),
        tone: "armed",
        title: PACK_COMPOSER_ARMED_TOOLTIP,
      };
    case "pin_failed":
      return { text: PACK_COMPOSER_PIN_FAILED, tone: "error" };
    case "note_failed":
      return { text: PACK_COMPOSER_NOTE_FAILED, tone: "error" };
    case "hydrate_failed":
      return {
        text: projection.overCap ? PACK_COMPOSER_HYDRATE_CAP : PACK_COMPOSER_HYDRATE_PATH,
        tone: "error",
      };
  }
}

export const ChatPackStatus = memo(function ChatPackStatus({
  projection,
  onToggleInventory,
  inventoryOpen,
}: ChatPackStatusProps) {
  const copy = composerCopy(projection);
  if (!copy) return null;

  const role = copy.tone === "error" ? "alert" : "status";
  const className = `chat-pack-status is-${copy.tone}`;

  return (
    <div className={className} data-chat-pack={projection.state} role={role}>
      <button
        type="button"
        className="chat-pack-chip"
        title={copy.title}
        aria-label={copy.text}
        aria-expanded={inventoryOpen ? true : undefined}
        onClick={onToggleInventory}
      >
        {copy.text}
      </button>
    </div>
  );
});
