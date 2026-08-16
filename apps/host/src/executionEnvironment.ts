import fs from "node:fs";
import path from "node:path";

export type ShellReasonCode = "shell_resolution_failed" | "unsupported_platform";
export type HostExecutionProfile =
  | { status: "available"; platform: string; osFamily: "windows" | "macos" | "linux"; executable: string; argvPrefix: readonly string[]; displayName: string; dialect: "cmd" | "posix"; pathSeparator: "\\" | "/"; syntax: { quoting: string; chaining: string; redirection: string } }
  | { status: "unavailable"; platform: string; osFamily: "windows" | "macos" | "linux" | "unsupported"; executable: null; argvPrefix: readonly []; displayName: null; dialect: null; pathSeparator: "\\" | "/"; syntax: null; reasonCode: ShellReasonCode; reason: string };
export type ShellCapabilityView =
  | { status:"available"; platform:string; osFamily:"windows"|"macos"|"linux"; executable:string; displayName:string; dialect:"cmd"|"posix"; reasonCode:null; reason:null }
  | { status:"unavailable"; platform:string; osFamily:"windows"|"macos"|"linux"|"unsupported"; executable:null; displayName:null; dialect:null; reasonCode:ShellReasonCode; reason:string };

const definedEnv = (environment: NodeJS.ProcessEnv): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) if (value !== undefined) out[key] = value;
  return Object.freeze(out);
};
const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => Object.entries(env).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const exists = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const unavailable = (platform: string, osFamily: HostExecutionProfile["osFamily"], code: ShellReasonCode, reason: string) => ({ status: "unavailable" as const, platform, osFamily, executable: null, argvPrefix: [] as const, displayName: null, dialect: null, pathSeparator: osFamily === "windows" ? "\\" as const : "/" as const, syntax: null, reasonCode: code, reason });

export function resolveHostExecutionEnvironment(input: { platform: NodeJS.Platform | string; environment: NodeJS.ProcessEnv; isFile?: (absolutePath: string) => boolean }): { profile: Readonly<HostExecutionProfile>; effectiveEnvironment: Readonly<Record<string, string>>; publicView: Readonly<ShellCapabilityView> } {
  const platform = String(input.platform);
  const env = definedEnv(input.environment);
  const isFile = input.isFile ?? exists;
  let profile: HostExecutionProfile;
  if (platform === "win32") {
    const root = envValue(env, "SystemRoot");
    const candidates = [envValue(env, "ComSpec"), root ? path.join(root, "System32", "cmd.exe") : null].filter((v): v is string => !!v && path.isAbsolute(v));
    const executable = candidates.find(isFile);
    profile = executable ? { status: "available", platform, osFamily: "windows", executable, argvPrefix: ["/d", "/s", "/c"], displayName: "Command Prompt (cmd.exe)", dialect: "cmd", pathSeparator: "\\", syntax: { quoting: "double quotes", chaining: "& && | ||", redirection: "cmd redirection" } } : unavailable(platform, "windows", "shell_resolution_failed", "No usable Command Prompt executable was found.");
  } else if (platform === "darwin" || platform === "linux") {
    const executable = "/bin/sh";
    profile = isFile(executable) ? { status: "available", platform, osFamily: platform === "darwin" ? "macos" : "linux", executable, argvPrefix: ["-c"], displayName: "POSIX shell (/bin/sh)", dialect: "posix", pathSeparator: "/", syntax: { quoting: "POSIX shell quoting", chaining: "POSIX operators", redirection: "POSIX redirection" } } : unavailable(platform, platform === "darwin" ? "macos" : "linux", "shell_resolution_failed", "No usable /bin/sh executable was found.");
  } else profile = unavailable(platform, "unsupported", "unsupported_platform", `Unsupported host platform: ${platform}.`);
  const publicView: ShellCapabilityView = Object.freeze(profile.status === "available"
    ? { status: profile.status, platform: profile.platform, osFamily: profile.osFamily, executable: profile.executable, displayName: profile.displayName, dialect: profile.dialect, reasonCode: null, reason: null }
    : { status: profile.status, platform: profile.platform, osFamily: profile.osFamily, executable: null, displayName: null, dialect: null, reasonCode: profile.reasonCode, reason: profile.reason });
  return { profile: Object.freeze(profile), effectiveEnvironment: env, publicView };
}
