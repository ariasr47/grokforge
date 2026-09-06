import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "./messageBlocks";
import type { ActivityRecord } from "../projections/runReducer";
import { receiptVerb, type Receipt, type ReceiptTone, type ReceiptVerb } from "./receiptVerb";
import { formatPdfReadFileFailureLabel } from "../projections/toolFormat";
import { quietActivityPath, VENDOR_SESSION_PLAN_CAPTION } from "../projections/activityWriteLike";
import { writeClipboard } from "../lib/copyClipboard";
import { Button } from "../ui/Button";

/**
 * Bridges the two ChatMessage.toolMeta shapes reaching this component (the
 * run-based pipeline's full pass-through, and the legacy chat tool_run
 * pipeline's activityEvent) into one ActivityRecord for receiptVerb. Any
 * field neither side reports stays null/absent — never guessed.
 */
function toActivityRecord(tool: ChatMessage): ActivityRecord {
  const tm = tool.toolMeta;
  const ev = tm?.activityEvent;
  return {
    activityId: tm?.activityId ?? tool.id,
    invocationId: tm?.toolCallId ?? ev?.toolCallId ?? tool.id,
    name: tm?.name ?? ev?.name ?? "",
    lifecycle: tm?.lifecycle ?? ev?.lifecycle ?? "terminal",
    execution: tm?.execution !== undefined ? tm.execution : (ev?.execution ?? null),
    status: tm?.status ?? ev?.status ?? "succeeded",
    input: tm?.input !== undefined ? tm.input : (ev?.input ?? null),
    output: tm?.output !== undefined ? tm.output : (ev?.output ?? null),
    error: tm?.error !== undefined ? tm.error : (ev?.error ?? null),
    diff: tm?.diff ?? null,
    path: tm?.path ?? null,
    kind: tm?.kind ?? null,
    fromPath: tm?.fromPath ?? null,
    toPath: tm?.toPath ?? null,
    policy: {},
    automaticEligibility: tm?.automaticEligibility ?? ev?.automaticEligibility ?? "not_eligible",
    autoApplied: tm?.autoApplied ?? ev?.autoApplied ?? false,
    command: tm?.command ?? ev?.command ?? null,
    editId: null,
    recovery: null,
    summary: tm?.summary ?? ev?.summary ?? null,
    title: tm?.title ?? ev?.title ?? null,
  };
}

function looksLikePath(s: string | null | undefined): s is string {
  if (!s || s.length > 260) return false;
  if (s.includes("\n") || s.includes(" ")) return false;
  return /[/\\.]/.test(s) || /^[A-Za-z]:\\/.test(s);
}

/** First `path(line,col)` / `path:line:col` diagnostic location in real output text. */
function firstDiagnosticLocation(text: string): { path: string; line: number } | null {
  const ts = text.match(/([^\s():]+\.[A-Za-z0-9]+)\((\d+),\d+\)/);
  if (ts?.[1] && ts[2]) return { path: ts[1], line: Number(ts[2]) };
  const unix = text.match(/([^\s:]+\.[A-Za-z0-9]+):(\d+):\d+/);
  if (unix?.[1] && unix[2]) return { path: unix[1], line: Number(unix[2]) };
  return null;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  return `${Math.round(seconds)}s`;
}

const DIFF_TAIL_RE = /^(\+\d+)?\s*(−\d+)?$/;

/**
 * An Edited tail ("+6", "−2", or "+6 −2") colors its add/remove counts
 * independently of the row's tone — added lines read as growth (success)
 * and removed lines as reduction (danger) regardless of pass/fail.
 */
function renderTail(verb: ReceiptVerb, tail: string, tone: ReceiptTone) {
  if (verb === "Edited") {
    const m = tail.match(DIFF_TAIL_RE);
    if (m && (m[1] || m[2])) {
      return (
        <span className="tail">
          {m[1] ? <span className="tone-ok">{m[1]}</span> : null}
          {m[1] && m[2] ? " " : null}
          {m[2] ? <span className="tone-fail">{m[2]}</span> : null}
        </span>
      );
    }
  }
  return <span className={`tail tone-${tone}`}>{tail}</span>;
}

interface RowProps {
  tool: ChatMessage;
  record: ActivityRecord;
  receipt: Receipt;
  defaultOpen: boolean;
  onOpenPath?: (path: string) => void;
}

const ReceiptRow = memo(function ReceiptRow({ tool, record, receipt, defaultOpen, onOpenPath }: RowProps) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const panelId = useId();
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const done = tool.toolMeta?.done !== false && tool.toolMeta?.status !== "running";
  const { verb, what, tail, tone } = receipt;

  const fullOutput = useMemo(() => {
    const toolName = tool.toolMeta?.name ?? tool.toolMeta?.activityEvent?.name;
    const rawOutput =
      tool.toolMeta?.activityEvent?.output ?? (typeof record.output === "string" ? record.output : null);
    if (tool.toolMeta?.status === "failed" && toolName === "read_file") {
      try {
        const parsed = rawOutput ? (JSON.parse(rawOutput) as { extract_failed?: unknown }) : null;
        if (parsed?.extract_failed === true) {
          return formatPdfReadFileFailureLabel(tool.toolMeta?.activityEvent?.error ?? record.error, rawOutput);
        }
      } catch {
        /* non-JSON output keeps the existing failed peek */
      }
    }
    if (verb === "Skipped") return "Not available in Forge Code.";
    const authoritative =
      (record.execution === "not_executed" ? tool.toolMeta?.reason : tool.toolMeta?.activityEvent?.error) ??
      record.error ??
      null;
    const genericStatus = (value: string | null | undefined) =>
      Boolean(value && /^(completed|failed|error)$/i.test(value.trim()));
    const body = (!genericStatus(authoritative) && authoritative) || tool.content || "(no output yet)";
    if (tone === "fail" && genericStatus(body)) return "Non-zero exit";
    return body;
  }, [tool.content, tool.toolMeta, record, verb, tone]);

  const preview = useMemo(() => {
    if (tool.toolMeta?.detailAvailable === false) return "Details unavailable.";
    const lines = fullOutput.split("\n");
    if (lines.length <= 48) return fullOutput;
    return `${lines.slice(0, 48).join("\n")}\n… (${lines.length - 48} more lines)`;
  }, [fullOutput, tool.toolMeta]);

  const openTarget = useMemo(() => {
    const recordPath = quietActivityPath(record.path) ?? record.path;
    if (recordPath && looksLikePath(recordPath)) return { path: recordPath, line: null as number | null };
    if (looksLikePath(what) || what === VENDOR_SESSION_PLAN_CAPTION) return { path: what, line: null };
    const diag = firstDiagnosticLocation(fullOutput);
    if (diag) return { path: diag.path, line: diag.line };
    return null;
  }, [record.path, what, fullOutput]);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  const onCopy = useCallback(() => {
    void writeClipboard(fullOutput).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [fullOutput]);

  return (
    <div
      className={`rrow-wrap${!done ? " rrow-live" : ""}`}
      data-activity-identity={tool.activityIdentity}
      data-activity-id={tool.toolMeta?.activityId}
    >
      <button
        type="button"
        className="rrow"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="ri" aria-hidden>
          {tone === "pending" ? <span className="tool-spinner" aria-hidden /> : <span className={`ri-dot tone-${tone}`} />}
        </span>
        <span className="verb">{verb}</span>
        <span className="what" title={what}>
          {what}
        </span>
        {tail ? renderTail(verb, tail, tone) : null}
        <span className="chv" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="rout" role="region" aria-label="Receipt output">
          <pre className="rl">{preview}</pre>
          <div className="ra">
            <Button size="sm" onClick={onCopy}>
              {copied ? "Copied" : "Copy output"}
            </Button>
            {openTarget && onOpenPath ? (
              <Button size="sm" onClick={() => onOpenPath(openTarget.path)}>
                {`Open ${openTarget.line != null ? `${openTarget.path}:${openTarget.line}` : openTarget.path}`}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

interface ReceiptsProps {
  tools: ChatMessage[];
  live?: boolean;
  onOpenPath?: (path: string) => void;
  forceOpen?: boolean;
  groupKey?: string;
  /** Real elapsed seconds when the caller has one — omitted (never invented) otherwise. */
  durationSeconds?: number | null;
}

export const Receipts = memo(function Receipts({
  tools,
  live = false,
  onOpenPath,
  forceOpen,
  groupKey,
  durationSeconds,
}: ReceiptsProps) {
  const records = useMemo(() => tools.map(toActivityRecord), [tools]);
  const receipts = useMemo(() => records.map(receiptVerb), [records]);

  const hasFail = receipts.some((r) => r.tone === "fail") || records.some((r) => r.execution === "not_executed");
  const hasPending = receipts.some((r) => r.tone === "pending");
  const isRunSurface = Boolean(groupKey?.startsWith("run-tools:"));

  const [intent, setIntent] = useState<"automatic_open" | "explicit_open" | "explicit_closed">(() => {
    if (groupKey?.startsWith("tools-")) {
      return hasFail ? "automatic_open" : "explicit_closed";
    }
    if (isRunSurface && !live && !hasFail && !hasPending) {
      return "explicit_closed";
    }
    return "automatic_open";
  });
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
      const rows = Array.from(body.querySelectorAll<HTMLElement>("[data-activity-identity]"));
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

  const actionCount = receipts.filter((r) => r.verb !== "Waiting for you").length;
  const durationLabel = formatDuration(durationSeconds);
  const groupStatus = hasFail ? "fail" : hasPending ? "pending" : "ok";
  const panelId = useId();

  return (
    <section
      className={`receipts ${groupStatus}`}
      data-tool-activity
      data-flex-shrink="0"
      aria-label={`${actionCount} action${actionCount === 1 ? "" : "s"}`}
      data-activity-run={groupKey}
    >
      <button
        type="button"
        className="rhead"
        onClick={() => setIntent(open ? "explicit_closed" : "explicit_open")}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="n">{actionCount} action{actionCount === 1 ? "" : "s"}</span>
        {durationLabel ? (
          <>
            <span>·</span>
            <span>{durationLabel}</span>
          </>
        ) : null}
        <span className="spacer" />
        {intent === "automatic_open" && hasPending ? <span className="rhint">Open while tools run</span> : null}
        <span className="chv" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="rbody" role="region" aria-label="Receipt details" tabIndex={0} ref={bodyRef}>
          {tools.map((t, i) => (
            <ReceiptRow
              key={t.id}
              tool={t}
              record={records[i]!}
              receipt={receipts[i]!}
              defaultOpen={receipts[i]!.tone === "fail" || forceOpen === true}
              onOpenPath={onOpenPath}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});
