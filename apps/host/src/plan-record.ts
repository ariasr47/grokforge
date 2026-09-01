import type { PlanProposedMember, PlanRecord, PlanRecordStatus, PolicySnapshot, TerminalKind } from "./run-types.js";

const FILE_TOKEN = /\b[\w./\\-]+\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;
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

export function derivePlanProposedMembers(body: string | null): PlanProposedMember[] {
  if (!body) return [];
  const members: PlanProposedMember[] = [];
  const seen = new Set<string>();
  const add = (path: string | null, summary: string) => {
    const key = path ?? summary;
    if (!key || seen.has(key)) return;
    seen.add(key);
    members.push({ path, summary });
  };

  for (const raw of body.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const prefix = PREFIX.exec(trimmed);
    const source = prefix ? prefix[1]!.trim() : trimmed;
    const bullet = source.replace(/^[-*]\s+/, "");
    const files = source.match(FILE_TOKEN) ?? [];
    if (files.length) {
      for (const file of files) {
        const path = normalizePath(file);
        add(path, bullet || basename(path));
      }
      continue;
    }
    if (prefix && source) add(null, source);
  }

  if (members.length === 0) {
    for (const file of body.match(FILE_TOKEN) ?? []) {
      const path = normalizePath(file);
      add(path, basename(path));
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
