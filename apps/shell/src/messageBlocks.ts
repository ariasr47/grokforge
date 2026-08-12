import type { ToolMeta } from "./toolFormat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  streaming?: boolean;
  /** Model think-aloud / reasoning summary (collapsed in UI by default) */
  thinking?: string;
  toolMeta?: ToolMeta;
}

export type DisplayBlock =
  | { kind: "message"; key: string; message: ChatMessage }
  | { kind: "tools"; key: string; tools: ChatMessage[] };

/**
 * Collapse consecutive tool messages into a single activity block so the
 * transcript stays scannable (chat turns + one activity rail per tool burst).
 */
export function toDisplayBlocks(messages: ChatMessage[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  let toolRun: ChatMessage[] = [];

  const flushTools = () => {
    if (toolRun.length === 0) return;
    blocks.push({
      kind: "tools",
      key: `tools-${toolRun[0]!.id}`,
      tools: toolRun,
    });
    toolRun = [];
  };

  for (const m of messages) {
    if (m.role === "tool") {
      toolRun.push(m);
      continue;
    }
    flushTools();
    blocks.push({ kind: "message", key: m.id, message: m });
  }
  flushTools();
  return blocks;
}

export function toolRunStats(tools: ChatMessage[]): {
  total: number;
  failed: number;
  pending: number;
  ok: number;
  names: string[];
} {
  let failed = 0;
  let pending = 0;
  let ok = 0;
  const names: string[] = [];
  for (const t of tools) {
    const n = t.toolMeta?.name;
    if (n && !names.includes(n)) names.push(n);
    if (t.toolMeta?.done === false) pending += 1;
    else if (t.toolMeta?.ok === false) failed += 1;
    else ok += 1;
  }
  return { total: tools.length, failed, pending, ok, names };
}
