import { Download, Paperclip, Send, Square } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

export function ComposerPane({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  atSuggestions,
  onInsertAt,
  composerRef,
  draft,
  onDraftChange,
  onComposerKeyDown,
  sendDisabledReason,
  productMode,
  connected,
  densityCompact,
  onAttachFiles,
  busy,
  hasMessages,
  onExportChat,
  onCancel,
  onSend,
  footer,
}: {
  dragOver: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  atSuggestions: string[];
  onInsertAt: (file: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendDisabledReason: string | null;
  productMode: string;
  connected: boolean;
  densityCompact: boolean;
  onAttachFiles: (files: FileList | File[]) => void;
  busy: boolean;
  hasMessages: boolean;
  onExportChat: () => void;
  onCancel: () => void;
  onSend: () => void;
  footer: ReactNode;
}) {
  return (
    <section
      className={`composer-wrap${dragOver ? " drag-over" : ""}`}
      aria-label="Message composer"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {atSuggestions.length > 0 ? (
        <ul className="at-menu">
          {atSuggestions.map((f) => (
            <li key={f}>
              <button type="button" onClick={() => onInsertAt(f)}>
                @{f}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="composer">
        <textarea
          id="composer-input"
          ref={composerRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onComposerKeyDown}
          aria-label="Message to agent"
          placeholder={
            sendDisabledReason && !draft.trim()
              ? sendDisabledReason
              : productMode === "chat"
                ? "Speak into the continuum… paste text, attach .txt/.md"
                : "Speak into the continuum… @file · attach · Enter send"
          }
          disabled={!connected}
          rows={densityCompact ? 2 : 3}
        />
        <input
          type="file"
          id="composer-attach"
          multiple
          accept=".txt,.md,.markdown,.csv,.json,.log,.html,.xml,.yml,.yaml,.ts,.tsx,.js,.py,.rs,text/*"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) onAttachFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          title="Attach text files into this message"
          disabled={!connected || busy}
          onClick={() => document.getElementById("composer-attach")?.click()}
        >
          <Icon icon={Paperclip} size={15} />
          Attach
        </Button>
        <Button
          variant="ghost"
          title="Download this chat as Markdown"
          disabled={!hasMessages}
          onClick={onExportChat}
        >
          <Icon icon={Download} size={15} />
          Export
        </Button>
        {busy ? (
          <Button onClick={onCancel}>
            <Icon icon={Square} size={15} />
            Cancel
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={Boolean(sendDisabledReason)}
            title={sendDisabledReason || "Send (Enter)"}
            onClick={onSend}
          >
            <Icon icon={Send} size={15} />
            Send
          </Button>
        )}
      </div>
      {footer}
    </section>
  );
}
