import { memo, useCallback, useId, useMemo, useState } from "react";
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
  const done = tool.toolMeta?.done !== false;
  const status =
    !done && ok === undefined ? "pending" : ok === false ? "fail" : "ok";
  const statusLabel =
    status === "pending" ? "running" : status === "fail" ? "failed" : "ok";

  const pathHint = looksLikePath(summary) ? summary : null;
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Peek: first ~40 lines of output when expanded
  const preview = useMemo(() => {
    const body = tool.content || "(no output yet)";
    const lines = body.split("\n");
    if (lines.length <= 48) return body;
    return `${lines.slice(0, 48).join("\n")}\n… (${lines.length - 48} more lines)`;
  }, [tool.content]);

  return (
    <div className={`tool-row ${status}${!done ? " tool-row-live" : ""}`}>
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
          {preview}
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
}

export const ToolActivityGroup = memo(function ToolActivityGroup({
  tools,
  live = false,
  onOpenPath,
  forceOpen,
}: GroupProps) {
  const stats = useMemo(() => toolRunStats(tools), [tools]);
  const hasFail = stats.failed > 0;
  const hasPending = stats.pending > 0;

  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open =
    forceOpen === true
      ? true
      : (userOpen ?? (hasFail || (live && hasPending)));

  const title = useMemo(() => {
    if (stats.total === 1) {
      const only = tools[0];
      const n = displayToolName(only?.toolMeta?.name);
      const s = only?.toolMeta?.summary;
      return s ? `${n} · ${s}` : n;
    }
    return `Used ${stats.total} tools`;
  }, [stats.total, tools]);

  const subtitle = useMemo(() => {
    const bits: string[] = [];
    if (stats.failed) bits.push(`${stats.failed} failed`);
    if (stats.pending) bits.push(`${stats.pending} running`);
    if (!bits.length && stats.ok) bits.push("all ok");
    const nameHint =
      stats.names.length > 3
        ? `${stats.names.slice(0, 3).map(displayToolName).join(", ")}…`
        : stats.names.map(displayToolName).join(", ");
    if (nameHint && stats.total > 1) bits.push(nameHint);
    return bits.join(" · ");
  }, [stats]);

  const groupStatus = hasFail ? "fail" : hasPending ? "pending" : "ok";
  const panelId = useId();

  return (
    <section
      className={`tool-activity ${groupStatus}`}
      data-tool-activity
      aria-label={title}
    >
      <button
        type="button"
        className="tool-activity-head"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="tool-activity-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className={`tool-activity-icon ${groupStatus}`} aria-hidden />
        <span className="tool-activity-title">{title}</span>
        {subtitle ? (
          <span className="tool-activity-sub">{subtitle}</span>
        ) : null}
      </button>
      {open ? (
        <div id={panelId} className="tool-activity-body">
          {tools.map((t) => (
            <ToolRow
              key={t.id}
              tool={t}
              defaultOpen={t.toolMeta?.ok === false || forceOpen === true}
              onOpenPath={onOpenPath}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});
