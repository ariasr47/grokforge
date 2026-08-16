import type { HostExecutionProfile } from "@grokforge/acp-client";
export type ExecutionEnvironmentCapability = HostExecutionProfile & { workspaceRoot: string; structuredRepositoryTools: readonly ["list_dir", "read_file", "grep"]; effectiveEnvironment: Readonly<Record<string,string>> };
export function isHostExecutionProfile(value: unknown): value is HostExecutionProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  const syntax = p.syntax as Record<string, unknown> | null;
  const syntaxOk = !!syntax && typeof syntax.quoting === "string" && typeof syntax.chaining === "string" && typeof syntax.redirection === "string";
  if (p.status === "available") {
    if (typeof p.platform !== "string" || typeof p.executable !== "string" || !/^([A-Za-z]:[\\/]|\/)/.test(p.executable) || !Array.isArray(p.argvPrefix) || typeof p.displayName !== "string" || !syntaxOk) return false;
    if (p.osFamily === "windows") return p.dialect === "cmd" && p.pathSeparator === "\\" && p.argvPrefix.length === 3 && p.argvPrefix[0] === "/d" && p.argvPrefix[1] === "/s" && p.argvPrefix[2] === "/c";
    return (p.osFamily === "macos" || p.osFamily === "linux") && p.dialect === "posix" && p.pathSeparator === "/" && p.argvPrefix.length === 1 && p.argvPrefix[0] === "-c";
  }
  if (p.status === "unavailable") return typeof p.platform === "string" && p.executable === null && Array.isArray(p.argvPrefix) && p.argvPrefix.length === 0 && p.displayName === null && p.dialect === null && p.pathSeparator === (p.osFamily === "windows" ? "\\" : "/") && p.syntax === null && (p.reasonCode === "shell_resolution_failed" || p.reasonCode === "unsupported_platform") && typeof p.reason === "string" && !!p.reason;
  return false;
}
export function bindExecutionCapability(profile: HostExecutionProfile, workspaceRoot: string, env: Record<string,string>): ExecutionEnvironmentCapability {
  const effectiveEnvironment = Object.freeze(Object.fromEntries(Object.entries(env).filter(([,v]) => v !== undefined)) as Record<string,string>);
  return Object.freeze({ ...profile, workspaceRoot, structuredRepositoryTools: ["list_dir", "read_file", "grep"] as const, effectiveEnvironment });
}
