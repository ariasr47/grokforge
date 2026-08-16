import type { ToolMeta } from "./toolFormat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  streaming?: boolean;
  /** Model think-aloud / reasoning summary (collapsed in UI by default) */
  thinking?: string;
  toolMeta?: ToolMeta;
  activityRunKey?: string;
  activityOrder?: number;
  activityIdentity?: string;
}

export type DisplayBlock =
  | { kind: "message"; key: string; message: ChatMessage }
  | { kind: "tools"; key: string; tools: ChatMessage[] };

/**
 * Collapse consecutive tool messages into a single activity block so the
 * transcript stays scannable (chat turns + one activity rail per tool burst).
 */
export function toDisplayBlocks(messages: ChatMessage[]): DisplayBlock[] {
  const stampedTools = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    if (m.role !== "tool" || !m.activityRunKey) continue;
    const list = stampedTools.get(m.activityRunKey) ?? [];
    list.push(m);
    stampedTools.set(m.activityRunKey, list);
  }
  const emitted = new Set<string>();
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
      if (m.activityRunKey) {
        if (emitted.has(m.activityRunKey)) continue;
        emitted.add(m.activityRunKey);
        const tools = [...(stampedTools.get(m.activityRunKey) ?? [])].sort(
          (a, b) => (a.activityOrder ?? 0) - (b.activityOrder ?? 0),
        );
        if (tools.length) {
          blocks.push({ kind: "tools", key: m.activityRunKey, tools });
        }
        continue;
      }
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
  notRun: number;
  pending: number;
  ok: number;
  names: string[];
} {
  let failed = 0;
  let notRun = 0;
  let pending = 0;
  let ok = 0;
  const names: string[] = [];
  for (const t of tools) {
    const n = t.toolMeta?.name;
    if (n && !names.includes(n)) names.push(n);
    if (t.toolMeta?.done === false || t.toolMeta?.status === "running") pending += 1;
    else if (t.toolMeta?.execution === "not_executed" || t.toolMeta?.status === "rejected") notRun += 1;
    else if (t.toolMeta?.ok === false || t.toolMeta?.status === "failed") failed += 1;
    else ok += 1;
  }
  return { total: tools.length, failed, notRun, pending, ok, names };
}
