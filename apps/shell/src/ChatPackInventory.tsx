import { memo, useEffect, useState } from "react";
import {
  PACK_COMPOSER_CONFIRM_ERROR,
  PACK_COMPOSER_HYDRATE_CAP,
  PACK_COMPOSER_HYDRATE_PATH,
  PACK_COMPOSER_LOADING,
  PACK_COMPOSER_NOTE_FAILED,
  PACK_COMPOSER_OFFLINE,
  PACK_COMPOSER_PIN_FAILED,
  PACK_INVENTORY_EMPTY,
  PACK_INVENTORY_UPDATING,
  type ChatPackComposerProjection,
} from "./chatPackComposer";
import { Button } from "./ui/Button";

export { PACK_INVENTORY_EMPTY, PACK_INVENTORY_UPDATING };

export type ChatPackInventoryProps = {
  projection: ChatPackComposerProjection;
  members: { files: Array<{ path: string }>; note: string | null };
  mutationInFlight?: boolean;
  workspaceFiles?: string[];
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onSaveNote: (note: string) => void;
  onClearNote: () => void;
  onClearPack: () => void;
};

function hideMembers(state: ChatPackComposerProjection["state"]): boolean {
  return (
    state === "loading" ||
    state === "offline" ||
    state === "confirm_error" ||
    state === "absent_code"
  );
}

function inventoryStatus(projection: ChatPackComposerProjection): string | null {
  switch (projection.state) {
    case "absent_code":
      return null;
    case "loading":
      return PACK_COMPOSER_LOADING;
    case "offline":
      return PACK_COMPOSER_OFFLINE;
    case "confirm_error":
      return PACK_COMPOSER_CONFIRM_ERROR;
    case "empty":
      return PACK_INVENTORY_EMPTY;
    case "pin_failed":
      return PACK_COMPOSER_PIN_FAILED;
    case "note_failed":
      return PACK_COMPOSER_NOTE_FAILED;
    case "hydrate_failed":
      return projection.overCap ? PACK_COMPOSER_HYDRATE_CAP : PACK_COMPOSER_HYDRATE_PATH;
    default:
      return null;
  }
}

export const ChatPackInventory = memo(function ChatPackInventory({
  projection,
  members,
  mutationInFlight = false,
  workspaceFiles = [],
  onPin,
  onUnpin,
  onSaveNote,
  onClearNote,
  onClearPack,
}: ChatPackInventoryProps) {
  const [noteDraft, setNoteDraft] = useState(members.note ?? "");
  const [pinQuery, setPinQuery] = useState("");
  useEffect(() => {
    setNoteDraft(members.note ?? "");
  }, [members.note]);

  if (projection.state === "absent_code") return null;

  const hidden = hideMembers(projection.state);
  const status = mutationInFlight ? PACK_INVENTORY_UPDATING : inventoryStatus(projection);
  const showEmpty = projection.state === "empty" && !mutationInFlight;
  const pinCandidates = workspaceFiles
    .filter((f) => !members.files.some((m) => m.path === f))
    .filter((f) => !pinQuery || f.toLowerCase().includes(pinQuery.toLowerCase()))
    .slice(0, 8);
  const hasMembers = members.files.length > 0 || members.note != null;
  const error = projection.state === "pin_failed" || projection.state === "note_failed" || projection.state === "hydrate_failed" || projection.state === "confirm_error";

  return (
    <section
      className={`chat-pack-inventory${error ? " is-error" : ""}${showEmpty ? " is-empty" : ""}`}
      data-chat-pack-inventory={projection.state}
      aria-label="Chat pack"
    >
      {status ? (
        <p className="chat-pack-inventory-status" role={error ? "alert" : "status"}>
          {status}
        </p>
      ) : null}
      {!hidden ? (
        <>
          {members.note ? (
            <p className="chat-pack-note" data-chat-pack-note="armed">
              {members.note}
            </p>
          ) : null}
          {members.files.length > 0 ? (
            <ul className="chat-pack-files">
              {members.files.map((f) => (
                <li key={f.path}>
                  <code className="chat-pack-path" title={f.path}>
                    {f.path}
                  </code>
                  <Button
                    variant="ghost"
                    onClick={() => onUnpin(f.path)}
                    disabled={mutationInFlight}
                  >
                    Unpin
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="chat-pack-note-edit">
            <label className="sr-only" htmlFor="chat-pack-note-input">
              Pack note
            </label>
            <textarea
              id="chat-pack-note-input"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Short note for the next Chat send"
              rows={2}
              disabled={mutationInFlight}
            />
            <div className="chat-pack-note-actions">
              <Button
                variant="ghost"
                disabled={mutationInFlight}
                onClick={() => onSaveNote(noteDraft)}
              >
                Save note
              </Button>
              <Button
                variant="ghost"
                disabled={mutationInFlight || members.note == null}
                onClick={() => {
                  setNoteDraft("");
                  onClearNote();
                }}
              >
                Clear note
              </Button>
              <Button
                variant="ghost"
                disabled={mutationInFlight || !hasMembers}
                onClick={() => {
                  setNoteDraft("");
                  onClearPack();
                }}
              >
                Clear pack
              </Button>
            </div>
          </div>
          <div className="chat-pack-pin">
            <label className="sr-only" htmlFor="chat-pack-pin-filter">
              Pin a confined file
            </label>
            <input
              id="chat-pack-pin-filter"
              value={pinQuery}
              onChange={(e) => setPinQuery(e.target.value)}
              placeholder="Pin a file from this home"
              disabled={mutationInFlight}
            />
            {pinCandidates.length > 0 ? (
              <ul className="chat-pack-pin-list">
                {pinCandidates.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="chat-pack-pin-item"
                      disabled={mutationInFlight}
                      onClick={() => onPin(path)}
                    >
                      Pin {path}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
});
