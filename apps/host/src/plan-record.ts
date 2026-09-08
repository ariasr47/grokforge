import type { PlanProposedMember, PlanRecord, PlanRecordStatus, PolicySnapshot, TerminalKind } from "./run-types.js";

const FILE_TOKEN =
  /\b[\w./\\-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt|css|html|htm|py|rs|go|sh|bash|yml|yaml|toml|svg|vue|svelte|kt|java|cs|cpp|h|hpp|rb|php|sql|xml|lock|map)\b/g;
const PREFIX = /^(?:Would change|Proposed):\s*(.+)$/i;
const NOTHING_TO_CHANGE = /\b(?:nothing to change|no changes?(?: proposed| needed| required)?|no files? to (?:change|edit)|unchanged)\b/i;
const WILL_CHANGE = /\b(?:will|going to|plan to)\s+(?:edit|change|create|update|modify|delete|rewrite|add)\b/i;
const COUNT_FILES = /\b(?:edit|change|create|update|modify)\s+\d+\s+(?:files?|modules?|paths?)\b/i;

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

const MUTATION_VERB =
  /\b(?:write_file|apply_patch|write|edit|create|update|modify|delete|rewrite|insert)\b/i;
const NON_MUTATION_MENTION =
  /(?:never touch|do not edit|don't edit|don't touch|without editing|no edits? (?:were )?made to|leave)\s+`?([\w./\\-]+\.[A-Za-z][A-Za-z0-9]{0,7})/gi;

/** File tokens on a test/read/do-not-edit step are mentions, not WOULD CHANGE. */
function lineProposesFileMutation(source: string): boolean {
  const text = source.trim();
  if (!text) return false;
  if (/\b(?:node --test|npm test|npx tsc)\b/i.test(text) && !/\b(?:write_file|apply_patch)\b/i.test(text)) return false;
  if (/\buntouched\b/i.test(text) && !/\b(?:write_file|apply_patch)\b/i.test(text)) return false;
  if (/\bno edits?\b/i.test(text)) return false;
  if (MUTATION_VERB.test(text)) return true;
  if (/\bgit (?:status|diff|log|show)\b/i.test(text) && !/\b(?:write_file|apply_patch|commit)\b/i.test(text)) return false;
  if (/\b(?:read_file|\bread\b|\binspect\b)\b/i.test(text)) return false;
  return true;
}

function mentionedNotMutated(source: string): Set<string> {
  const skip = new Set<string>();
  for (const m of source.matchAll(NON_MUTATION_MENTION)) {
    if (m[1]) skip.add(normalizePath(m[1]));
  }
  return skip;
}

function samePlanPath(a: string, b: string): boolean {
  const left = normalizePath(a).replace(/^\.\//, "");
  const right = normalizePath(b).replace(/^\.\//, "");
  if (left === right) return true;
  const leftBase = basename(left);
  const rightBase = basename(right);
  return (
    left === rightBase ||
    right === leftBase ||
    left.endsWith("/" + right) ||
    left.endsWith("/" + rightBase) ||
    right.endsWith("/" + left) ||
    right.endsWith("/" + leftBase)
  );
}

export function derivePlanProposedMembers(body: string | null): PlanProposedMember[] {
  if (!body) return [];
  const members: PlanProposedMember[] = [];
  const seen = new Set<string>();
  const add = (path: string | null, summary: string) => {
    if (!path) {
      const key = summary;
      if (!key || seen.has(key)) return;
      seen.add(key);
      members.push({ path, summary });
      return;
    }
    const n = normalizePath(path).replace(/^\.\//, "");
    const idx = members.findIndex((m) => m.path != null && samePlanPath(m.path, n));
    if (idx >= 0) {
      const existing = members[idx]!.path!;
      if (n.length > existing.length) {
        members[idx] = { path: n, summary };
        seen.delete(existing);
        seen.add(n);
      }
      return;
    }
    if (seen.has(n)) return;
    seen.add(n);
    members.push({ path: n, summary });
  };

  for (const raw of body.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const prefix = PREFIX.exec(trimmed);
    const source = prefix ? prefix[1]!.trim() : trimmed;
    const bullet = source.replace(/^[-*]\s+/, "");
    const files = source.match(FILE_TOKEN) ?? [];
    if (files.length) {
      if (!prefix && !lineProposesFileMutation(source)) continue;
      const skip = mentionedNotMutated(source);
      for (const file of files) {
        const path = normalizePath(file);
        if (skip.has(path) || skip.has(basename(path))) continue;
        add(path, bullet || basename(path));
      }
      continue;
    }
    if (prefix && source) add(null, source);
  }

  if (members.length === 0) {
    for (const raw of body.split(/\r?\n/)) {
      const source = raw.trim();
      if (!source || !lineProposesFileMutation(source)) continue;
      const skip = mentionedNotMutated(source);
      for (const file of source.match(FILE_TOKEN) ?? []) {
        const path = normalizePath(file);
        if (skip.has(path) || skip.has(basename(path))) continue;
        add(path, basename(path));
      }
    }
  }
  return members;
}

export function bodyNamesIntendedChanges(body: string | null): boolean {
  if (!body || !body.trim()) return false;
  if (derivePlanProposedMembers(body).length > 0) return false;
  if (NOTHING_TO_CHANGE.test(body)) return false;
  if (WILL_CHANGE.test(body) || COUNT_FILES.test(body)) return true;
  return false;
}

export function planStatusForAnswer(body: string | null): {
  status: Extract<PlanRecordStatus, "ready" | "failed">;
  proposedMembers: PlanProposedMember[];
} {
  const proposedMembers = derivePlanProposedMembers(body);
  if (proposedMembers.length > 0) return { status: "ready", proposedMembers };
  if (bodyNamesIntendedChanges(body)) return { status: "failed", proposedMembers: [] };
  return { status: "ready", proposedMembers: [] };
}

export function exploringPlanRecord(input: {
  runId: string;
  sessionId: string;
  connectionGeneration: number;
  policy: PolicySnapshot;
}): PlanRecord {
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    connectionGeneration: input.connectionGeneration,
    status: "exploring",
    body: null,
    proposedMembers: [],
    policy: input.policy,
    executionPhase: "plan",
  };
}

export function terminalPlanRecord(input: {
  runId: string;
  sessionId: string;
  connectionGeneration: number;
  policy: PolicySnapshot;
  terminalKind: TerminalKind;
  body: string | null;
}): PlanRecord {
  const base = {
    runId: input.runId,
    sessionId: input.sessionId,
    connectionGeneration: input.connectionGeneration,
    policy: input.policy,
    executionPhase: "plan" as const,
    body: input.body,
  };
  if (input.terminalKind === "cancelled") {
    return { ...base, status: "cancelled", proposedMembers: [] };
  }
  if (input.terminalKind === "failed") {
    return { ...base, status: "failed", proposedMembers: [] };
  }
  const settled = planStatusForAnswer(input.body);
  return { ...base, status: settled.status, proposedMembers: settled.proposedMembers };
}

/** Empty dock is nothing-to-change / blank — not “no file tokens in a real plan”. */
export function planReadyIsEmpty(body: string | null | undefined, memberCount: number): boolean {
  if (memberCount > 0) return false;
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return true;
  return NOTHING_TO_CHANGE.test(text);
}

export function planDecisionTitle(members: PlanProposedMember[], body?: string | null): string {
  return planReadyIsEmpty(body ?? null, members.length) ? "Plan complete · no changes" : "Review plan";
}

/** Vendor Grok TUI plan tools. Forge maps exit onto the existing plan dock. */
export function isVendorPlanExitTool(name: string | null | undefined): boolean {
  const n = typeof name === "string" ? name.trim().toLowerCase().replace(/_/g, " ") : "";
  return n === "exit plan mode";
}

const VENDOR_PLAN_STATUS_OUTPUT = /^(?:plan:\s*)?(?:enter|exit|entered|exited)$/i;

/**
 * Vendor `exit_plan_mode` output is often `Plan: Exit`. The plan text lives in
 * the accumulated answer (same body grok-acp stamps at prompt done).
 */
function usablePlanText(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (VENDOR_PLAN_STATUS_OUTPUT.test(text.replace(/_/g, " "))) return null;
  return text;
}

export function planBodyFromVendorExit(
  toolOutput: string | null | undefined,
  accumulated: string | null | undefined,
  planFile?: string | null,
): string | null {
  return usablePlanText(toolOutput) ?? usablePlanText(planFile) ?? usablePlanText(accumulated);
}
