import { Paperclip, Send } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
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

export const COMPOSER_PLACEHOLDER_CODE =
  "Ask Grok to change something… @ file · / command";
/** While a run is waiting on you (a question-style decision that does not
 *  lock the composer — see App.tsx's `lockedReason`, which stays null here)
 *  the field is also a valid way to answer: reply free-form instead of
 *  picking a numbered option. */
export const COMPOSER_PLACEHOLDER_CODE_DECISION =
  "Reply or steer Grok… @ file · / command";
const CHAT_HOME_FALLBACK = "Chat";

/** Chat's placeholder names the current home. A session always carries a
 *  real title (defaulting to "New chat"/the "Name this home" placeholder) —
 *  never a fabricated one; `home` falls back to a plain word only when the
 *  caller has not wired one in yet. */
export function chatComposerPlaceholder(home?: string | null): string {
  const label = home?.trim() || CHAT_HOME_FALLBACK;
  return `Message ${label}… paste text, drop a PDF`;
}

export function composerPlaceholder(opts: {
  lockedReason?: string | null;
  sendDisabledReason: string | null;
  draft: string;
  productMode: string;
  decisionPending?: boolean;
  chatHomeLabel?: string | null;
}): string {
  if (opts.lockedReason) return opts.lockedReason;
  if (opts.productMode !== "chat" && opts.decisionPending) {
    return COMPOSER_PLACEHOLDER_CODE_DECISION;
  }
  if (
    opts.sendDisabledReason &&
    !opts.draft.trim() &&
    opts.sendDisabledReason !== EMPTY_DRAFT_SEND
  ) {
    return opts.sendDisabledReason;
  }
  if (opts.productMode === "chat") {
    return chatComposerPlaceholder(opts.chatHomeLabel);
  }
  return COMPOSER_PLACEHOLDER_CODE;
}

/**
 * Growth: an explicit newline always grows the composer past its idle one
 * row; otherwise it grows once the field's natural content height exceeds a
 * measured single empty-line baseline (a long line wrapping without Enter).
 * Real layout only exists in a browser — scrollHeight/baseHeight both read 0
 * in jsdom, where the newline check alone still drives this deterministically.
 */
export function composerShouldGrow(
  draft: string,
  scrollHeight: number,
  baseHeight: number,
): boolean {
  if (draft.includes("\n")) return true;
  return scrollHeight > baseHeight + 1;
}

const COMPOSER_MAX_HEIGHT = 200;
const META_HINT_IDLE = "⏎ send · ⇧⏎ line · Ctrl+K commands";
const META_HINT_BUSY = "⇧⏎ queue · esc stop";

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
  onAttachFiles,
  busy,
  onCancel,
  onSend,
  onQueue,
  onCancelQueued,
  queuedCount = 0,
  decisionPending = false,
  chatHomeLabel = null,
  chips = null,
  contextRing = null,
  metaFacts = null,
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
  onAttachFiles: (files: FileList | File[]) => void;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
  /** Shift+Enter while busy holds the draft — see composerSend.ts. */
  onQueue?: () => void;
  /** Cancels whatever is held in the Queued chip. */
  onCancelQueued?: () => void;
  /** 0 or 1 today (a single held-draft slot); the chip reads "Queued · N". */
  queuedCount?: number;
  /** A question-style decision is pending but the composer is not locked —
   *  swaps the Code placeholder to the reply-or-steer copy. */
  decisionPending?: boolean;
  /** Chat's composer placeholder names this home. */
  chatHomeLabel?: string | null;
  /** Plan / Expert / Review (Code) or Pack / Expert (Chat) — pre-built by
   *  App.tsx, which owns the mode-specific composition and the underlying
   *  projections these chips read. */
  chips?: ReactNode;
  /** Task 12's mount point. Renders nothing until real usage data exists —
   *  never a fabricated percentage. */
  contextRing?: ReactNode;
  /** Left side of the one-line mono meta bar under the field. */
  metaFacts?: ReactNode;
  footer: ReactNode;
  skillsMenu?: ReactNode;
  armedSkill?: ReactNode;
}) {
  useLayoutEffect(() => {
    if (!atSuggestions.length) return;
    const el = document.querySelector(".at-menu button.is-active");
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [atActiveIndex, atSuggestions]);

  const [grown, setGrown] = useState(() => draft.includes("\n"));
  const baseHeightRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollHeight = el.scrollHeight;
    if (baseHeightRef.current == null) baseHeightRef.current = scrollHeight;
    const baseHeight = baseHeightRef.current;
    const capped = Math.min(
      Math.max(scrollHeight, baseHeight),
      COMPOSER_MAX_HEIGHT,
    );
    el.style.height = `${capped}px`;
    setGrown(composerShouldGrow(draft, scrollHeight, baseHeight));
  }, [draft, composerRef]);

  const queueDisabled = !draft.trim();

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
      <div className={`composer${grown ? "" : " one"}`}>
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
            decisionPending,
            chatHomeLabel,
          })}
          disabled={!connected || Boolean(lockedReason)}
          rows={1}
        />
        <div className="bar">
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
            className="icon-only"
            title="Attach text files into this message"
            disabled={!connected || busy || Boolean(lockedReason)}
            onClick={() => document.getElementById("composer-attach")?.click()}
          >
            <Icon icon={Paperclip} size={15} />
          </Button>
          {chips}
          {contextRing}
          {busy ? (
            queuedCount > 0 ? (
              <Chip
                tone="on"
                title="Cancel the queued message"
                onPress={() => onCancelQueued?.()}
              >
                {`Queued · ${queuedCount}`}
              </Chip>
            ) : (
              <Button
                size="sm"
                disabled={queueDisabled}
                onClick={() => onQueue?.()}
              >
                <span>Queue</span>
                {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: the kbd hint
                    is not itself focusable; hiding it keeps the button's
                    accessible name "Queue" instead of "Queue⇧⏎" — same
                    convention as Gate.tsx's Allow/Deny/S kbd hints. */}
                <kbd aria-hidden="true">⇧⏎</kbd>
              </Button>
            )
          ) : null}
          {busy ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <span>Stop</span>
              {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: see the Queue
                  button's kbd above — same convention as Gate.tsx. */}
              <kbd aria-hidden="true">esc</kbd>
            </Button>
          ) : (
            <Button
              variant="primary"
              className="send"
              disabled={Boolean(sendDisabledReason)}
              title={sendDisabledReason || "Send (Enter)"}
              onClick={onSend}
            >
              <Icon icon={Send} size={15} />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
      </div>
      <div className="cmeta">
        <span className="cmeta-facts">{metaFacts}</span>
        <span className="r">{busy ? META_HINT_BUSY : META_HINT_IDLE}</span>
      </div>
      {footer}
    </section>
  );
}
