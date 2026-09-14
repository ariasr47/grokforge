import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractPdfText, PDF_SOURCE_MAX_BYTES } from "@grokforge/pdf-extract";
import type { ExecutionEnvironmentCapability } from "./executionCapability.js";
import { ensureDirForFile, relativeToWorkspace, resolveUnderWorkspace } from "./paths.js";
import { checkShellCommand } from "./shell-policy.js";

export const READ_FILE_EMIT_MAX_UTF8 = 100_000;
export const TOOL_RESULT_CONTEXT_MAX = READ_FILE_EMIT_MAX_UTF8;
export const TOOL_RESULT_TRUNCATION_MARK = "\n…[truncated for context]";

/** Cap a tool result before it is pushed into the model transcript. */
export function capToolResultForContext(
  toolResult: string,
  max = TOOL_RESULT_CONTEXT_MAX,
): string {
  if (toolResult.length <= max) return toolResult;
  return toolResult.slice(0, max) + TOOL_RESULT_TRUNCATION_MARK;
}

/** Cap emitted extract text for read_file (UTF-8 bytes). */
export function capReadFileEmittedText(
  text: string,
  maxUtf8 = READ_FILE_EMIT_MAX_UTF8,
): { content: string; truncated: boolean; bytes: number } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxUtf8) {
    return { content: text, truncated: false, bytes: buf.length };
  }
  let end = maxUtf8;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const content = buf.subarray(0, end).toString("utf8");
  return { content, truncated: true, bytes: Buffer.byteLength(content, "utf8") };
}

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file under the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          max_bytes: {
            type: "number",
            description: "Max bytes to return (default 100000)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_dir",
      description: "List files and directories under a workspace path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (default .)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description: "Search file contents for a regex/string under the workspace.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Subdirectory or file to search" },
          glob: { type: "string", description: "Optional filename filter e.g. *.ts" },
          max_matches: { type: "number" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Propose writing full UTF-8 content to a file (staged until user accepts the diff).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apply_patch",
      description:
        "Propose a unified diff patch against an existing file (staged until accept).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          patch: { type: "string", description: "Unified diff body" },
        },
        required: ["path", "patch"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_shell",
      description: "Run a shell command with cwd set to the workspace root. To test one package, cd into it first (or npm test -w name).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete one confined regular UTF-8 text file under the workspace (staged until accept in Review; auto in Trusted).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "rename_file",
      description: "Rename/move one confined regular UTF-8 text file within the workspace (staged until accept in Review; auto in Trusted).",
      parameters: {
        type: "object",
        properties: {
          fromPath: { type: "string" },
          toPath: { type: "string" },
        },
        required: ["fromPath", "toPath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ask_user",
      description:
        "Ask the operator a multiple-choice question and wait for their click on the Gate. Use when two implementations are mutually exclusive and you must not pick yourself. Do not write the question into the transcript instead of calling this tool.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question shown on the Gate" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Two or more mutually exclusive choices, in click order",
          },
        },
        required: ["question", "options"],
      },
    },
  },
];
export function toolDefinitionsFor(capability: { status: string; displayName?: string | null; dialect?: string | null }) {
  if (!capability) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.map((tool) => tool.function.name === "run_shell" ? { ...tool, function: { ...tool.function, description: capability.status === "available" ? `Run a command using ${capability.displayName} (${capability.dialect}) after approval; cwd is the workspace start. To test one package, cd into it first (or npm test -w name). Prefer list_dir, read_file, and grep for ordinary repository work.` : "Shell unavailable. Use list_dir, read_file, and grep for repository work." } } : tool);
}

export type ToolName =
  | "read_file"
  | "list_dir"
  | "grep"
  | "write_file"
  | "apply_patch"
  | "run_shell"
  | "delete_file"
  | "rename_file"
  | "ask_user";

export type MutationKind = "content" | "delete" | "rename";

export function toolPermissionKind(
  name: string,
): "read" | "write" | "shell" | "ask" {
  if (name === "ask_user") return "ask";
  if (name === "run_shell") return "shell";
  if (
    name === "write_file" ||
    name === "apply_patch" ||
    name === "delete_file" ||
    name === "rename_file"
  ) {
    return "write";
  }
  return "read";
}

export interface PendingEdit {
  id: string;
  kind: MutationKind;
  /** Display / binding path: delete+content target; rename pending binds fromPath. */
  path: string;
  absolutePath: string;
  fromPath?: string;
  toPath?: string;
  absoluteFromPath?: string;
  absoluteToPath?: string;
  previous: string | null;
  next: string;
  diff: string | null;
}

type EditOp = { kind: "eq" | "del" | "add"; text: string };

const DIFF_CONTEXT = 3;
const LCS_MAX_CELLS = 2_000_000;

function lcsEdit(before: string[], after: string[]): EditOp[] {
  const n = before.length;
  const m = after.length;
  if (n === 0) return after.map((text) => ({ kind: "add" as const, text }));
  if (m === 0) return before.map((text) => ({ kind: "del" as const, text }));
  if (n * m > LCS_MAX_CELLS) {
    return [
      ...before.map((text) => ({ kind: "del" as const, text })),
      ...after.map((text) => ({ kind: "add" as const, text })),
    ];
  }
  const dp: number[][] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Array<number>(m + 1).fill(0);
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

function shortestEdit(before: string[], after: string[]): EditOp[] {
  let start = 0;
  const n = before.length;
  const m = after.length;
  while (start < n && start < m && before[start] === after[start]) start += 1;
  let endBefore = n;
  let endAfter = m;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const prefix: EditOp[] = before.slice(0, start).map((text) => ({ kind: "eq" as const, text }));
  const suffix: EditOp[] = before.slice(endBefore).map((text) => ({ kind: "eq" as const, text }));
  const mid = lcsEdit(before.slice(start, endBefore), after.slice(start, endAfter));
  return [...prefix, ...mid, ...suffix];
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

function simpleUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const headers = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const hunks = emitHunks(shortestEdit(a, b), DIFF_CONTEXT);
  if (hunks.length === 0) return `${headers.join("\n")}\n`;
  const body = [...headers, ...hunks].join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

type PatchHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  oldLines: string[];
  newLines: string[];
};

function splitKeepNl(text: string): { lines: string[]; trailingNl: boolean } {
  if (text === "") return { lines: [], trailingNl: false };
  const trailingNl = text.endsWith("\n");
  const body = trailingNl ? text.slice(0, -1) : text;
  return { lines: body.split("\n"), trailingNl };
}

function joinKeepNl(lines: string[], trailingNl: boolean): string {
  if (lines.length === 0) return trailingNl ? "\n" : "";
  return `${lines.join("\n")}${trailingNl ? "\n" : ""}`;
}

function findLineSequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function parseUnifiedHunks(patch: string): PatchHunk[] {
  const body = patch.replace(/\r\n/g, "\n");
  // A patch that ends with \n must not grow a phantom blank context line.
  const { lines } = splitKeepNl(body);
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | null = null;
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        oldLines: [],
        newLines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("***")) continue;
    if (line.startsWith("diff ") || line.startsWith("index ")) continue;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.newLines.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) current.oldLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      current.oldLines.push(line.slice(1));
      current.newLines.push(line.slice(1));
    } else if (line === "") {
      // Models often omit the leading space on blank context lines.
      current.oldLines.push("");
      current.newLines.push("");
    } else {
      // Models often omit the leading space on every context line.
      current.oldLines.push(line);
      current.newLines.push(line);
    }
  }
  return hunks;
}

function quoteHunkLine(text: string, other: string): string {
  if (text.length === 0) return "(blank line)";
  if (text.length <= 240) return JSON.stringify(text);
  let i = 0;
  const n = Math.min(text.length, other.length);
  while (i < n && text[i] === other[i]) i++;
  const from = Math.max(0, i - 40);
  const to = Math.min(text.length, i + 80);
  return JSON.stringify(`${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`);
}

function walkHunkMismatch(
  work: string[],
  oldLines: string[],
  start: number,
): { lineNo: number; got: string; want: string } {
  let off = 0;
  while (off < oldLines.length && (work[start + off] ?? "") === (oldLines[off] ?? "")) {
    off++;
  }
  return {
    lineNo: start + off + 1,
    got: work[start + off] ?? "",
    want: oldLines[off] ?? "",
  };
}

function describeHunkFail(work: string[], hunk: PatchHunk, at: number): string {
  const header = `Could not apply patch hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@.`;
  const firstWant = hunk.oldLines[0] ?? "";
  const found0 = firstWant.length > 0 ? work.indexOf(firstWant) : -1;
  if (found0 >= 0 && found0 !== at) {
    const w = walkHunkMismatch(work, hunk.oldLines, found0);
    return `${header} context not found as a block; first expected line at file line ${found0 + 1}. file line ${w.lineNo}: ${quoteHunkLine(w.got, w.want)}; patch expected: ${quoteHunkLine(w.want, w.got)}`;
  }
  const w = walkHunkMismatch(work, hunk.oldLines, at);
  const missing = found0 < 0 && firstWant.length > 0 ? " first expected line not in file." : "";
  return `${header} file line ${w.lineNo}: ${quoteHunkLine(w.got, w.want)}; patch expected: ${quoteHunkLine(w.want, w.got)}${missing}`;
}

/** Apply a unified diff hunk-by-hunk. Does not steer write_file on failure. */
export function applyUnifiedDiff(original: string, patch: string): string {
  const hunks = parseUnifiedHunks(patch);
  if (hunks.length === 0) {
    const first =
      patch
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .find(
          (line) =>
            line.length > 0 &&
            !line.startsWith("diff ") &&
            !line.startsWith("index ") &&
            !line.startsWith("--- ") &&
            !line.startsWith("+++ ") &&
            !line.startsWith("***"),
        ) ?? "";
    throw new Error(
      `Empty or unparseable patch (no @@ hunk); first line: ${JSON.stringify(first.slice(0, 240))}`,
    );
  }
  const origNorm = original.replace(/\r\n/g, "\n");
  const { lines, trailingNl } = splitKeepNl(origNorm);
  const work = [...lines];
  const ordered = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of ordered) {
    const at = hunk.oldCount === 0 ? Math.max(0, hunk.oldStart) : hunk.oldStart - 1;
    const exact =
      hunk.oldLines.length === 0
        ? at
        : work.slice(at, at + hunk.oldLines.length).join("\n") === hunk.oldLines.join("\n")
          ? at
          : -1;
    const idx = exact >= 0 ? exact : findLineSequence(work, hunk.oldLines);
    if (idx < 0) {
      throw new Error(describeHunkFail(work, hunk, at));
    }
    work.splice(idx, hunk.oldLines.length, ...hunk.newLines);
  }
  return joinKeepNl(work, trailingNl);
}

async function walkFiles(
  dir: string,
  root: string,
  out: string[],
  maxFiles: number,
): Promise<void> {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= maxFiles) return;
    const name = ent.name;
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".spire") {
      continue;
    }
    const full = path.join(dir, name);
    if (ent.isDirectory()) {
      await walkFiles(full, root, out, maxFiles);
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
}

function matchGlob(fileName: string, glob?: string): boolean {
  if (!glob) return true;
  // very small glob: *.ext or exact
  if (glob.startsWith("*.")) {
    return fileName.endsWith(glob.slice(1));
  }
  return fileName === glob || fileName.includes(glob);
}

export async function executeReadTool(
  workspaceRoot: string,
  name: ToolName,
  args: Record<string, unknown>,
  allowOutside = false,
): Promise<string> {
  const resolveReadPath = (value: string) => allowOutside
    ? path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value || ".")
    : resolveUnderWorkspace(workspaceRoot, value);
  switch (name) {
    case "read_file": {
      const abs = resolveReadPath(String(args.path ?? ""));
      const max = Number(args.max_bytes ?? 100_000);
      const buf = await fs.readFile(abs);
      const rel = relativeToWorkspace(workspaceRoot, abs);
      const lower = abs.toLowerCase();
      if (lower.endsWith(".pdf")) {
        if (buf.length > PDF_SOURCE_MAX_BYTES) {
          const error = `Couldn't extract text from ${rel}.`;
          return JSON.stringify({
            path: rel,
            bytes: 0,
            content: "",
            extract_failed: true,
            extract_failure_class: "unreadable",
            error,
          });
        }
        const outcome = await extractPdfText(new Uint8Array(buf));
        if (outcome.kind === "extract_failed") {
          const error = `Couldn't extract text from ${rel}.`;
          return JSON.stringify({
            path: rel,
            bytes: 0,
            content: "",
            extract_failed: true,
            extract_failure_class: outcome.class,
            error,
          });
        }
        const capped = capReadFileEmittedText(outcome.text);
        return JSON.stringify({
          path: rel,
          bytes: capped.bytes,
          truncated: capped.truncated,
          content: capped.content,
        });
      }
      // Null-byte sniff for other binaries
      const sample = buf.subarray(0, Math.min(buf.length, 8192));
      if (sample.includes(0)) {
        return JSON.stringify({
          path: rel,
          bytes: buf.length,
          binary: true,
          error:
            "File looks binary (not UTF-8 text). Ask for a text export or paste content into chat.",
          content: "",
        });
      }
      const slice = buf.subarray(0, max);
      const text = slice.toString("utf8");
      const truncated = buf.length > max;
      return JSON.stringify({
        path: rel,
        bytes: buf.length,
        truncated,
        content: text,
      });
    }
    case "list_dir": {
      const abs = resolveReadPath(String(args.path ?? "."));
      const rel = relativeToWorkspace(workspaceRoot, abs) || ".";
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        return JSON.stringify({
          path: rel,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
          })),
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return JSON.stringify({ path: rel, entries: [], missing: true });
        }
        throw error;
      }
    }
    case "grep": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) throw new Error("pattern required");
      const searchRoot = resolveReadPath(String(args.path ?? "."));
      const glob = args.glob ? String(args.glob) : undefined;
      const maxMatches = Number(args.max_matches ?? 50);
      let re: RegExp;
      try {
        re = new RegExp(pattern, "i");
      } catch {
        re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }
      const files: string[] = [];
      const st = await fs.stat(searchRoot);
      if (st.isFile()) files.push(searchRoot);
      else await walkFiles(searchRoot, workspaceRoot, files, 1200);

      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (matches.length >= maxMatches) break;
        if (!matchGlob(path.basename(file), glob)) continue;
        let content: string;
        try {
          content = await fs.readFile(file, "utf8");
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxMatches) break;
          if (re.test(lines[i]!)) {
            matches.push({
              path: relativeToWorkspace(workspaceRoot, file),
              line: i + 1,
              text: lines[i]!.slice(0, 400),
            });
          }
        }
      }
      return JSON.stringify({ pattern, matches, count: matches.length });
    }
    default:
      throw new Error(`Not a read tool: ${name}`);
  }
}

export async function prepareWriteEdit(
  workspaceRoot: string,
  name: "write_file" | "apply_patch",
  args: Record<string, unknown>,
  editId: string,
  allowOutside = false,
): Promise<PendingEdit> {
  const rel = String(args.path ?? "");
  const abs = allowOutside
    ? path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(workspaceRoot, rel)
    : resolveUnderWorkspace(workspaceRoot, rel);
  let previous: string | null = null;
  try {
    previous = await fs.readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    previous = null;
  }
  let next: string;
  if (name === "write_file") {
    next = String(args.content ?? "");
  } else {
    next = applyUnifiedDiff(previous ?? "", String(args.patch ?? ""));
  }
  const displayPath = relativeToWorkspace(workspaceRoot, abs) || rel;
  const diff = simpleUnifiedDiff(displayPath, previous ?? "", next);
  return {
    id: editId,
    kind: "content",
    path: displayPath,
    absolutePath: abs,
    previous,
    next,
    diff,
  };
}

async function assertRegularTextFile(abs: string): Promise<string> {
  let st;
  try {
    st = await fs.lstat(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error("missing_target"), { code: "missing_target" });
    }
    throw e;
  }
  if (!st.isFile() || st.isSymbolicLink() === true) {
    throw Object.assign(new Error("non_regular_file"), { code: "non_regular_file" });
  }
  const body = await fs.readFile(abs);
  if (body.includes(0)) {
    throw Object.assign(new Error("non_regular_text"), { code: "non_regular_text" });
  }
  return body.toString("utf8");
}

function isCaseOnlyRename(fromRel: string, toRel: string): boolean {
  return fromRel !== toRel && fromRel.toLowerCase() === toRel.toLowerCase();
}

export async function prepareDeleteEdit(
  workspaceRoot: string,
  args: Record<string, unknown>,
  editId: string,
  allowOutside = false,
): Promise<PendingEdit> {
  const rel = String(args.path ?? "");
  const abs = allowOutside
    ? path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(workspaceRoot, rel)
    : resolveUnderWorkspace(workspaceRoot, rel);
  const previous = await assertRegularTextFile(abs);
  const displayPath = relativeToWorkspace(workspaceRoot, abs) || rel;
  return {
    id: editId,
    kind: "delete",
    path: displayPath,
    absolutePath: abs,
    previous,
    next: "",
    diff: null,
  };
}

export async function prepareRenameEdit(
  workspaceRoot: string,
  args: Record<string, unknown>,
  editId: string,
  allowOutside = false,
): Promise<PendingEdit> {
  const fromRel = String(args.fromPath ?? "");
  const toRel = String(args.toPath ?? "");
  const resolve = (rel: string) =>
    allowOutside
      ? path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(workspaceRoot, rel)
      : resolveUnderWorkspace(workspaceRoot, rel);
  const fromAbs = resolve(fromRel);
  const toAbs = resolve(toRel);
  const previous = await assertRegularTextFile(fromAbs);
  const caseOnly = isCaseOnlyRename(
    relativeToWorkspace(workspaceRoot, fromAbs) || fromRel,
    relativeToWorkspace(workspaceRoot, toAbs) || toRel,
  );
  const destExists = await fs.stat(toAbs).then(() => true, () => false);
  if (destExists && !caseOnly) {
    throw Object.assign(new Error("dest_exists"), { code: "dest_exists" });
  }
  const fromPath = relativeToWorkspace(workspaceRoot, fromAbs) || fromRel;
  const toPath = relativeToWorkspace(workspaceRoot, toAbs) || toRel;
  return {
    id: editId,
    kind: "rename",
    path: fromPath,
    absolutePath: fromAbs,
    fromPath,
    toPath,
    absoluteFromPath: fromAbs,
    absoluteToPath: toAbs,
    previous,
    next: previous,
    diff: null,
  };
}

export async function applyPendingEdit(edit: PendingEdit): Promise<void> {
  if (edit.kind === "delete") {
    await fs.unlink(edit.absolutePath);
    return;
  }
  if (edit.kind === "rename") {
    await fs.rename(edit.absoluteFromPath!, edit.absoluteToPath!);
    return;
  }
  ensureDirForFile(edit.absolutePath);
  await fs.writeFile(edit.absolutePath, edit.next, "utf8");
}

export async function runShell(
  capability: ExecutionEnvironmentCapability,
  command: string,
  timeoutMs = 60_000,
  options?: { enforceAllowlist?: boolean },
): Promise<string> {
  const root = path.resolve(capability.workspaceRoot);
  const policy = checkShellCommand(command, {
    timeoutMs,
    enforceAllowlist: options?.enforceAllowlist,
  });
  if (!policy.ok) {
    return JSON.stringify({
      blocked: true,
      error: policy.reason,
      exit_code: null,
      stdout: "",
      stderr: policy.reason,
      cwd: root,
      timeout_ms: policy.timeoutMs,
    });
  }

  const limit = policy.timeoutMs;
  return new Promise((resolve, reject) => {
    if (capability.status !== "available") {
      resolve(JSON.stringify({ blocked:true, error:capability.reason, exit_code:null, stdout:"", stderr:capability.reason, cwd:root, timeout_ms:limit }));
      return;
    }
    const child = spawn(capability.executable, [...capability.argvPrefix, command], {
      cwd: root,
      shell: false,
      env: capability.effectiveEnvironment,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      killTimer = setTimeout(() => {
        killTimer = null;
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000);
    }, limit);
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
      if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000) + "\n…truncated";
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
      if (stderr.length > 100_000) stderr = stderr.slice(0, 100_000) + "\n…truncated";
    });
    child.on("error", (err) => {
      clearTimers();
      reject(err);
    });
    child.on("close", (code) => {
      clearTimers();
      if (timedOut) {
        resolve(
          JSON.stringify({
            exit_code: code,
            timed_out: true,
            error: `Command timed out after ${limit}ms`,
            stdout,
            stderr: stderr || `timed out after ${limit}ms`,
            cwd: root,
            timeout_ms: limit,
          }),
        );
        return;
      }
      resolve(
        JSON.stringify({
          exit_code: code,
          timed_out: false,
          stdout,
          stderr,
          cwd: root,
          timeout_ms: limit,
        }),
      );
    });
  });
}
