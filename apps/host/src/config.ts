import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./channel.js";
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

const DEFAULT: HostConfig = {
  apiKey: "",
  model: "grok-4",
  recent: [],
  lastWorkspace: null,
  shellAllowlist: true,
  mode: "chat",
  effort: "auto",
  chatRoot: null,
  agentId: "grok-acp",
};

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

export function loadConfig(): HostConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HostConfig>;
    const cfg: HostConfig = { ...DEFAULT, ...parsed };
    if (cfg.mode !== "chat" && cfg.mode !== "code") cfg.mode = "chat";
    if (
      cfg.effort !== "auto" &&
      cfg.effort !== "fast" &&
      cfg.effort !== "expert" &&
      cfg.effort !== "heavy"
    ) {
      cfg.effort = "auto";
    }
    if (cfg.chatRoot === undefined) cfg.chatRoot = null;
    if (typeof cfg.shellAllowlist !== "boolean") cfg.shellAllowlist = true;
    if (!cfg.agentId || typeof cfg.agentId !== "string") cfg.agentId = "grok-acp";
    return cfg;
  } catch {
    return { ...DEFAULT };
  }
}

export function saveConfig(cfg: HostConfig): void {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
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
