import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "./messageBlocks";
import { toolRunStats } from "./messageBlocks";
import { displayToolName, formatPdfReadFileFailureLabel } from "./toolFormat";
import { isForgeUnavailableVendorTool, isGenericToolName, toolRowCaption } from "./activityLabel";
import { quietActivityPath, VENDOR_SESSION_PLAN_CAPTION } from "./activityWriteLike";
import { isListAutoExecuted } from "./trustedCommandProvenance";
import { Button } from "./ui/Button";

const LIST_AUTO_CHIP = "Ran without asking · Trusted command class";
const LIST_AUTO_TOOLTIP = "Matched a saved class for this workspace. The process is not sandboxed.";

function looksLikePath(s: string): boolean {
  if (!s || s.length > 260) return false;
  if (s.includes("\n") || s.includes(" ")) return false;
  return /[/\\.]/.test(s) || /^[A-Za-z]:\\/.test(s);
}

/** Path (or session plan.md) from a single-tool caption — not the generic tool name. */
function captionPathHint(summary: string): string | null {
  if (looksLikePath(summary) || summary === VENDOR_SESSION_PLAN_CAPTION) return summary;
  const tick = summary.trim().match(/^Write\s+`([^`]+)`\s*$/i);
  if (!tick?.[1]) return null;
  const p = quietActivityPath(tick[1]) ?? tick[1];
  if (typeof p !== "string") return null;
  if (p === VENDOR_SESSION_PLAN_CAPTION || looksLikePath(p)) return p;
  return null;
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
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const panelId = useId();
  const caption = toolRowCaption({
    name: tool.toolMeta?.name,
    title: tool.toolMeta?.title,
    summary: tool.toolMeta?.summary,
    command: tool.toolMeta?.command ?? tool.toolMeta?.activityEvent?.command,
  });
  const name = caption.name;
  const summary = caption.summary;
  const ok = tool.toolMeta?.ok;
  const execution = tool.toolMeta?.execution;
  const eventStatus = tool.toolMeta?.status;
  const done = tool.toolMeta?.done !== false && eventStatus !== "running";
  const unavailable = isForgeUnavailableVendorTool(tool.toolMeta?.name);
  const status =
    unavailable || eventStatus === "rejected" || execution === "not_executed"
      ? "not-run"
      : eventStatus === "failed" || (execution === "executed" && ok === false) || ok === false
        ? "fail"
        : !done
          ? "pending"
          : "ok";
  const statusLabel =
    status === "pending"
      ? "Running"
      : status === "fail"
        ? "Failed"
        : unavailable
          ? "Not in Forge"
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
  const command = tool.toolMeta?.command ?? tool.toolMeta?.activityEvent?.command ?? null;
  const listAuto = isListAutoExecuted({
    execution: execution ?? tool.toolMeta?.activityEvent?.execution ?? null,
    automaticEligibility: tool.toolMeta?.activityEvent?.automaticEligibility,
    autoApplied: tool.toolMeta?.activityEvent?.autoApplied,
  });
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Peek: first ~40 lines of output when expanded
  const preview = useMemo(() => {
    const toolName = tool.toolMeta?.name ?? tool.toolMeta?.activityEvent?.name;
    const output = tool.toolMeta?.activityEvent?.output;
    if (tool.toolMeta?.status === "failed" && toolName === "read_file") {
      try {
        const parsed = output ? (JSON.parse(output) as { extract_failed?: unknown }) : null;
        if (parsed?.extract_failed === true) {
          return formatPdfReadFileFailureLabel(
            tool.toolMeta?.activityEvent?.error,
            output,
          );
        }
      } catch {
        /* non-JSON output keeps the existing failed peek */
      }
    }
    const authoritative = tool.toolMeta?.execution === "not_executed"
      ? tool.toolMeta.activityEvent?.reason
      : tool.toolMeta?.activityEvent?.error;
    if (unavailable) return "Not available in Forge Code.";
    const genericStatus = (value: string | null | undefined) =>
      Boolean(value && /^(completed|failed|error)$/i.test(value.trim()));
    const body = (!genericStatus(authoritative) && authoritative)
      || tool.content
      || "(no output yet)";
    if (status === "fail" && genericStatus(body)) {
      return "Non-zero exit";
    }
    const lines = body.split("\n");
    if (lines.length <= 48) return body;
    return `${lines.slice(0, 48).join("\n")}\n… (${lines.length - 48} more lines)`;
  }, [tool.content, tool.toolMeta, unavailable, status]);

  return (
    <div
      className={`tool-row ${status}${!done ? " tool-row-live" : ""}`}
      data-activity-identity={tool.activityIdentity}
      data-activity-id={tool.toolMeta?.activityId}
    >
      <button
        type="button"
        className={`tool-row-head${caption.plain || !summary ? " is-command" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={`tool-row-dot ${status}`} aria-hidden />
        <span className={`tool-row-name${caption.plain ? " tool-row-name-plain" : ""}`}>
          {name}
        </span>
        {summary ? (
          <span className="tool-row-summary" title={summary}>
            {summary}
          </span>
        ) : command && command !== name ? (
          <span className="tool-row-summary" title={command}>
            {command}
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
      {listAuto ? (
        <span className="chip tool-list-auto" title={LIST_AUTO_TOOLTIP}>
          {LIST_AUTO_CHIP}
        </span>
      ) : null}
      {pathHint && onOpenPath ? (
        <div className="tool-row-actions">
          <Button
            variant="ghost"
            className="tool-peek-btn"
            onClick={() => onOpenPath(pathHint)}
          >
            Peek path
          </Button>
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
  live = false,
  onOpenPath,
  forceOpen,
  groupKey,
}: GroupProps) {
  const stats = useMemo(() => toolRunStats(tools), [tools]);
  const hasFail = stats.failed > 0 || tools.some((t) => t.toolMeta?.execution === "not_executed");
  const hasPending = stats.pending > 0;
  const isRunSurface = Boolean(groupKey?.startsWith("run-tools:"));

  const [intent, setIntent] = useState<"automatic_open" | "explicit_open" | "explicit_closed">(
    () => {
      if (groupKey?.startsWith("tools-")) {
        return hasFail ? "automatic_open" : "explicit_closed";
      }
      if (isRunSurface && !live && !hasFail && !hasPending) {
        return "explicit_closed";
      }
      return "automatic_open";
    },
  );
  const open = forceOpen === true || intent !== "explicit_closed";

  useEffect(() => {
    if (!isRunSurface || live || hasFail || hasPending) return;
    setIntent((cur) => (cur === "automatic_open" ? "explicit_closed" : cur));
  }, [isRunSurface, live, hasFail, hasPending]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ identity: string | null; offset: number; atEnd: boolean } | null>(null);
  const prevToolsRef = useRef(tools);

  // Snapshot the inner viewport from the pre-commit DOM (still the previous
  // rows). Layout-effect cleanup runs after mutations, so it cannot see atEnd.
  if (prevToolsRef.current !== tools) {
    const body = bodyRef.current;
    if (body) {
      const rows = Array.from(body.querySelectorAll<HTMLElement>(".tool-row"));
      const first = rows.find((row) => row.getBoundingClientRect().bottom > body.getBoundingClientRect().top);
      const bodyRect = body.getBoundingClientRect();
      scrollAnchorRef.current = {
        identity: first?.dataset.activityIdentity || null,
        offset: first ? first.getBoundingClientRect().top - bodyRect.top : 0,
        atEnd: body.scrollHeight - body.scrollTop - body.clientHeight <= 2,
      };
    }
    prevToolsRef.current = tools;
  }

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
    const executable = stats.total - stats.unavailable;
    if (!bits.length && stats.ok && executable > 1) bits.push("Completed");
    const named = stats.names
      .filter((n) => !isForgeUnavailableVendorTool(n))
      .map(displayToolName)
      .filter((n) => !isGenericToolName(n));
    const nameHint =
      named.length > 3 ? `${named.slice(0, 3).join(", ")}…` : named.join(", ");
    if (stats.total === 1) {
      const only = tools[0];
      const cap = toolRowCaption({
        name: only?.toolMeta?.name,
        title: only?.toolMeta?.title,
        summary: only?.toolMeta?.summary,
        command: only?.toolMeta?.command,
      });
      if (cap.plain && cap.name) bits.push(cap.name);
      else {
        const pathHint = cap.summary ? captionPathHint(cap.summary) : null;
        if (pathHint) bits.push(pathHint);
        else if (nameHint) bits.push(nameHint);
        else {
          const n = stats.names[0];
          if (n && !isForgeUnavailableVendorTool(n)) bits.push(displayToolName(n));
        }
      }
    } else if (nameHint) bits.push(nameHint);
    return bits.join(" · ");
  }, [stats, tools]);

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
          <span className="tool-activity-hint">Open while tools run</span>
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
