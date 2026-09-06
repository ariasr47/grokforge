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
  const lines = unifiedDiffLines(diff).filter(
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

/** Added/removed line counts across a whole unified diff — the `±` stat. */
export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unifiedDiffLines(diff)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
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
  const rawLines = unifiedDiffLines(diff);
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
