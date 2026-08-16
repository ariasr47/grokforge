import { StdioAcpClient } from "@grokforge/acp-client";
import type { AgentSpawnConfig, AcpOwnership } from "@grokforge/acp-client";

export interface ExecutionContext {
  readonly sessionId: string;
  readonly workspace: string;
  readonly client: StdioAcpClient;
  readonly connectionGeneration: number;
  readonly dispatcher: AbortController;
  readonly cancelOwner: { cancel: (runId: string) => Promise<void> };
  terminal: boolean;
  quarantined: boolean;
}

/** Owns one ACP child per client session. Contexts are never shared across sessions. */
export class SessionExecutionPool {
  private contexts = new Map<string, ExecutionContext>();
  private generations = new Map<string, number>();
  constructor(private readonly factory: (workspace: string) => AgentSpawnConfig) {}

  acquire(sessionId: string, workspace: string): ExecutionContext {
    const existing = this.contexts.get(sessionId);
    if (existing && !existing.quarantined) return existing;
    const generation = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, generation);
    const client = new StdioAcpClient(this.factory(workspace));
    const dispatcher = new AbortController();
    const context: ExecutionContext = {
      sessionId, workspace, client, connectionGeneration: generation, dispatcher,
      terminal: true, quarantined: false,
      cancelOwner: { cancel: async (runId) => {
        const owner: AcpOwnership = { sessionId, runId, connectionGeneration: generation };
        dispatcher.abort();
        await client.cancel(owner);
      } },
    };
    this.contexts.set(sessionId, context);
    return context;
  }

  markRunning(sessionId: string, runId: string): AcpOwnership {
    const context = this.contexts.get(sessionId);
    if (!context || context.quarantined) throw new Error("execution context unavailable");
    if (!context.terminal) throw Object.assign(new Error("run active"), { code: "run_active" });
    context.terminal = false;
    return { sessionId, runId, connectionGeneration: context.connectionGeneration };
  }

  markTerminal(sessionId: string): void { const c = this.contexts.get(sessionId); if (c) c.terminal = true; }

  async quarantine(sessionId: string, workspace?: string): Promise<ExecutionContext> {
    const old = this.contexts.get(sessionId);
    if (old) { old.quarantined = true; old.dispatcher.abort(); await old.client.dispose(); }
    this.contexts.delete(sessionId);
    if (!workspace) throw new Error("quarantine requires workspace for replacement");
    return this.acquire(sessionId, workspace);
  }

  async release(sessionId: string): Promise<void> {
    const c = this.contexts.get(sessionId);
    if (!c || !c.terminal) throw new Error("cannot reclaim nonterminal context");
    c.dispatcher.abort(); await c.client.dispose(); this.contexts.delete(sessionId);
  }

  get(sessionId: string): ExecutionContext | undefined { return this.contexts.get(sessionId); }
}
