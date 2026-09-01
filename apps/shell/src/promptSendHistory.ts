export type PromptHistoryMessage = {
  role: string;
  content?: string;
  projectedRunId?: string | null;
};

/** Code RunSurface Retry and Chat MessageList retry/regenerate must share this. */
export const RETRY_PROMPT_SEND_OPTS = { stripTrailingAssistant: true } as const;

/** Drop trailing assistant / Cancel chips so Retry is not followed by Stopped by you. */
export function stripTrailingStopAndAssistant<T extends { role: string; content: string }>(
  messages: T[],
): T[] {
  const base = messages.slice();
  while (base.length) {
    const last = base[base.length - 1]!;
    if (
      last.role === "assistant" ||
      (last.role === "system" &&
        (last.content.startsWith("Stopped by you") || last.content.startsWith("Run ended")))
    ) {
      base.pop();
      continue;
    }
    break;
  }
  return base;
}

/** Stale cancelled `done` from a stopped run must not paint after Retry bumped the prompt. */
export function cancelledDoneShouldPaint(input: {
  promptGeneration: number;
  cancelGeneration: number;
  lastRole: string | null;
  lastContent: string;
  userCount: number;
}): boolean {
  if (input.lastRole === "system" && input.lastContent.startsWith("Stopped by you")) return false;
  if (input.cancelGeneration > 0 && input.cancelGeneration !== input.promptGeneration) return false;
  if (input.lastRole === "user" && input.userCount > 1) return false;
  return true;
}

/** MessageList Stopped by you belongs only while the newest owned run is still Cancelled. */
export function stopChipBelongsOnTranscript(
  runs: { state?: string; terminalKind?: string | null }[],
): boolean {
  const last = runs.at(-1);
  if (!last) return true;
  if (last.state !== "terminal") return false;
  return last.terminalKind === "cancelled";
}

export type PromptHistoryEntry = {
  role: "user" | "assistant" | "system";
  content: string;
};

/** Run-backed Chat/Code answers live on the run, not in `messages` (text_delta is skipped when a run id is bound). Fold vouched answers so follow-up history is not user-only. */
export function foldRunAnswersIntoHistory(
  messages: PromptHistoryMessage[],
  runAnswerById: Record<string, string>,
): PromptHistoryEntry[] {
  const out: PromptHistoryEntry[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const content = m.content?.trim() ? m.content : "";
    if (
      (m.role === "user" || m.role === "assistant" || m.role === "system") &&
      content
    ) {
      out.push({ role: m.role, content });
    }
    if (m.role !== "user" || !m.projectedRunId) continue;
    const next = messages[i + 1];
    const alreadyAssistant = next?.role === "assistant" && Boolean(next.content?.trim());
    const answer = runAnswerById[m.projectedRunId]?.trim();
    if (!alreadyAssistant && answer) out.push({ role: "assistant", content: runAnswerById[m.projectedRunId]! });
  }
  return out;
}
