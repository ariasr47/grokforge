import type { ActivityRecord } from "./runReducer";
import { isForgeUnavailableVendorTool, toolRowCaption } from "./activityLabel";
import { isListAutoExecuted } from "./trustedCommandProvenance";
import { summarizeToolInput } from "./toolFormat";

export type ReceiptVerb =
  | "Read"
  | "Ran"
  | "Edited"
  | "Searched"
  | "Fetched"
  | "Listed"
  | "Skipped"
  | "Waiting for you"
  | "Did";

export type ReceiptTone = "ok" | "fail" | "pending" | "waiting" | "muted";

export interface Receipt {
  verb: ReceiptVerb;
  what: string;
  tail: string;
  tone: ReceiptTone;
}

/** Real exit code from real reported output — never invented. */
function parseExitCode(output: unknown): number | null {
  if (typeof output !== "string" || !output.trim()) return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "exit_code" in parsed) {
      const code = Number(parsed.exit_code);
      return Number.isFinite(code) ? code : null;
    }
  } catch {
    /* non-JSON output: no exit code to read */
  }
  return null;
}

/** Real added/removed line counts parsed from the record's own unified diff. */
function diffLineCounts(diff: string | null | undefined): { added: number; removed: number } | null {
  if (!diff) return null;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return added || removed ? { added, removed } : null;
}

/**
 * A tool call is genuinely blocked on you — not merely in flight — when it
 * isn't eligible for automatic execution, wasn't auto-applied, and hasn't
 * resolved to executed/not_executed yet. A plain in-flight read/list call
 * (eligible, execution still null while the network round-trip settles)
 * stays "pending", never "waiting".
 */
function isPendingDecision(record: ActivityRecord): boolean {
  return (
    record.execution === null &&
    record.status === "running" &&
    record.automaticEligibility === "not_eligible" &&
    record.autoApplied !== true
  );
}

function toneFor(record: ActivityRecord): ReceiptTone {
  if (record.status === "failed") return "fail";
  if (record.status === "rejected" || record.execution === "not_executed") return "muted";
  if (record.lifecycle !== "terminal") return "pending";
  return "ok";
}

function truncateTail(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * Best-effort human "what" from real vouched fields only — never invented.
 * A host-authored title/summary (caption.summary, via toolRowCaption) beats
 * the bare path when both are present — it's strictly more informative
 * ("Reading notes.md" over "notes.md"); the path is still the fallback for
 * the common case where no such summary was reported.
 */
function fallbackWhat(record: ActivityRecord, caption: { name: string; summary: string }): string {
  return (
    caption.summary ||
    record.path ||
    (record.input != null ? summarizeToolInput(record.name ?? "", record.input) : "") ||
    caption.name
  );
}

/**
 * Maps one engine-reported ActivityRecord to the verb/what/tail/tone a
 * receipt row renders. Every tail value is derived from a field the record
 * actually carries (exit code, diff, error, automatic-eligibility) — when
 * that field is absent the tail is omitted rather than guessed (house/guest
 * rule).
 */
export function receiptVerb(record: ActivityRecord): Receipt {
  const name = record.name ?? "";
  const caption = toolRowCaption({
    name: record.name,
    title: record.title,
    summary: record.summary,
    command: record.command,
  });

  if (isForgeUnavailableVendorTool(record.name)) {
    return {
      verb: "Skipped",
      what: fallbackWhat(record, caption),
      tail: "not available in Forge",
      tone: "muted",
    };
  }

  if (isPendingDecision(record)) {
    return {
      verb: "Waiting for you",
      what: record.command ?? fallbackWhat(record, caption),
      tail: "needs approval",
      tone: "waiting",
    };
  }

  const tone = toneFor(record);

  let verb: ReceiptVerb;
  let what: string;
  if (/read|cat|open/i.test(name)) {
    verb = "Read";
    what = fallbackWhat(record, caption);
  } else if (/list|ls|dir/i.test(name)) {
    verb = "Listed";
    what = fallbackWhat(record, caption);
  } else if (/grep|search|find/i.test(name)) {
    verb = "Searched";
    what = fallbackWhat(record, caption);
  } else if (/fetch|http|browse/i.test(name)) {
    verb = "Fetched";
    what = record.url || fallbackWhat(record, caption);
  } else if (/write|edit|patch|create|replace/i.test(name)) {
    verb = "Edited";
    what =
      record.kind === "rename" && record.fromPath && record.toPath
        ? `${record.fromPath} → ${record.toPath}`
        : fallbackWhat(record, caption);
  } else if (caption.plain || /shell|bash|execute|command/i.test(name)) {
    verb = "Ran";
    what = record.command || caption.name || name;
  } else {
    verb = "Did";
    what = fallbackWhat(record, caption);
  }

  const automatic = isListAutoExecuted(record);
  let tail = "";
  if (automatic) {
    tail = "trusted class · no prompt";
  } else if (verb === "Ran") {
    if (tone === "fail") {
      const code = parseExitCode(record.output);
      tail = code != null ? `exit ${code}` : record.error ? truncateTail(record.error) : "";
    } else if (tone === "ok") {
      tail = "clean";
    } else if (tone === "muted" && record.error) {
      tail = truncateTail(record.error);
    }
  } else if (verb === "Edited") {
    const counts = diffLineCounts(record.diff);
    if (counts) {
      const parts: string[] = [];
      if (counts.added) parts.push(`+${counts.added}`);
      if (counts.removed) parts.push(`−${counts.removed}`);
      tail = parts.join(" ");
    }
  } else if (tone === "muted" && record.error) {
    tail = truncateTail(record.error);
  }

  return { verb, what, tail, tone };
}
