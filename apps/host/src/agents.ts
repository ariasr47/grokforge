/**
 * ACP agent adapter registry — shell is provider-agnostic; grok-acp is the first backend.
 * Additional adapters (Codex, Claude, …) register here when ready.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentStatus = "ready" | "planned" | "disabled";

export interface AgentDescriptor {
  id: string;
  name: string;
  provider: string;
  status: AgentStatus;
  /** Short product copy — no inventing capabilities */
  description: string;
}

export interface AgentSpawnSpec {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** monorepo root: apps/host/src → ../../.. */
const defaultRepoRoot = path.resolve(here, "../../..");

export function listAgents(): AgentDescriptor[] {
  return [
    {
      id: "grok-acp",
      name: "Grok",
      provider: "xAI",
      status: "ready",
      description: "Grok via ACP (subscription pool preferred, API key backup)",
    },
    {
      id: "codex-acp",
      name: "Codex",
      provider: "OpenAI",
      status: "planned",
      description: "OpenAI Codex ACP adapter — not shipped yet",
    },
    {
      id: "claude-acp",
      name: "Claude",
      provider: "Anthropic",
      status: "planned",
      description: "Claude Code ACP adapter — not shipped yet",
    },
  ];
}

export function getAgent(id: string | undefined | null): AgentDescriptor {
  const agents = listAgents();
  const found = agents.find((a) => a.id === id);
  if (found) return found;
  return agents.find((a) => a.id === "grok-acp")!;
}

/**
 * Resolve spawn for a ready agent. Planned agents throw with a clear message.
 */
export function resolveAgentSpawn(
  agentId: string | undefined | null,
  repoRoot = process.env.GROKFORGE_ROOT || defaultRepoRoot,
): AgentSpawnSpec {
  const agent = getAgent(agentId);
  if (agent.status !== "ready") {
    throw new Error(
      `Agent "${agent.name}" (${agent.id}) is not available yet (status: ${agent.status})`,
    );
  }
  if (agent.id === "grok-acp") {
    return resolveGrokAcp(repoRoot);
  }
  throw new Error(`No spawn resolver for agent ${agent.id}`);
}

function resolveGrokAcp(repoRoot: string): AgentSpawnSpec {
  const candidates = [
    // Packaged resources (desktop-self-host)
    process.env.GROKFORGE_AGENT_ENTRY,
    path.join(repoRoot, "resources", "agents", "grok-acp", "index.js"),
    path.join(repoRoot, "packages", "grok-acp", "dist", "index.js"),
    path.join(repoRoot, "packages", "grok-acp", "src", "index.ts"),
  ].filter(Boolean) as string[];

  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

  for (const entry of candidates) {
    if (!fs.existsSync(entry)) continue;
    if (entry.endsWith(".ts") && fs.existsSync(tsxCli)) {
      return {
        id: "grok-acp",
        command: process.execPath,
        args: [tsxCli, entry],
      };
    }
    if (entry.endsWith(".js") || entry.endsWith(".mjs")) {
      return {
        id: "grok-acp",
        command: process.execPath,
        args: [entry],
      };
    }
    if (entry.endsWith(".ts")) {
      return {
        id: "grok-acp",
        command: process.execPath,
        args: ["--import", "tsx", entry],
      };
    }
  }

  // Last resort — same as historical monorepo path
  const src = path.join(repoRoot, "packages", "grok-acp", "src", "index.ts");
  return {
    id: "grok-acp",
    command: process.execPath,
    args: ["--import", "tsx", src],
  };
}
