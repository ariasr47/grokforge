import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "./messageBlocks";
import { toolRunStats } from "./messageBlocks";
import { displayToolName } from "./toolFormat";

function looksLikePath(s: string): boolean {
  if (!s || s.length > 260) return false;
  if (s.includes("\n") || s.includes(" ")) return false;
  return /[/\\.]/.test(s) || /^[A-Za-z]:\\/.test(s);
}

interface RowProps {
  tool: ChatMessage;
  defaultOpen: boolean;
  onOpenPath?: (path: string) => void;
}

const ToolRow = memo(function ToolRow({
  tool,
  defaultOpen,
  onOpenPath,
}: RowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const name = displayToolName(tool.toolMeta?.name);
  const summary = tool.toolMeta?.summary || "";
  const ok = tool.toolMeta?.ok;
  const execution = tool.toolMeta?.execution;
  const eventStatus = tool.toolMeta?.status;
  const done = tool.toolMeta?.done !== false && eventStatus !== "running";
  const status =
    eventStatus === "rejected" || execution === "not_executed"
      ? "not-run"
      : eventStatus === "failed" || (execution === "executed" && ok === false) || ok === false
        ? "fail"
        : !done
          ? "pending"
          : "ok";
  const statusLabel =
    status === "pending"
      ? "running"
      : status === "fail"
        ? "failed"
        : status === "not-run"
          ? "Not run"
          : "Completed";

  const inputPath =
    tool.toolMeta?.activityEvent?.input &&
    typeof tool.toolMeta.activityEvent.input === "object" &&
    tool.toolMeta.activityEvent.input !== null &&
    "path" in tool.toolMeta.activityEvent.input &&
    typeof (tool.toolMeta.activityEvent.input as { path?: unknown }).path === "string"
      ? (tool.toolMeta.activityEvent.input as { path: string }).path
      : null;
  const pathHint = looksLikePath(summary) ? summary : inputPath && looksLikePath(inputPath) ? inputPath : null;
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Peek: first ~40 lines of output when expanded
  const preview = useMemo(() => {
    const authoritative = tool.toolMeta?.execution === "not_executed"
      ? tool.toolMeta.activityEvent?.reason
      : tool.toolMeta?.activityEvent?.error;
    const body = authoritative || tool.content || "(no output yet)";
    const lines = body.split("\n");
    if (lines.length <= 48) return body;
    return `${lines.slice(0, 48).join("\n")}\n… (${lines.length - 48} more lines)`;
  }, [tool.content]);

  return (
    <div
      className={`tool-row ${status}${!done ? " tool-row-live" : ""}`}
      data-activity-identity={tool.activityIdentity}
    >
      <button
        type="button"
        className="tool-row-head"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={`tool-row-dot ${status}`} aria-hidden />
        <span className="tool-row-name">{name}</span>
        {summary ? (
          <span className="tool-row-summary" title={summary}>
            {summary}
          </span>
        ) : null}
        <span className={`tool-row-status ${status}`}>
          {status === "pending" ? (
            <>
              <span className="tool-spinner" aria-hidden />
              {statusLabel}
            </>
          ) : (
            statusLabel
          )}
        </span>
        <span className="tool-row-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {pathHint && onOpenPath ? (
        <div className="tool-row-actions">
          <button
            type="button"
            className="btn ghost tool-peek-btn"
            onClick={() => onOpenPath(pathHint)}
          >
            Peek path
          </button>
        </div>
      ) : null}
      {open ? (
        <pre id={panelId} className="tool-row-body">
          {tool.toolMeta?.detailAvailable === false
            ? "Details unavailable."
            : preview || (status === "not-run" ? "Not run" : "")}
        </pre>
      ) : null}
    </div>
  );
});

interface GroupProps {
  tools: ChatMessage[];
  live?: boolean;
  onOpenPath?: (path: string) => void;
  forceOpen?: boolean;
  groupKey?: string;
}

export const ToolActivityGroup = memo(function ToolActivityGroup({
  tools,
  live: _live = false,
  onOpenPath,
  forceOpen,
  groupKey,
}: GroupProps) {
  const stats = useMemo(() => toolRunStats(tools), [tools]);
  const hasFail = stats.failed > 0 || tools.some((t) => t.toolMeta?.execution === "not_executed");
  const hasPending = stats.pending > 0;

  const [intent, setIntent] = useState<"automatic_open" | "explicit_open" | "explicit_closed">(
    groupKey?.startsWith("tools-")
      ? hasFail
        ? "automatic_open"
        : "explicit_closed"
      : "automatic_open",
  );
  const open = forceOpen === true || intent !== "explicit_closed";
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ identity: string | null; offset: number; atEnd: boolean } | null>(null);

  // Capture the user's viewport before row/detail reconciliation mutates the
  // bounded body. Cleanup runs before the next DOM commit; the following
  // layout effect restores the same identity/offset unless the user was at end.
  useLayoutEffect(() => {
    return () => {
      const body = bodyRef.current;
      if (!body) return;
      const rows = Array.from(body.querySelectorAll<HTMLElement>(".tool-row"));
      const first = rows.find((row) => row.getBoundingClientRect().bottom > body.getBoundingClientRect().top);
      const bodyRect = body.getBoundingClientRect();
      scrollAnchorRef.current = {
        identity: first?.dataset.activityIdentity || null,
        offset: first ? first.getBoundingClientRect().top - bodyRect.top : 0,
        atEnd: body.scrollHeight - body.scrollTop - body.clientHeight <= 2,
      };
    };
  }, [tools]);

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    const body = bodyRef.current;
    if (!anchor || !body) return;
    if (anchor.atEnd) {
      body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    } else if (anchor.identity) {
      const row = body.querySelector<HTMLElement>(`[data-activity-identity="${CSS.escape(anchor.identity)}"]`);
      if (row) {
        const bodyRect = body.getBoundingClientRect();
        body.scrollTop += row.getBoundingClientRect().top - bodyRect.top - anchor.offset;
      }
    }
    scrollAnchorRef.current = null;
  }, [tools, open]);

  const title = useMemo(() => {
    return "Tool activity";
  }, [stats.total, tools]);

  const subtitle = useMemo(() => {
    const bits: string[] = [];
    if (stats.failed) bits.push(`${stats.failed} failed`);
    if (stats.notRun) bits.push(`${stats.notRun} not run`);
    if (stats.pending) bits.push(`${stats.pending} running`);
    if (!bits.length && stats.ok) bits.push("Completed");
    const nameHint =
      stats.names.length > 3
        ? `${stats.names.slice(0, 3).map(displayToolName).join(", ")}…`
        : stats.names.map(displayToolName).join(", ");
    if (nameHint && stats.total > 1) bits.push(nameHint);
    return bits.join(" · ");
  }, [stats]);

  const groupStatus = hasFail ? "fail" : hasPending ? "pending" : "ok";
  const panelId = useId();
  const accessibleTitle = `${title}: ${tools[0]?.toolMeta?.name ? displayToolName(tools[0].toolMeta.name) : "tools"}`;

  return (
    <section
      className={`tool-activity ${groupStatus}`}
      data-tool-activity
      data-flex-shrink="0"
      aria-label={title}
      data-activity-run={groupKey}
    >
      <button
        type="button"
        className="tool-activity-head"
        onClick={() => setIntent(open ? "explicit_closed" : "explicit_open")}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={accessibleTitle}
      >
        <span className="tool-activity-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className={`tool-activity-icon ${groupStatus}`} aria-hidden />
        <span className="tool-activity-title">{title}</span>
        {subtitle ? (
          <span className="tool-activity-sub">{subtitle}</span>
        ) : null}
        {intent === "automatic_open" && hasPending ? (
          <span className="tool-activity-hint">Stays open when complete</span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className="tool-activity-body"
          role="region"
          aria-label="Tool activity details"
          tabIndex={0}
          ref={bodyRef}
        >
          {tools.map((t) => (
            <ToolRow
              key={t.id}
              tool={t}
              defaultOpen={
                t.toolMeta?.ok === false ||
                t.toolMeta?.status === "failed" ||
                t.toolMeta?.status === "rejected" ||
                forceOpen === true
              }
              onOpenPath={onOpenPath}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});
