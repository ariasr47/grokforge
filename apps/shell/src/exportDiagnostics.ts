import type { PublicState } from "./api";

export interface ChatMessageLike {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  streaming?: boolean;
  toolMeta?: { ok?: boolean; name?: string };
}

function downloadText(filename: string, text: string): void {
  try {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    /* ignore download failures in restricted webviews */
  }
}

export function buildSessionMarkdown(opts: {
  state: PublicState | null;
  sessionId: string | null;
  sessionTitle?: string | null;
  messages: ChatMessageLike[];
  errorBanner?: string | null;
  recentErrors?: string[];
  bootMsg?: string | null;
}): string {
  const lines: string[] = [
    "### Session meta",
    "",
    `- Session id: ${opts.sessionId ?? "(none)"}`,
    `- Title: ${opts.sessionTitle ?? "(untitled)"}`,
    `- Mode: ${opts.state?.mode ?? "?"}`,
    `- Effort: ${opts.state?.effort ?? "?"} (applied: ${opts.state?.appliedEffort ?? "—"})`,
    `- Workspace: ${opts.state?.workspace ?? "(none)"}`,
    `- Chat root: ${opts.state?.chatRoot ?? "(none)"}`,
    `- Model: ${opts.state?.appliedModel || opts.state?.model || "?"}`,
    `- Auth: ${opts.state?.authMode ?? "?"} / ${opts.state?.authSource ?? "?"}`,
    `- Connected: ${opts.state?.connected ?? false}`,
    `- Busy: ${opts.state?.busy ?? false}`,
    `- Host session: ${opts.state?.sessionId ?? "(none)"}`,
    "",
  ];

  if (opts.errorBanner) {
    lines.push("### Current error banner", "", opts.errorBanner, "");
  }
  if (opts.bootMsg) {
    lines.push("### Boot message", "", opts.bootMsg, "");
  }
  if (opts.recentErrors?.length) {
    lines.push("### Recent UI errors", "");
    for (const e of opts.recentErrors.slice(-20)) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }

  lines.push("### Transcript", "");
  if (!opts.messages.length) {
    lines.push("(no messages)");
  } else {
    for (const m of opts.messages) {
      const role = m.role.toUpperCase();
      const stream = m.streaming ? " (streaming)" : "";
      const tool =
        m.role === "tool" && m.toolMeta
          ? ` name=${m.toolMeta.name ?? "?"} ok=${String(m.toolMeta.ok)}`
          : "";
      lines.push(
        `#### ${role}${stream}${tool}`,
        "",
        m.content || "(empty)",
        "",
      );
    }
  }

  return lines.join("\n");
}

export function suggestDiagnosticsFilename(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return `grokforge-diagnostics-${stamp}.md`;
}

export function downloadDiagnostics(filename: string, markdown: string): void {
  downloadText(filename, markdown);
}
