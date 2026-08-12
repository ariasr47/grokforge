/**
 * User/enterprise policy file: ~/.grokforge/policy.json
 * Lean config surface — no product bloat. Host merges on load.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./channel.js";
import type { EffortLevel, ProductMode } from "./config.js";

export interface UserPolicy {
  /** Default product mode */
  defaultMode?: ProductMode;
  /** Default effort for next send */
  defaultEffort?: EffortLevel;
  /** Preferred ACP agent id (see agents registry) */
  agentId?: string;
  /** Enforce shell allowlist */
  shellAllowlist?: boolean;
  /** UI theme hint consumed by shell */
  theme?: "dark" | "light" | "system";
  /** Model allowlist; empty = any */
  modelAllowlist?: string[];
  /** Max reasoning effort allowed (enterprise cap) */
  maxEffort?: EffortLevel;
  /** Append audit events */
  audit?: boolean;
}

const DEFAULT_POLICY: UserPolicy = {
  defaultMode: "chat",
  defaultEffort: "auto",
  agentId: "grok-acp",
  shellAllowlist: true,
  theme: "system",
  modelAllowlist: [],
  maxEffort: "heavy",
  audit: true,
};

function policyPath(): string {
  return path.join(dataDir(), "policy.json");
}

export function loadPolicy(): UserPolicy {
  try {
    const raw = fs.readFileSync(policyPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserPolicy>;
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function savePolicy(policy: UserPolicy): void {
  const dir = path.dirname(policyPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(policyPath(), JSON.stringify(policy, null, 2), "utf8");
}

export function mergePolicyPatch(patch: Partial<UserPolicy>): UserPolicy {
  const next = { ...loadPolicy(), ...patch };
  savePolicy(next);
  return next;
}

const EFFORT_RANK: Record<EffortLevel, number> = {
  auto: 0,
  fast: 1,
  expert: 2,
  heavy: 3,
};

/** Cap effort by enterprise maxEffort (auto always allowed). */
export function clampEffort(
  requested: EffortLevel,
  max: EffortLevel | undefined,
): EffortLevel {
  if (!max || requested === "auto" || max === "heavy") return requested;
  if (EFFORT_RANK[requested] > EFFORT_RANK[max]) return max;
  return requested;
}
