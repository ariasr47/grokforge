/** Line class for the existing colorized unified-diff treatment. */
export function unifiedDiffLineClass(line: string): string {
  let cls = "diff-line";
  if (line.startsWith("+") && !line.startsWith("+++")) cls += " plus";
  else if (line.startsWith("-") && !line.startsWith("---")) cls += " minus";
  else if (line.startsWith("@@")) cls += " hunk";
  else if (line.startsWith("diff ") || line.startsWith("---") || line.startsWith("+++")) cls += " meta";
  return cls;
}

export function unifiedDiffLines(diff: string): string[] {
  return diff.replace(/\r\n/g, "\n").split("\n");
}

/** File changes already names the path — drop redundant --- / +++ headers. */
export function fileChangesDiffLines(diff: string): string[] {
  const lines = unifiedDiffLines(compactUnifiedDiff(diff)).filter(
    (line) => !line.startsWith("---") && !line.startsWith("+++"),
  );
  const hunks = lines.filter((line) => line.startsWith("@@"));
  const changed = lines.filter(
    (line) =>
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---")),
  ).length;
  // Tiny one-hunk writes (KEEP overwrites, new one-liners) don't need @@.
  if (hunks.length <= 1 && changed <= 12) {
    return lines.filter((line) => !line.startsWith("@@"));
  }
  return lines;
}

function countDiffLinesRaw(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unifiedDiffLines(diff)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

/** Added/removed line counts across a whole unified diff — the `±` stat.
 *  Whole-file `write_file` rewrites (every line deleted then added, no
 *  context) are compacted first so a 1-line insert is +1 −0, not +N −N. */
export function countDiffLines(diff: string): { added: number; removed: number } {
  return countDiffLinesRaw(compactUnifiedDiff(diff));
}

export type DiffHunkLineKind = "add" | "del" | "context";

export interface DiffHunkLine {
  kind: DiffHunkLineKind;
  /** Line number in the relevant file — new-file number for context/add, old-file number for del. */
  no: number;
  /** Add/del lines keep their leading +/- marker (matches the design
   *  reference — color alone shouldn't carry the meaning); context lines
   *  have their leading space marker stripped. */
  text: string;
}

export interface DiffHunk {
  /** Raw "@@ -a,b +c,d @@" range text; "" when the diff has no hunk header (tiny one-hunk write). */
  range: string;
  /** Trailing function/section context after the closing @@, "" when absent. */
  context: string;
  lines: DiffHunkLine[];
}

const HUNK_HEADER_RE = /^(@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@)[ \t]*(.*)$/;

/** Split a unified diff into its hunks, numbering each line from the hunk's own header —
 *  new-file numbering for context/add lines, old-file numbering for del lines. Diffs with
 *  no `@@` header (tiny one-hunk writes — see `fileChangesDiffLines`) fold into one
 *  synthetic hunk numbered from 1 so a preview still has something to show. */
export function splitDiffHunks(diff: string): DiffHunk[] {
  const rawLines = unifiedDiffLines(compactUnifiedDiff(diff));
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 1;
  let newLine = 1;
  for (const raw of rawLines) {
    const header = HUNK_HEADER_RE.exec(raw);
    if (header) {
      oldLine = Number(header[2]);
      newLine = Number(header[3]);
      current = { range: header[1]!, context: (header[4] || "").trim(), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      // Keeps the leading "+" in the text (matches the design reference) —
      // color alone shouldn't be the only signal a line was added/removed.
      current.lines.push({ kind: "add", no: newLine, text: raw });
      newLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.lines.push({ kind: "del", no: oldLine, text: raw });
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", no: newLine, text: raw.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else if (raw.length > 0) {
      current.lines.push({ kind: "context", no: newLine, text: raw });
      oldLine += 1;
      newLine += 1;
    }
  }
  if (hunks.length === 0) {
    const body = rawLines.filter((line) => !line.startsWith("---") && !line.startsWith("+++"));
    const lines: DiffHunkLine[] = [];
    let n = 1;
    for (const raw of body) {
      if (!raw) continue;
      if (raw.startsWith("+")) lines.push({ kind: "add", no: n, text: raw });
      else if (raw.startsWith("-")) lines.push({ kind: "del", no: n, text: raw });
      else lines.push({ kind: "context", no: n, text: raw });
      n += 1;
    }
    if (lines.length) hunks.push({ range: "", context: "", lines });
  }
  return hunks;
}

/** Split a simple unified diff into before/after line lists for side-by-side. */
export function splitUnifiedDiff(diff: string): {
  before: string[];
  after: string[];
  header: string[];
} {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const header: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      header.push(line);
      if (line.startsWith("@@")) inHunk = true;
      continue;
    }
    if (!inHunk) {
      header.push(line);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      before.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    } else if (line.length) {
      after.push(line);
    }
  }
  return { before, after, header };
}

const COMPACT_CONTEXT = 3;
const COMPACT_MAX_CELLS = 1_500_000;

type EditOp = { kind: "eq" | "del" | "add"; text: string };

function hasHunkContext(diff: string): boolean {
  return unifiedDiffLines(diff).some((line) => line.startsWith(" "));
}

function shortestEdit(before: string[], after: string[]): EditOp[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array<number>(m + 1).fill(0);
  }
  for (let i = 1; i <= n; i++) {
    const bi = before[i - 1];
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= m; j++) {
      row[j] = bi === after[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    }
  }
  const ops: EditOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      ops.push({ kind: "eq", text: before[i - 1]! });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      ops.push({ kind: "del", text: before[i - 1]! });
      i -= 1;
    } else {
      ops.push({ kind: "add", text: after[j - 1]! });
      j -= 1;
    }
  }
  while (i > 0) {
    ops.push({ kind: "del", text: before[i - 1]! });
    i -= 1;
  }
  while (j > 0) {
    ops.push({ kind: "add", text: after[j - 1]! });
    j -= 1;
  }
  ops.reverse();
  return ops;
}

function emitHunks(ops: EditOp[], context: number): string[] {
  type Numbered = EditOp & { oldLine: number; newLine: number };
  const numbered: Numbered[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    numbered.push({ ...op, oldLine, newLine });
    if (op.kind === "eq") {
      oldLine += 1;
      newLine += 1;
    } else if (op.kind === "del") {
      oldLine += 1;
    } else {
      newLine += 1;
    }
  }
  const changeIdx: number[] = [];
  for (let i = 0; i < numbered.length; i++) {
    if (numbered[i]!.kind !== "eq") changeIdx.push(i);
  }
  if (changeIdx.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(numbered.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }
  const out: string[] = [];
  for (const [s, e] of ranges) {
    const slice = numbered.slice(s, e + 1);
    const oldCount = slice.filter((x) => x.kind !== "add").length;
    const newCount = slice.filter((x) => x.kind !== "del").length;
    const oldStart = oldCount === 0 ? 0 : slice.find((x) => x.kind !== "add")!.oldLine;
    const newStart = newCount === 0 ? 0 : slice.find((x) => x.kind !== "del")!.newLine;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const x of slice) {
      if (x.kind === "eq") out.push(` ${x.text}`);
      else if (x.kind === "del") out.push(`-${x.text}`);
      else out.push(`+${x.text}`);
    }
  }
  return out;
}

/** Collapse a whole-file rewrite (every line deleted then added, no context)
 *  into a reviewable unified diff. Identity when the diff already has context
 *  lines, is a true rewrite, or is too large to LCS. */
export function compactUnifiedDiff(diff: string, context = COMPACT_CONTEXT): string {
  if (!diff) return diff;
  if (hasHunkContext(diff)) return diff;
  const { before, after, header } = splitUnifiedDiff(diff);
  if (before.length === 0 && after.length === 0) return diff;
  if (before.length * after.length > COMPACT_MAX_CELLS) return diff;
  const raw = countDiffLinesRaw(diff);
  if (raw.added + raw.removed === 0) return diff;
  const ops = shortestEdit(before, after);
  const changed = ops.reduce((n, op) => n + (op.kind === "eq" ? 0 : 1), 0);
  if (changed >= raw.added + raw.removed) return diff;
  const fileHeaders = header.filter((h) => h.startsWith("---") || h.startsWith("+++"));
  const hunks = emitHunks(ops, context);
  if (hunks.length === 0) return diff;
  const body = [...fileHeaders, ...hunks].join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}
