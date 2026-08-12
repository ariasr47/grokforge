/**
 * Safer shell policy: deny destructive patterns; optional allowlist prefixes.
 */

export interface ShellPolicyResult {
  ok: boolean;
  reason?: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 5 * 60_000;

/** Always-denied command patterns (case-insensitive). */
const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/i,
  /\brm\s+-rf\s+[\/\\]/i,
  /\brm\s+-fr\s+[\/\\]/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|poweroff)\b/i,
  // PowerShell wipe: either flag order
  /\bRemove-Item\b[\s\S]*(-Recurse[\s\S]*-Force|-Force[\s\S]*-Recurse)/i,
  /\bdel\s+(\/[a-z]+\s+)*\/s\b.*\/q\b/i,
  /\brd\s+\/s\b.*\/q\b/i,
  /\brmdir\s+\/s\b.*\/q\b/i,
  /\b(diskpart|cipher\s+\/w)\b/i,
  /\breg\s+delete\b/i,
  /\b(curl|wget|Invoke-WebRequest).*\|\s*(sh|bash|powershell|cmd|pwsh)/i,
  /\b:(){ :\|:& };:/, // fork bomb
  /\bchmod\s+-R\s+777\s+\//i,
];

/**
 * Optional allowlist: if non-empty, command must match at least one prefix
 * (after trim). Empty = allow anything not denied.
 */
export const DEFAULT_ALLOW_PREFIXES = [
  "npm ",
  "npm.cmd ",
  "npx ",
  "node ",
  "pnpm ",
  "yarn ",
  "git ",
  "cargo ",
  "rustc ",
  "python ",
  "python3 ",
  "py ",
  "go ",
  "dotnet ",
  "tsc ",
  "vitest ",
  "jest ",
  "eslint ",
  "prettier ",
  "dir ",
  "ls ",
  "Get-ChildItem",
  "Get-Content",
  "type ",
  "cat ",
  "echo ",
  "where ",
  "which ",
  "cmd /c ",
  "cmd.exe /c ",
  "pwsh ",
  "pwsh.exe ",
  "powershell ",
  "powershell.exe ",
  "rg ",
  "fd ",
  "cargo test",
  "cargo check",
  "cargo build",
  "npm run ",
  "npm.cmd run ",
];

export function checkShellCommand(
  command: string,
  options?: {
    allowPrefixes?: string[] | null;
    timeoutMs?: number;
    /** When true, enforce DEFAULT_ALLOW_PREFIXES (or provided list). */
    enforceAllowlist?: boolean;
  },
): ShellPolicyResult {
  const cmd = String(command ?? "").trim();
  const timeoutMs = Math.min(
    Math.max(1_000, Number(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );

  if (!cmd) {
    return { ok: false, reason: "Empty command", timeoutMs };
  }
  if (cmd.length > 8_000) {
    return { ok: false, reason: "Command too long", timeoutMs };
  }

  for (const re of DENY_PATTERNS) {
    if (re.test(cmd)) {
      return {
        ok: false,
        reason: `Blocked by safety policy (matched ${re.source})`,
        timeoutMs,
      };
    }
  }

  const enforce = options?.enforceAllowlist !== false;
  const prefixes =
    options?.allowPrefixes === null
      ? null
      : options?.allowPrefixes ?? DEFAULT_ALLOW_PREFIXES;

  if (enforce && prefixes && prefixes.length > 0) {
    const lower = cmd.toLowerCase();
    const ok = prefixes.some((p) => lower.startsWith(p.toLowerCase()));
    if (!ok) {
      return {
        ok: false,
        reason:
          `Command not on allowlist. Allowed prefixes: ${prefixes.slice(0, 12).join(", ")}… ` +
          `(set enforceAllowlist false in host config to loosen)`,
        timeoutMs,
      };
    }
  }

  return { ok: true, timeoutMs };
}
