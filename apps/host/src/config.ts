import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./channel.js";
import { installIdentity } from "./install-identity.js";
import {
  clearOAuthTokens,
  getValidAccessToken,
  loadOAuthTokens,
} from "./oauth.js";

export type ProductMode = "chat" | "code";
export type EffortLevel = "auto" | "fast" | "expert" | "heavy";

export interface HostConfig {
  apiKey: string;
  model: string;
  recent: Array<{ name: string; path: string; openedAt: number }>;
  lastWorkspace: string | null;
  /** Enforce shell command allowlist (default true). */
  shellAllowlist: boolean;
  mode: ProductMode;
  effort: EffortLevel;
  /** User-chosen Chat folder; null = default sandbox under channel data dir */
  chatRoot: string | null;
  /** ACP agent adapter id (default grok-acp) */
  agentId: string;
}

/**
 * Workspace-scoped subset of `HostConfig` (SPEC §2.8 amendment, GATE Z ruling 2026-08-13 option
 * A, §2.8 rule 1). This is a **closed set — exactly two fields** — partitioned per
 * `installIdentity()` inside the frozen, shared prod data root: a fresh install identity with no
 * prior entry reads `WORKSPACE_DEFAULT` and starts empty — it never inherits another install's
 * workspace or recent list (the N-1 defect). Everything else in `HostConfig`, including `mode`
 * (SPEC §9.9 resolves it to shared explicitly: "shared is the frozen root's default and nothing
 * observable in this feature depends on it") and `chatRoot` (not named in §2.8 rule 1's closed
 * set, so it falls to rule 2's "every other field"), is single-user-machine state and stays
 * shared across every install reading the same data root, so the operator is never asked to sign
 * in twice.
 */
type WorkspaceScoped = Pick<HostConfig, "recent" | "lastWorkspace">;
type SharedConfig = Omit<HostConfig, keyof WorkspaceScoped>;

const SHARED_DEFAULT: SharedConfig = {
  apiKey: "",
  model: "grok-4",
  shellAllowlist: true,
  mode: "chat",
  effort: "auto",
  chatRoot: null,
  agentId: "grok-acp",
};

const WORKSPACE_DEFAULT: WorkspaceScoped = {
  recent: [],
  lastWorkspace: null,
};

function isEffortValue(v: unknown): v is EffortLevel {
  return v === "auto" || v === "fast" || v === "expert" || v === "heavy";
}

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

/**
 * Per-install partition file for `WorkspaceScoped` fields, keyed by `installIdentity()`. Lives
 * beside `config.json` under the same frozen, shared data root (SPEC §2.8) — the root itself does
 * not move; only `recent` and `lastWorkspace` are keyed inside it.
 */
function workspacesPath(): string {
  return path.join(dataDir(), "workspaces.json");
}

interface WorkspaceStore {
  version: 1;
  installs: Record<string, Partial<WorkspaceScoped>>;
}

function readWorkspaceStore(): WorkspaceStore {
  try {
    const raw = fs.readFileSync(workspacesPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspaceStore>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.installs !== "object" || parsed.installs == null) {
      return { version: 1, installs: {} };
    }
    return { version: 1, installs: parsed.installs };
  } catch {
    // Missing, empty or corrupt: every identity reads WORKSPACE_DEFAULT rather than throwing —
    // matches shell-history.ts's "a bad store degrades, it never takes the engine down" rule.
    return { version: 1, installs: {} };
  }
}

function loadWorkspaceScoped(identity: string): WorkspaceScoped {
  const entry = readWorkspaceStore().installs[identity];
  const merged: WorkspaceScoped = { ...WORKSPACE_DEFAULT, ...entry };
  if (!Array.isArray(merged.recent)) merged.recent = [];
  return merged;
}

function saveWorkspaceScoped(identity: string, scoped: WorkspaceScoped): void {
  const store = readWorkspaceStore();
  store.installs[identity] = scoped;
  const target = workspacesPath();
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch {
    /* best effort: never take the engine down over the workspace partition store */
  }
}

function loadSharedConfig(): SharedConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HostConfig>;
    const mode = parsed.mode === "chat" || parsed.mode === "code" ? parsed.mode : SHARED_DEFAULT.mode;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : SHARED_DEFAULT.apiKey,
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : SHARED_DEFAULT.model,
      shellAllowlist:
        typeof parsed.shellAllowlist === "boolean" ? parsed.shellAllowlist : SHARED_DEFAULT.shellAllowlist,
      mode,
      effort: isEffortValue(parsed.effort) ? parsed.effort : SHARED_DEFAULT.effort,
      chatRoot: parsed.chatRoot === undefined ? SHARED_DEFAULT.chatRoot : parsed.chatRoot,
      agentId:
        typeof parsed.agentId === "string" && parsed.agentId ? parsed.agentId : SHARED_DEFAULT.agentId,
    };
  } catch {
    return { ...SHARED_DEFAULT };
  }
}

/**
 * `identity` defaults to this process's real `installIdentity()` — the only place tests should
 * ever override it. Production call sites (`session.ts`, `index.ts`) all call this with no
 * arguments.
 */
export function loadConfig(identity: string = installIdentity()): HostConfig {
  return { ...loadSharedConfig(), ...loadWorkspaceScoped(identity) };
}

export function saveConfig(cfg: HostConfig, identity: string = installIdentity()): void {
  const shared: SharedConfig = {
    apiKey: cfg.apiKey,
    model: cfg.model,
    shellAllowlist: cfg.shellAllowlist,
    mode: cfg.mode,
    effort: cfg.effort,
    chatRoot: cfg.chatRoot,
    agentId: cfg.agentId,
  };
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(shared, null, 2), "utf8");

  saveWorkspaceScoped(identity, {
    recent: cfg.recent,
    lastWorkspace: cfg.lastWorkspace,
  });
}

function readGrokBuildKey(): string | undefined {
  try {
    const authPath = path.join(os.homedir(), ".grok", "auth.json");
    const raw = fs.readFileSync(authPath, "utf8");
    const data = JSON.parse(raw) as Record<string, { key?: string }>;
    for (const entry of Object.values(data)) {
      if (entry?.key && typeof entry.key === "string" && entry.key.length > 10) {
        return entry.key;
      }
    }
  } catch {
    /* no grok auth */
  }
  return undefined;
}

/**
 * Auth hierarchy (product): **subscription pool preferred**, API key backup.
 * Order: env (CI/dev override) → OAuth pool → Grok Build store → config API key.
 */
export async function resolveApiKeyAsync(
  cfg: HostConfig,
): Promise<{ token?: string; source: string }> {
  const env =
    process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim();
  if (env) return { token: env, source: "env" };

  const oauth = await getValidAccessToken();
  if (oauth) return { token: oauth, source: "oauth" };

  const build = readGrokBuildKey();
  if (build) return { token: build, source: "grok_build" };

  if (cfg.apiKey?.trim()) return { token: cfg.apiKey.trim(), source: "config" };

  return { source: "none" };
}

export function resolveApiKey(cfg: HostConfig): string | undefined {
  const env =
    process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim();
  if (env) return env;
  const t = loadOAuthTokens();
  if (t?.access_token) return t.access_token;
  const build = readGrokBuildKey();
  if (build) return build;
  if (cfg.apiKey?.trim()) return cfg.apiKey.trim();
  return undefined;
}

export function publicAuthInfo(cfg: HostConfig): {
  authMode: "signed_out" | "api_key" | "sub_pool";
  hasApiKey: boolean;
  source: string;
} {
  const env =
    process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim();
  if (env) return { authMode: "api_key", hasApiKey: true, source: "env" };
  if (loadOAuthTokens()?.access_token) {
    return { authMode: "sub_pool", hasApiKey: true, source: "oauth" };
  }
  if (readGrokBuildKey()) {
    return { authMode: "sub_pool", hasApiKey: true, source: "grok_build" };
  }
  if (cfg.apiKey?.trim()) {
    return { authMode: "api_key", hasApiKey: true, source: "config" };
  }
  return { authMode: "signed_out", hasApiKey: false, source: "none" };
}

export function clearAllAuth(cfg: HostConfig): HostConfig {
  cfg.apiKey = "";
  clearOAuthTokens();
  saveConfig(cfg);
  return cfg;
}
