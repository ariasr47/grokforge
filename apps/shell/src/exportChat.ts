/**
 * Export current transcript as Markdown (knowledge-worker artifact).
 */
import type { ChatMessage } from "./messageBlocks";
import { visibleUserPrompt } from "./expandMentions";

/** Fold a vouched live run into export when it is still on RunSurface, not messages. */
export function mergeLiveRunsForExport(
  messages: ChatMessage[],
  runs: Array<{
    runId: string;
    acceptedPrompt?: string;
    finalAnswer?: string | null;
    terminalKind?: string | null;
  }>,
): ChatMessage[] {
  const out = messages.slice();
  for (const run of runs) {
    const answer = (run.finalAnswer || "").trim();
    if (!answer) continue;
    if (run.terminalKind && run.terminalKind !== "answered") continue;
    if (out.some((m) => m.role === "assistant" && m.content.trim() === answer)) continue;
    if (
      run.acceptedPrompt &&
      !out.some((m) => m.role === "user")
    ) {
      out.push({
        id: `export-you-${run.runId}`,
        role: "user",
        content: visibleUserPrompt(run.acceptedPrompt),
      });
    }
    out.push({
      id: `export-grok-${run.runId}`,
      role: "assistant",
      content: answer,
    });
  }
  return out;
}

export function transcriptToMarkdown(opts: {
  title?: string;
  mode?: string;
  messages: ChatMessage[];
}): string {
  const lines: string[] = [
    `# ${opts.title || "Chat export"}`,
    "",
    `Exported: ${new Date().toISOString()}`,
    opts.mode ? `Mode: ${opts.mode}` : "",
    "",
  ].filter(Boolean) as string[];

  for (const m of opts.messages) {
    if (m.role === "tool") continue;
    const who =
      m.role === "user"
        ? "You"
        : m.role === "assistant"
          ? "Grok"
          : m.role === "system"
            ? "System"
            : m.role;
    lines.push(`## ${who}`, "", m.content || "_(empty)_", "");
  }
  return lines.join("\n");
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function suggestChatFilename(title?: string): string {
  const base = (title || "chat")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .slice(0, 40)
    .replace(/\s+/g, "-")
    .toLowerCase() || "chat";
  const ts = new Date().toISOString().slice(0, 10);
  return `grokforge-${base}-${ts}.md`;
}
