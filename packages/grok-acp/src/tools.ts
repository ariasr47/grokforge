import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ExecutionEnvironmentCapability } from "./executionCapability.js";
import { ensureDirForFile, relativeToWorkspace, resolveUnderWorkspace } from "./paths.js";
import { checkShellCommand } from "./shell-policy.js";

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
      description: "Run a shell command with cwd set to the workspace root.",
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
];
export function toolDefinitionsFor(capability: { status: string; displayName?: string | null; dialect?: string | null }) {
  if (!capability) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.map((tool) => tool.function.name === "run_shell" ? { ...tool, function: { ...tool.function, description: capability.status === "available" ? `Run a command using ${capability.displayName} (${capability.dialect}) after approval; cwd is the workspace start. Prefer list_dir, read_file, and grep for ordinary repository work.` : "Shell unavailable. Use list_dir, read_file, and grep for repository work." } } : tool);
}

export type ToolName =
  | "read_file"
  | "list_dir"
  | "grep"
  | "write_file"
  | "apply_patch"
  | "run_shell";

export function toolPermissionKind(
  name: string,
): "read" | "write" | "shell" {
  if (name === "run_shell") return "shell";
  if (name === "write_file" || name === "apply_patch") return "write";
  return "read";
}

export interface PendingEdit {
  id: string;
  path: string;
  absolutePath: string;
  previous: string | null;
  next: string;
  diff: string;
}

function simpleUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
  ];
  for (const line of a) lines.push(`-${line}`);
  for (const line of b) lines.push(`+${line}`);
  return lines.join("\n");
}

/** Minimal unified-diff apply for single-file patches produced by simpleUnifiedDiff or simple hunks. */
export function applyUnifiedDiff(original: string, patch: string): string {
  // Prefer full replacement when patch contains only + lines after headers (from our generator)
  const body = patch.replace(/\r\n/g, "\n");
  const lines = body.split("\n");
  const plus: string[] = [];
  const minus: string[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) plus.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) minus.push(line.slice(1));
    else if (line.startsWith(" ")) {
      plus.push(line.slice(1));
      minus.push(line.slice(1));
    }
  }
  if (plus.length === 0 && minus.length === 0) {
    throw new Error("Empty or unparseable patch");
  }
  // If original matches minus block as whole file, replace with plus
  const origNorm = original.replace(/\r\n/g, "\n");
  const minusText = minus.join("\n");
  if (origNorm === minusText || origNorm === minusText + "\n" || original === "") {
    return plus.join("\n");
  }
  // Fallback: if minus is substring, replace once
  if (minusText && origNorm.includes(minusText)) {
    return origNorm.replace(minusText, plus.join("\n"));
  }
  // Last resort: return plus as full file when original empty
  if (!original) return plus.join("\n");
  throw new Error("Could not apply patch cleanly; use write_file with full content");
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
): Promise<string> {
  switch (name) {
    case "read_file": {
      const abs = resolveUnderWorkspace(workspaceRoot, String(args.path ?? ""));
      const max = Number(args.max_bytes ?? 100_000);
      const buf = await fs.readFile(abs);
      const rel = relativeToWorkspace(workspaceRoot, abs);
      const lower = abs.toLowerCase();
      if (lower.endsWith(".pdf")) {
        return JSON.stringify({
          path: rel,
          bytes: buf.length,
          binary: true,
          error:
            "PDF is binary — text extraction is not available in this tool yet. Ask the user to paste text or export the PDF to .txt/.md.",
          content: "",
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
      const abs = resolveUnderWorkspace(workspaceRoot, String(args.path ?? "."));
      const entries = await fs.readdir(abs, { withFileTypes: true });
      return JSON.stringify({
        path: relativeToWorkspace(workspaceRoot, abs) || ".",
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
        })),
      });
    }
    case "grep": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) throw new Error("pattern required");
      const searchRoot = resolveUnderWorkspace(
        workspaceRoot,
        String(args.path ?? "."),
      );
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
): Promise<PendingEdit> {
  const rel = String(args.path ?? "");
  const abs = resolveUnderWorkspace(workspaceRoot, rel);
  let previous: string | null = null;
  try {
    previous = await fs.readFile(abs, "utf8");
  } catch {
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
    path: displayPath,
    absolutePath: abs,
    previous,
    next,
    diff,
  };
}

export async function applyPendingEdit(edit: PendingEdit): Promise<void> {
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
