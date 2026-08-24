import type { ChatPackView, ProductMode } from "./api";

export const CHAT_PACK_FILE_CAP = 5;
export const CHAT_PACK_NOTE_CAP = 4000;
export const CHAT_PACK_FILE_CONTENTS_CAP = 80_000;

export type ChatPackComposerProjection =
  | { state: "absent_code" }
  | { state: "loading" }
  | { state: "offline" }
  | { state: "confirm_error" }
  | { state: "empty" }
  | { state: "armed"; fileCount: number; hasNote: boolean }
  | { state: "pin_failed"; fileCount: number; hasNote: boolean }
  | { state: "note_failed"; fileCount: number; hasNote: boolean }
  | { state: "hydrate_failed"; fileCount: number; hasNote: boolean; overCap: boolean };

export type ChatPackComposerInput = {
  mode?: ProductMode | string | null;
  connected: boolean;
  /** Active Chat home id. Members are ignored when chatPack.conversationId does not match. */
  conversationId: string | null;
  chatPack?: ChatPackView | null;
  /**
   * Shell-owned durable refs for this home. Used only to distinguish hydrate
   * cap refuse (durable over 5 files / 4000-note) from path-drop hydrate_failed.
   */
  durableMembers?: { files: Array<{ path: string }>; note: string | null };
};

export const PACK_COMPOSER_EMPTY = "No pinned pack";
export const PACK_INVENTORY_EMPTY =
  "Nothing pinned yet — pin files or add a short note.";
export const PACK_COMPOSER_LOADING = "Checking pack…";
export const PACK_COMPOSER_OFFLINE = "Reconnect to confirm pack.";
export const PACK_COMPOSER_CONFIRM_ERROR =
  "Couldn’t confirm pack for the next send.";
export const PACK_COMPOSER_PIN_FAILED = "Couldn’t pin that path.";
export const PACK_COMPOSER_NOTE_FAILED = "Couldn’t save the pack note.";
export const PACK_COMPOSER_HYDRATE_PATH =
  "Couldn’t reconfirm a pinned path.";
export const PACK_COMPOSER_HYDRATE_CAP =
  "Couldn’t reconfirm the pack — over the pin cap.";
export const PACK_INVENTORY_UPDATING = "Updating pack…";
export const PACK_COMPOSER_ARMED_TOOLTIP = "Armed for the next Chat send.";
export const HOME_NAME_PLACEHOLDER = "Name this home";
export const HOME_NAME_SAVE_FAILED = "Couldn’t save home name.";

export function packArmedLabel(fileCount: number, hasNote: boolean): string {
  if (fileCount > 0 && hasNote) return `Pack · ${fileCount} files · note`;
  if (fileCount > 0) return `Pack · ${fileCount} files`;
  return "Pack · note";
}

export function packMembersAreEmpty(members: {
  files: Array<{ path: string }>;
  note: string | null;
}): boolean {
  return members.files.length === 0 && members.note == null;
}

function membershipCounts(members: {
  files: Array<{ path: string }>;
  note: string | null;
}): { fileCount: number; hasNote: boolean } {
  return {
    fileCount: members.files.length,
    hasNote: members.note != null && members.note.length > 0,
  };
}

function durableOverCap(durable: ChatPackComposerInput["durableMembers"]): boolean {
  if (!durable) return false;
  if (durable.files.length > CHAT_PACK_FILE_CAP) return true;
  if (typeof durable.note === "string" && durable.note.length > CHAT_PACK_NOTE_CAP) {
    return true;
  }
  return false;
}

/**
 * Closed composer/inventory precedence — exactly one winner:
 * 1. Code → absent_code
 * 2. missing chatPack / conversationId mismatch → loading (connected) or offline
 * 3. confirmFailed → confirm_error (hide members)
 * 4. vouched === false + connected → loading
 * 5. vouched === false + offline → offline
 * 6. lastAttempt pin_failed / note_failed / hydrate_failed → that refuse state
 *    (including empty armed after hydrate — NOT empty)
 * 7. vouched + empty members + lastAttempt ok → empty
 * 8. vouched + non-empty members → armed
 */
export function projectChatPackComposer(
  input: ChatPackComposerInput,
): ChatPackComposerProjection {
  if (input.mode !== "chat") return { state: "absent_code" };

  const view = input.chatPack;
  const home = input.conversationId;
  if (!view || home == null || view.conversationId !== home) {
    return input.connected ? { state: "loading" } : { state: "offline" };
  }

  if (view.confirmFailed === true) return { state: "confirm_error" };

  if (view.vouched !== true) {
    return input.connected ? { state: "loading" } : { state: "offline" };
  }

  const counts = membershipCounts(view.members);
  if (view.lastAttempt === "pin_failed") {
    return { state: "pin_failed", ...counts };
  }
  if (view.lastAttempt === "note_failed") {
    return { state: "note_failed", ...counts };
  }
  if (view.lastAttempt === "hydrate_failed") {
    return {
      state: "hydrate_failed",
      ...counts,
      overCap: durableOverCap(input.durableMembers),
    };
  }

  if (packMembersAreEmpty(view.members)) return { state: "empty" };
  return { state: "armed", ...counts };
}
