import { memo, useState } from "react";
import { HOME_NAME_PLACEHOLDER, HOME_NAME_SAVE_FAILED } from "./chatPackComposer";
import { chatListTitle } from "./sessions";
import { Button } from "./ui/Button";

export { HOME_NAME_PLACEHOLDER, HOME_NAME_SAVE_FAILED };

export type ChatHomeNameProps = {
  mode?: string | null;
  committedName: boolean;
  title: string;
  saveFailed: boolean;
  busy?: boolean;
  onCommit: (title: string) => void;
  onRetry?: () => void;
};

export const ChatHomeName = memo(function ChatHomeName({
  mode,
  committedName,
  title,
  saveFailed,
  busy = false,
  onCommit,
  onRetry,
}: ChatHomeNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(committedName ? title : "");

  if (mode !== "chat") return null;

  if (saveFailed) {
    return (
      <div className="chat-home-name is-error" data-chat-home="save-failed">
        <span role="alert">{HOME_NAME_SAVE_FAILED}</span>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (onRetry) onRetry();
            else onCommit(draft.trim() || title);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (editing) {
    const save = () => {
      const next = draft.trim();
      if (!next) return;
      onCommit(next);
      setEditing(false);
    };
    return (
      <form
        className="chat-home-name is-editing"
        data-chat-home="editing"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={HOME_NAME_PLACEHOLDER}
          autoFocus
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button variant="ghost" disabled={busy || !draft.trim()} onClick={save}>
          Save
        </Button>
      </form>
    );
  }

  const heading = chatListTitle({
    committedName,
    title,
    workspace: "chat:__sandbox__",
  });
  if (!committedName) {
    const placeholder = heading === HOME_NAME_PLACEHOLDER;
    return (
      <div
        className={`chat-home-name${placeholder ? " is-placeholder" : " is-auto"}`}
        data-chat-home={placeholder ? "placeholder" : "auto-title"}
      >
        <button
          type="button"
          className="chat-home-name-trigger"
          title={placeholder ? undefined : "Rename home"}
          onClick={() => {
            setDraft(placeholder ? "" : title);
            setEditing(true);
          }}
        >
          {heading}
        </button>
      </div>
    );
  }

  return (
    <div className="chat-home-name is-committed" data-chat-home="committed">
      <button
        type="button"
        className="chat-home-name-trigger"
        title="Rename home"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
      >
        {title || HOME_NAME_PLACEHOLDER}
      </button>
    </div>
  );
});
