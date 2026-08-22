import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChatMessage } from "./messageBlocks";
import { toDisplayBlocks } from "./messageBlocks";
import { useVirtualizer } from "@tanstack/react-virtual";

export type { ChatMessage };
import { ToolActivityGroup } from "./ToolActivity";
import { MarkdownBody } from "./markdown";

interface Props {
  messages: ChatMessage[];
  busy?: boolean;
  windowSize?: number;
  onOpenPath?: (path: string) => void;
  forceOpenFailedTools?: boolean;
  /** Show “your turn” delimiter after a finished run */
  showTurnDelimiter?: boolean;
  onRetryUser?: (messageId: string, content: string) => void;
  onRegenerate?: (userContent: string) => void;
  lastUserId?: string | null;
  lastAssistantId?: string | null;
  /** Rich UI choice → fill composer */
  onChoose?: (label: string, meta?: string) => void;
  /** Outer transcript scroller — used to virtualize long histories. */
  scrollRef?: RefObject<HTMLElement | null>;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("clipboard unavailable"));
}

/** Compact system noise (perm/diff notices) instead of full bubbles. */
function isActivityChip(m: ChatMessage): boolean {
  if (m.role !== "system") return false;
  const c = m.content;
  return (
    c.startsWith("Permission requested:") ||
    c.startsWith("Diff accepted:") ||
    c.startsWith("Diff rejected:") ||
    c.startsWith("Diff proposed:") ||
    c.startsWith("Stopped by you") ||
    c.startsWith("Run ended")
  );
}

const ActivityChip = memo(function ActivityChip({
  message: m,
}: {
  message: ChatMessage;
}) {
  const stopped = m.content.startsWith("Stopped by you");
  return (
    <div
      className={`activity-chip${stopped ? " activity-chip-stop" : ""}`}
      role="status"
    >
      {m.content}
    </div>
  );
});

const ThinkingPlaceholder = memo(function ThinkingPlaceholder({
  detail,
}: {
  detail?: string | null;
}) {
  return (
    <div className="thinking-placeholder" role="status" aria-live="polite">
      <div className="thinking-placeholder-head">
        <span className="run-dot" />
        <span>Thinking field</span>
      </div>
      <p className="thinking-placeholder-detail">
        {detail || "Waiting for the model — this can take a while on Expert/Heavy."}
      </p>
      <div className="thinking-skeleton" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
});

const ChatBubble = memo(function ChatBubble({
  message: m,
  showRetry,
  showRegenerate,
  onRetry,
  onRegenerate,
  onChoose,
}: {
  message: ChatMessage;
  showRetry?: boolean;
  showRegenerate?: boolean;
  onRetry?: () => void;
  onRegenerate?: () => void;
  onChoose?: (label: string, meta?: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const kind =
    m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant";
  const label =
    m.role === "user"
      ? "You"
      : m.role === "system"
        ? "System"
        : "Grok · presence";

  const onCopy = useCallback(() => {
    void copyText(m.content)
      .then(() => {
        setCopied(true);
        setCopyErr(false);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        setCopyErr(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopyErr(false), 1500);
      });
  }, [m.content]);

  const useMd = m.role === "assistant" || m.role === "system";
  // Plain stream only for short unstructured text; rich/md renders live
  const showPlainStream =
    m.role === "assistant" &&
    m.streaming &&
    m.content.length < 800 &&
    !m.content.includes("```") &&
    !m.content.includes("|") &&
    !/^#{1,4}\s/m.test(m.content);
  const [thinkOpen, setThinkOpen] = useState(
    Boolean(m.streaming && m.thinking),
  );

  useEffect(() => {
    if (m.thinking && m.streaming) setThinkOpen(true);
  }, [m.thinking, m.streaming]);

  return (
    <article
      className={`msg ${kind}${m.streaming ? " streaming" : ""}`}
      data-msg-role={m.role}
    >
      <div className="msg-head">
        <div className="role">
          {label}
          {m.streaming ? " · streaming" : ""}
        </div>
        <div className="msg-actions">
          {showRetry && onRetry && (
            <button
              type="button"
              className="btn ghost msg-action"
              onClick={onRetry}
              title="Send this message again"
            >
              Retry
            </button>
          )}
          {showRegenerate && onRegenerate && (
            <button
              type="button"
              className="btn ghost msg-action"
              onClick={onRegenerate}
              title="Generate a new reply to the last question"
            >
              Regenerate
            </button>
          )}
          <button
            type="button"
            className="btn ghost msg-action"
            onClick={onCopy}
            title="Copy message"
          >
            {copyErr ? "Failed" : copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {m.thinking ? (
        <details
          className="think-aloud"
          open={thinkOpen}
          onToggle={(e) => setThinkOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            Thinking
            {m.streaming && !m.content ? "…" : ""}
          </summary>
          <pre className="think-aloud-body">{m.thinking}</pre>
        </details>
      ) : null}
      {showPlainStream ? (
        <div className="body md-body streaming">
          {m.content || (m.thinking ? "" : "…")}
          <span className="md-caret" aria-hidden />
        </div>
      ) : useMd ? (
        m.content ? (
          <MarkdownBody
            text={m.content}
            streaming={Boolean(m.streaming)}
            onChoose={onChoose}
          />
        ) : null
      ) : (
        <div className="body">{m.content}</div>
      )}
    </article>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  busy = false,
  windowSize = 120,
  onOpenPath,
  forceOpenFailedTools = false,
  showTurnDelimiter = false,
  onRetryUser,
  onRegenerate,
  lastUserId,
  lastAssistantId,
  thinkingDetail,
  onChoose,
  scrollRef,
}: Props & { thinkingDetail?: string | null }) {
  const sliced = useMemo(() => {
    if (messages.length <= windowSize) return messages;
    return messages.slice(messages.length - windowSize);
  }, [messages, windowSize]);

  const truncated = messages.length > windowSize;
  const blocks = useMemo(() => toDisplayBlocks(sliced), [sliced]);

  const showPlaceholder =
    busy &&
    !messages.some(
      (m) =>
        m.role === "assistant" &&
        m.streaming &&
        (Boolean(m.content?.trim()) || Boolean(m.thinking?.trim())),
    );

  const renderBlock = (block: (typeof blocks)[number]) => {
    if (block.kind === "message") {
      const m = block.message;
      if (isActivityChip(m)) {
        return <ActivityChip key={block.key} message={m} />;
      }
      const isLastUser = m.role === "user" && m.id === lastUserId && !busy;
      const isLastAssistant =
        m.role === "assistant" && m.id === lastAssistantId && !busy;
      return (
        <ChatBubble
          key={block.key}
          message={m}
          showRetry={isLastUser && Boolean(onRetryUser)}
          showRegenerate={
            isLastAssistant && Boolean(onRegenerate) && Boolean(lastUserId)
          }
          onChoose={onChoose}
          onRetry={
            isLastUser && onRetryUser
              ? () => onRetryUser(m.id, m.content)
              : undefined
          }
          onRegenerate={
            isLastAssistant && onRegenerate
              ? () => {
                  const u = messages
                    .slice()
                    .reverse()
                    .find((x) => x.role === "user");
                  if (u) onRegenerate(u.content);
                }
              : undefined
          }
        />
      );
    }
    return (
      <ToolActivityGroup
        key={block.key}
        tools={block.tools}
        groupKey={block.key}
        onOpenPath={onOpenPath}
        forceOpen={
          forceOpenFailedTools &&
          block.tools.some((t) => t.toolMeta?.ok === false)
        }
      />
    );
  };

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 140,
    overscan: 8,
    enabled: Boolean(scrollRef) && blocks.length > 40,
  });

  const virtualItems =
    Boolean(scrollRef) && blocks.length > 40
      ? virtualizer.getVirtualItems()
      : null;

  return (
    <>
      {truncated ? (
        <div className="msg-window-note" role="status">
          Showing last {windowSize} of {messages.length} messages
        </div>
      ) : null}
      {virtualItems ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((row) => {
            const block = blocks[row.index]!;
            return (
              <div
                key={block.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
              >
                {renderBlock(block)}
              </div>
            );
          })}
        </div>
      ) : (
        blocks.map((block) => renderBlock(block))
      )}
      {showPlaceholder ? (
        <ThinkingPlaceholder detail={thinkingDetail} />
      ) : null}
      {showTurnDelimiter && !busy ? (
        <div className="turn-delimiter" role="status">
          <span className="turn-delimiter-line" aria-hidden />
          <span className="turn-delimiter-label">
            Your turn — type the next message below
          </span>
          <span className="turn-delimiter-line" aria-hidden />
        </div>
      ) : null}
    </>
  );
});
