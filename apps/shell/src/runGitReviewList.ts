import type { ActivityRecord, RunProjectionRun } from "./runReducer";
import type { CatchUpSignal } from "./runChangeList";

export type GitReviewKind = "status" | "diff" | "log" | "show" | "pr";
export type GitReviewExecution = "executed" | "not_executed" | "pending";

export type RunGitReviewMember = {
  activityId: string;
  invocationId: string;
  command: string;
  kind: GitReviewKind;
  execution: GitReviewExecution;
  evidenceUnavailable: boolean;
};

export type RunGitReviewListProjection =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "absent"; runLive: boolean }
  | {
      state: "ready";
      members: [RunGitReviewMember, ...RunGitReviewMember[]];
      runLive: boolean;
    };

export const GIT_REVIEW_CATCHUP_LOAD_FAILURE =
  "Couldn’t load this run’s git review. Activity rows that already loaded stay available.";

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
    // DELTA vs list-auto: additionally reject ";"
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

/** Shape only — PR admission also requires fold execution === "executed" at terminal. */
export function classifyGitReviewCommand(command: string): GitReviewKind | null {
  if (!command || typeof command !== "string") return null;
  if (hasObserveSeparator(command)) return null;
  const tokens = tokenizeLeading(command.trim());
  if (!tokens || tokens.length === 0) return null;
  const family = leadingFamily(tokens[0]!);
  if (family === "git") {
    // No global-option skip (same as list-auto git rule).
    const sub = (tokens[1] ?? "").toLowerCase();
    if (sub === "status" || sub === "diff" || sub === "log" || sub === "show") return sub;
    return null;
  }
  if (family === "gh") {
    // No global-option skip — first token after gh must be pr.
    const sub = (tokens[1] ?? "").toLowerCase();
    return sub === "pr" ? "pr" : null;
  }
  return null;
}

export function bodyRestored(activity: ActivityRecord): boolean {
  if (activity.output != null) return true;
  return typeof activity.error === "string" && activity.error.length > 0;
}

function mapFoldExecution(activity: ActivityRecord): {
  execution: GitReviewExecution;
  evidenceUnavailable: boolean;
} {
  if (activity.execution === "not_executed") {
    return { execution: "not_executed", evidenceUnavailable: false };
  }
  const inFlight = activity.lifecycle === "pending" || activity.status === "running";
  if (inFlight) {
    // Wire executed while still running stays fold executed; chrome uses lifecycle/status for Running.
    return {
      execution: activity.execution === "executed" ? "executed" : "pending",
      evidenceUnavailable: false,
    };
  }
  // W-FAIL-BODY: executed+failed keeps Failed path; never mark unavailable solely for null body.
  if (activity.execution === "executed" && activity.status === "failed") {
    return { execution: "executed", evidenceUnavailable: false };
  }
  if (activity.execution === "executed") {
    return {
      execution: "executed",
      evidenceUnavailable: !bodyRestored(activity),
    };
  }
  // Settled null/missing wire execution → executed sentinel + unavailable (never pending).
  return { execution: "executed", evidenceUnavailable: true };
}

export function deriveGitReviewMember(
  activity: ActivityRecord,
  kind: GitReviewKind,
): RunGitReviewMember {
  const mapped = mapFoldExecution(activity);
  return {
    activityId: activity.activityId,
    invocationId: activity.invocationId,
    command: activity.command ?? "",
    kind,
    execution: mapped.execution,
    evidenceUnavailable: mapped.evidenceUnavailable,
  };
}

/**
 * Paint helper — joins activity.status/lifecycle; does not extend RunGitReviewMember.
 * Running wins on live status even when fold execution is "executed" (INTERFACE mapping vs chrome).
 */
export function gitReviewRowChrome(
  member: RunGitReviewMember,
  activityStatus: ActivityRecord["status"],
  lifecycle: ActivityRecord["lifecycle"],
): "Not run" | "Running" | "Failed" | "unavailable" | "ok" {
  if (member.execution === "not_executed") return "Not run";
  if (lifecycle === "pending" || activityStatus === "running") return "Running";
  if (member.evidenceUnavailable) return "unavailable";
  if (member.execution === "executed" && activityStatus === "failed") return "Failed";
  return "ok";
}

export function projectRunGitReviewList(
  run: RunProjectionRun,
  catchUp: CatchUpSignal,
): RunGitReviewListProjection {
  const runLive = run.state !== "terminal";
  if (catchUp.phase === "open") return { state: "loading" };
  if (catchUp.phase === "failed") {
    return { state: "error", message: GIT_REVIEW_CATCHUP_LOAD_FAILURE };
  }
  const byId = new Map<string, RunGitReviewMember>();
  const order: string[] = [];
  for (const activity of Object.values(run.activities)) {
    if (typeof activity.command !== "string" || !activity.command) continue;
    const shape = classifyGitReviewCommand(activity.command);
    if (!shape) continue;
    const mapped = mapFoldExecution(activity);
    // Predicate B: pr only when fold executed at terminal activity.
    if (shape === "pr") {
      const terminal = activity.lifecycle === "terminal" && activity.status !== "running";
      if (!(mapped.execution === "executed" && terminal)) continue;
    }
    const key = `${activity.activityId}::${activity.invocationId}`;
    const member = deriveGitReviewMember(activity, shape);
    if (!byId.has(key)) order.push(key);
    byId.set(key, member);
  }
  const members = order.map((k) => byId.get(k)!);
  if (members.length === 0) return { state: "absent", runLive };
  return {
    state: "ready",
    members: members as [RunGitReviewMember, ...RunGitReviewMember[]],
    runLive,
  };
}
