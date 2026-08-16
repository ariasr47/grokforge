import fs from "node:fs/promises";
import path from "node:path";
import type { ExecutionEnvironmentCapability } from "./executionCapability.js";

export type PreflightDecision =
  | { disposition: "continue" }
  | { disposition: "reject"; reasonCode: "shell_resolution_failed" | "unsupported_platform" | "shell_dialect_incompatible" | "leading_command_unresolved"; reason: string; command: string; shellDisplayName: string | null };

const BUILTINS = new Set(["assoc", "break", "call", "cd", "chcp", "cls", "color", "copy", "date", "del", "dir", "echo", "endlocal", "erase", "exit", "for", "ftype", "goto", "if", "md", "mkdir", "move", "path", "pause", "popd", "prompt", "pushd", "rd", "ren", "rename", "rmdir", "set", "setlocal", "shift", "start", "time", "title", "type", "ver", "verify", "vol"]);

type Scan = { segments: string[]; uncertain: boolean };
function scanCmd(command: string): Scan {
  const segments: string[] = [];
  let current = "";
  let quote = false;
  let uncertain = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (c === "\r" || c === "\n") {
      if (current.trim()) segments.push(current);
      current = "";
      continue;
    }
    if (c === "^") {
      if (i + 1 >= command.length) { uncertain = true; break; }
      current += command[++i];
      continue;
    }
    if (c === '"') { quote = !quote; current += c; continue; }
    if (!quote && (c === "%" || c === "!" || c === "(" || c === ")")) uncertain = true;
    if (!quote && (c === "&" || c === "|")) {
      const next = command[i + 1];
      if ((c === "&" && next === "&") || (c === "|" && next === "|")) i += 1;
      if (!current.trim()) uncertain = true;
      else segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (quote) uncertain = true;
  if (current.trim()) segments.push(current);
  else if (/[&|]\s*$/.test(command)) uncertain = true;
  return { segments, uncertain };
}

function tokens(text: string): { values: string[]; uncertain: boolean } {
  const values: string[] = [];
  let value = "";
  let quote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "^") { if (i + 1 >= text.length) return { values, uncertain: true }; value += text[++i]; continue; }
    if (c === '"') { quote = !quote; continue; }
    if (!quote && /\s/.test(c)) { if (value) { values.push(value); value = ""; } continue; }
    value += c;
  }
  if (quote) return { values, uncertain: true };
  if (value) values.push(value);
  return { values, uncertain: false };
}

function commandAfterAssignments(segment: string): { command: string | null; mismatch: boolean; uncertain: boolean } {
  if (/^\s*"[^"]+"\s*=/.test(segment)) return { command: null, mismatch: false, uncertain: true };
  const parsed = tokens(segment);
  if (parsed.uncertain) return { command: null, mismatch: false, uncertain: true };
  let index = 0;
  let assignments = 0;
  while (index < parsed.values.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parsed.values[index])) { assignments += 1; index += 1; }
  if (assignments > 0 && !parsed.values[index]) return { command: null, mismatch: false, uncertain: true };
  return { command: parsed.values[index] ?? null, mismatch: assignments > 0, uncertain: false };
}

async function existsCandidate(candidate: string, stat: typeof fs.stat): Promise<"found" | "absent" | "uncertain"> {
  try { const info = await stat(candidate); return info.isFile() ? "found" : "absent"; }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "uncertain"; }
}

export async function preflightShell(capability: ExecutionEnvironmentCapability, command: string, deps: { stat?: typeof fs.stat } = {}): Promise<PreflightDecision> {
  if (capability.status === "unavailable") return { disposition: "reject", reasonCode: capability.reasonCode, reason: capability.reason, command, shellDisplayName: null };
  if (capability.dialect !== "cmd") return { disposition: "continue" };
  const scan = scanCmd(command);
  if (scan.uncertain) return { disposition: "continue" };
  let firstCommand: string | null = null;
  for (const segment of scan.segments) {
    const parsed = commandAfterAssignments(segment);
    if (parsed.uncertain) return { disposition: "continue" };
    if (parsed.mismatch) return { disposition: "reject", reasonCode: "shell_dialect_incompatible", reason: "POSIX assignment-prefix syntax is incompatible with cmd.exe.", command, shellDisplayName: capability.displayName };
    if (!firstCommand && parsed.command) firstCommand = parsed.command;
  }
  if (!firstCommand || BUILTINS.has(firstCommand.toLowerCase())) return { disposition: "continue" };

  const stat = deps.stat ?? fs.stat;
  const candidates: string[] = [];
  const qualified = path.isAbsolute(firstCommand) || firstCommand.includes("\\") || firstCommand.includes("/");
  if (qualified) candidates.push(path.isAbsolute(firstCommand) ? firstCommand : path.resolve(capability.workspaceRoot, firstCommand));
  else {
    candidates.push(path.join(capability.workspaceRoot, firstCommand));
    const key = Object.keys(capability.effectiveEnvironment).find((k) => k.toLowerCase() === "path");
    const extKey = Object.keys(capability.effectiveEnvironment).find((k) => k.toLowerCase() === "pathext");
    const pathEntries = key ? capability.effectiveEnvironment[key].split(";") : [];
    for (const entry of pathEntries) {
      if (!entry) continue;
      if (!path.isAbsolute(entry)) return { disposition: "continue" };
      candidates.push(path.join(entry, firstCommand));
    }
    if (!path.extname(firstCommand)) {
      const extensions = extKey ? capability.effectiveEnvironment[extKey].split(";").filter(Boolean) : [];
      for (const extension of extensions) for (const candidate of [...candidates]) candidates.push(candidate + extension);
    }
  }
  for (const candidate of candidates) {
    const result = await existsCandidate(candidate, stat);
    if (result === "found") return { disposition: "continue" };
    if (result === "uncertain") return { disposition: "continue" };
  }
  return { disposition: "reject", reasonCode: "leading_command_unresolved", reason: `Command not found: ${firstCommand}`, command, shellDisplayName: capability.displayName };
}
