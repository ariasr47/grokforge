import { Paperclip, Send, Square } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
} from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

/** Disables Send on an empty draft. Not a lock — do not use as placeholder. */
export const EMPTY_DRAFT_SEND = "Type a message to send";

/** Keyboard while the @file listbox is open. Arrow keys highlight; Tab/Enter insert. */
export function atMenuKeyAction(
  key: string,
  suggestions: readonly string[],
  activeIndex: number,
):
  | { type: "move"; index: number }
  | { type: "insert"; file: string }
  | { type: "close" }
  | null {
  if (!suggestions.length) return null;
  const n = suggestions.length;
  const clamped = Math.max(0, Math.min(activeIndex, n - 1));
  if (key === "Escape") return { type: "close" };
  if (key === "ArrowDown") return { type: "move", index: (clamped + 1) % n };
  if (key === "ArrowUp") return { type: "move", index: (clamped - 1 + n) % n };
  if (key === "Enter" || key === "Tab") {
    const file = suggestions[clamped];
    return file ? { type: "insert", file } : null;
  }
  return null;
}

/** Bare `@` / `@path` or a partial `/` token is not ready. An exact catalog skill is. */
export function draftIsSendReady(
  draft: string,
  catalogNames?: readonly string[] | null,
): boolean {
  const t = draft.trim();
  if (!t) return false;
  if (/^@\S*$/.test(t)) return false;
  if (/^\/\S*$/.test(t)) {
    const needle = t.toLowerCase();
    return (catalogNames ?? []).some((n) => {
      const name = n.startsWith("/") ? n : `/${n}`;
      return name.toLowerCase() === needle;
    });
  }
  return true;
}

/** Footer shout under shortcuts — real blocks only, not “type a message”. */
export function composerBlockReasonVisible(
  sendDisabledReason: string | null,
  draft: string,
): boolean {
  if (!sendDisabledReason || !draft.trim()) return false;
  if (sendDisabledReason === EMPTY_DRAFT_SEND) return false;
  return true;
}
export const COMPOSER_PLACEHOLDER_CHAT =
  "Speak into the continuum… paste text, attach .txt/.md";
export const COMPOSER_PLACEHOLDER_CODE =
  "Speak into the continuum… @file · attach · Enter send";

export function composerPlaceholder(opts: {
  lockedReason?: string | null;
  sendDisabledReason: string | null;
  draft: string;
  productMode: string;
}): string {
  if (opts.lockedReason) return opts.lockedReason;
  if (
    opts.sendDisabledReason &&
    !opts.draft.trim() &&
    opts.sendDisabledReason !== EMPTY_DRAFT_SEND
  ) {
    return opts.sendDisabledReason;
  }
  return opts.productMode === "chat"
    ? COMPOSER_PLACEHOLDER_CHAT
    : COMPOSER_PLACEHOLDER_CODE;
}

export function ComposerPane({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  atSuggestions,
  atActiveIndex = 0,
  onAtActiveIndexChange,
  onDismissAt,
  onInsertAt,
  onPinToPack,
  composerRef,
  draft,
  onDraftChange,
  onComposerKeyDown,
  sendDisabledReason,
  lockedReason = null,
  productMode,
  connected,
  densityCompact,
  onAttachFiles,
  busy,
  onCancel,
  onSend,
  footer,
  skillsMenu,
  armedSkill,
}: {
  dragOver: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  atSuggestions: string[];
  atActiveIndex?: number;
  onAtActiveIndexChange?: (index: number) => void;
  onDismissAt?: () => void;
  onInsertAt: (file: string) => void;
  onPinToPack?: (file: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendDisabledReason: string | null;
  lockedReason?: string | null;
  productMode: string;
  connected: boolean;
  densityCompact: boolean;
  onAttachFiles: (files: FileList | File[]) => void;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
  footer: ReactNode;
  skillsMenu?: ReactNode;
  armedSkill?: ReactNode;
}) {
  useLayoutEffect(() => {
    if (!atSuggestions.length) return;
    const el = document.querySelector(".at-menu button.is-active");
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [atActiveIndex, atSuggestions]);
  return (
    <section
      className={`composer-wrap${dragOver ? " drag-over" : ""}`}
      aria-label="Message composer"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {atSuggestions.length > 0 ? (
        <div className="at-menu" role="listbox" aria-label="File mentions">
          {atSuggestions.map((f, i) => (
            <div
              key={f}
              role="option"
              aria-selected={i === atActiveIndex}
              tabIndex={-1}
            >
              <button
                type="button"
                className={i === atActiveIndex ? "is-active" : undefined}
                onClick={() => onInsertAt(f)}
              >
                @{f}
              </button>
              {onPinToPack && productMode === "chat" ? (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onPinToPack(f);
                  }}
                >
                  Pin to pack
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {skillsMenu}
      {armedSkill ? <div className="skill-armed-row">{armedSkill}</div> : null}
      <div className="composer">
        <textarea
          id="composer-input"
          ref={composerRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            const act = atSuggestions.length
              ? atMenuKeyAction(e.key, atSuggestions, atActiveIndex)
              : null;
            if (act) {
              e.preventDefault();
              if (act.type === "move") onAtActiveIndexChange?.(act.index);
              else if (act.type === "insert") onInsertAt(act.file);
              else onDismissAt?.();
              return;
            }
            onComposerKeyDown(e);
          }}
          aria-label="Message to agent"
          placeholder={composerPlaceholder({
            lockedReason,
            sendDisabledReason,
            draft,
            productMode,
          })}
          disabled={!connected || Boolean(lockedReason)}
          rows={densityCompact ? 1 : 2}
        />
        <input
          type="file"
          id="composer-attach"
          multiple
          accept=".txt,.md,.markdown,.csv,.json,.log,.html,.xml,.yml,.yaml,.ts,.tsx,.js,.py,.rs,.pdf,text/*,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) onAttachFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          title="Attach text files into this message"
          disabled={!connected || busy || Boolean(lockedReason)}
          onClick={() => document.getElementById("composer-attach")?.click()}
        >
          <Icon icon={Paperclip} size={15} />
          Attach
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
