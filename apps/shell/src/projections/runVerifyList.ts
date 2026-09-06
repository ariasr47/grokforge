import type { ActivityRecord, RunProjectionRun } from "./runReducer";
import type { CatchUpSignal } from "./runChangeList";

export type VerifyExecution = "executed" | "not_executed" | "pending";
export type VerifyOutcome = "running" | "pass" | "fail" | "unknown";

export type RunVerifyMember = {
  activityId: string;
  invocationId: string;
  command: string;
  execution: VerifyExecution;
  outcome: VerifyOutcome | null;
  outcomeUnavailable: boolean;
};

export type RunVerifyListProjection =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "absent"; runLive: boolean }
  | { state: "ready"; members: [RunVerifyMember, ...RunVerifyMember[]]; runLive: boolean };

export const VERIFY_CATCHUP_LOAD_FAILURE =
  "Couldn’t load this run’s verify results. Activity rows that already loaded stay available.";

export function deriveVerifyMember(activity: ActivityRecord): RunVerifyMember {
  const command = activity.command ?? "";
  const base = {
    activityId: activity.activityId,
    invocationId: activity.invocationId,
    command,
  };
  // Priority 1 — Not run only from wire not_executed
  if (activity.execution === "not_executed") {
    return { ...base, execution: "not_executed", outcome: null, outcomeUnavailable: false };
  }
  const inFlight = activity.lifecycle === "pending" || activity.status === "running";
  // Priority 2 — actually in-flight only
  if (inFlight) {
    return {
      ...base,
      execution: activity.execution === "executed" ? "executed" : "pending",
      outcome: "running",
      outcomeUnavailable: false,
    };
  }
  // Priority 3–4
  if (activity.execution === "executed" && activity.status === "succeeded") {
    return { ...base, execution: "executed", outcome: "pass", outcomeUnavailable: false };
  }
  if (activity.execution === "executed" && activity.status === "failed") {
    return { ...base, execution: "executed", outcome: "fail", outcomeUnavailable: false };
  }
  // Priority 5 — settled unavailable (incl. missing wire execution). Never pending.
  // Use fold execution "executed" as the non-pending sentinel when wire is null/missing so
  // chipLabel cannot paint Not run (Not run requires execution === "not_executed" only).
  return {
    ...base,
    execution: activity.execution === "executed" ? "executed" : "executed",
    outcome: "unknown",
    outcomeUnavailable: true,
  };
}

export function chipLabel(
  member: RunVerifyMember,
): "Passed" | "Failed" | "Unknown" | "Running" | "Not run" {
  if (member.execution === "not_executed") return "Not run";
  if (member.outcome === "running") return "Running";
  if (member.outcome === "pass") return "Passed";
  if (member.outcome === "fail") return "Failed";
  return "Unknown";
}

export function projectRunVerifyList(
  run: RunProjectionRun,
  catchUp: CatchUpSignal,
): RunVerifyListProjection {
  const runLive = run.state !== "terminal";
  if (catchUp.phase === "open") return { state: "loading" };
  if (catchUp.phase === "failed") {
    return { state: "error", message: VERIFY_CATCHUP_LOAD_FAILURE };
  }
  const byId = new Map<string, RunVerifyMember>();
  const order: string[] = [];
  for (const activity of Object.values(run.activities)) {
    if (typeof activity.command !== "string" || !activity.command) continue;
    if (!isVerifyCommand(activity.command)) continue;
    const key = `${activity.activityId}::${activity.invocationId}`;
    const member = deriveVerifyMember(activity);
    if (!byId.has(key)) order.push(key);
    byId.set(key, member);
  }
  const members = order.map((k) => byId.get(k)!);
  if (members.length === 0) return { state: "absent", runLive };
  return { state: "ready", members: members as [RunVerifyMember, ...RunVerifyMember[]], runLive };
}

export function canAllChecksPassed(projection: RunVerifyListProjection): boolean {
  return (
    projection.state === "ready" &&
    projection.runLive === false &&
    projection.members.every((m) => m.outcome === "pass")
  );
}

function hasObserveSeparator(command: string): boolean {
  let quote = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]!;
    if (c === "^") {
      if (i + 1 >= command.length) return true;
      i += 1;
      continue;
    }
    if (c === '"') {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (c === "\r" || c === "\n" || c === "&" || c === "|" || c === ";") return true;
  }
  return false;
}

function tokenizeLeading(segment: string): string[] | null {
  const values: string[] = [];
  let value = "";
  let quote = false;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i]!;
    if (c === "^") {
      if (i + 1 >= segment.length) return null;
      value += segment[++i]!;
      continue;
    }
    if (c === '"') {
      quote = !quote;
      continue;
    }
    if (!quote && /\s/.test(c)) {
      if (value) {
        values.push(value);
        value = "";
      }
      continue;
    }
    value += c;
  }
  if (quote) return null;
  if (value) values.push(value);
  return values;
}

function leadingFamily(token: string): string {
  const base = token.replace(/^\.(\\|\/)/, "").split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(cmd|exe)$/i, "").toLowerCase();
}

function isNpmVerifyScript(script: string): boolean {
  if (script === "test" || script === "typecheck" || script === "check" || script === "tsc") return true;
  if (script.startsWith("test:") || script.startsWith("test-")) return true;
  if (script.startsWith("typecheck:") || script.startsWith("typecheck-")) return true;
  return false;
}

export function isVerifyCommand(command: string): boolean {
  if (!command || typeof command !== "string") return false;
  if (hasObserveSeparator(command)) return false;
  const tokens = tokenizeLeading(command.trim());
  if (!tokens || tokens.length === 0) return false;
  const family = leadingFamily(tokens[0]!);
  if (family !== "npm" && family !== "npx" && family !== "cargo") return false;
  let i = 1;
  while (i < tokens.length && tokens[i]!.startsWith("-")) i += 1;
  const verb = tokens[i];
  if (!verb) return false;
  i += 1;
  if (family === "npm") {
    if (verb === "test") return true;
    if (verb !== "run") return false;
    const script = tokens[i];
    if (!script || script.startsWith("-")) return false;
    return isNpmVerifyScript(script);
  }
  if (family === "npx") return verb === "vitest" || verb === "jest" || verb === "tsc";
  return verb === "test" || verb === "check";
}
