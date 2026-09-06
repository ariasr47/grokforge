import { listRichMarkdownSegments, parseMarkdownBlocks } from "../thread/markdownParse";
import { parseRichDocument } from "../thread/richUi";

export const LONG_MARKDOWN_T = 1500;

export type ElevateKind = "none" | "rich-document" | "long-markdown";

export type ElevateResult = {
  kind: ElevateKind;
  /** Bytes the panel should render when kind !== none. */
  body: string | null;
};

function mergeRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function nonFailedRemainder(text: string): string {
  const { lifted, segments } = listRichMarkdownSegments(text);
  // Correlate segments with parseMarkdownBlocks(text) rich blocks in order.
  const blocks = parseMarkdownBlocks(text).filter((b) => b.type === "rich");
  assertSameRichCount(blocks.length, segments.length);
  const failedRanges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const ok = parseRichDocument(seg.code) != null;
    if (!ok) failedRanges.push({ start: seg.start, end: seg.end });
  }
  if (!failedRanges.length) return lifted;
  // Subtract failed ranges from lifted (descending) and collapse leftover blanks.
  let out = lifted;
  for (const r of mergeRanges(failedRanges).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + out.slice(r.end);
  }
  return out.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n{3,}/g, "\n\n");
}

function assertSameRichCount(a: number, b: number): void {
  if (a !== b) {
    // Defensive: span helper drifted from parseMarkdownBlocks grain.
    throw new Error(`rich segment count mismatch: blocks=${a} spans=${b}`);
  }
}

export function elevateArtifact(text: string): ElevateResult {
  if (!text || !text.trim()) return { kind: "none", body: null };

  // Exclusive kind — rich-document wins at any length.
  const blocks = parseMarkdownBlocks(text);
  let anyRich = false;
  for (const b of blocks) {
    if (b.type !== "rich") continue;
    if (parseRichDocument(b.code)) {
      anyRich = true;
      break;
    }
  }
  if (anyRich) return { kind: "rich-document", body: text };

  const remainder = nonFailedRemainder(text);
  if (remainder.length >= LONG_MARKDOWN_T) {
    return { kind: "long-markdown", body: remainder };
  }
  return { kind: "none", body: null };
}

export function isElevatable(text: string): boolean {
  return elevateArtifact(text).kind !== "none";
}
