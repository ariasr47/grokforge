/** Shared tool formatting / summarization for chat activity UI. */

export interface ToolMeta {
  ok?: boolean;
  name?: string;
  /** One-line human summary (path, command, …). */
  summary?: string;
  /** Whether result has arrived. */
  done?: boolean;
}

const MAX_TOOL_BODY = 4_000;

export function truncateToolBody(text: string, max = MAX_TOOL_BODY): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Short label for a tool call from its input payload. */
export function summarizeToolInput(name: string, input: unknown): string {
  if (input == null) return name;
  if (typeof input === "string") {
    return input.length > 80 ? `${input.slice(0, 80)}…` : input;
  }
  if (typeof input !== "object") return String(input);

  const o = input as Record<string, unknown>;
  const path = pickString(o, ["path", "file", "filepath", "target"]);
  const command = pickString(o, ["command", "cmd", "shell"]);
  const query = pickString(o, ["query", "pattern", "regex", "search"]);
  const url = pickString(o, ["url", "uri"]);
  const content = pickString(o, ["content", "text", "diff"]);

  if (command) {
    return command.length > 72 ? `${command.slice(0, 72)}…` : command;
  }
  if (path) {
    return path.length > 72 ? `…${path.slice(-68)}` : path;
  }
  if (query) {
    return query.length > 64 ? `${query.slice(0, 64)}…` : query;
  }
  if (url) {
    return url.length > 64 ? `${url.slice(0, 64)}…` : url;
  }
  if (content) {
    return content.length > 48 ? `${content.slice(0, 48)}…` : content;
  }

  try {
    const raw = JSON.stringify(o);
    return raw.length > 72 ? `${raw.slice(0, 72)}…` : raw;
  } catch {
    return name;
  }
}

export function formatToolInput(input: unknown): string {
  if (typeof input === "string") return truncateToolBody(input);
  try {
    return truncateToolBody(JSON.stringify(input ?? {}, null, 2));
  } catch {
    return String(input);
  }
}

export function formatToolOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output !== "string") {
    try {
      return truncateToolBody(JSON.stringify(output, null, 2));
    } catch {
      return truncateToolBody(String(output));
    }
  }
  try {
    const j = JSON.parse(output) as Record<string, unknown>;
    if (j.blocked) {
      return truncateToolBody(`Blocked: ${j.error || j.stderr || "denied"}`);
    }
    if (j.timed_out) {
      return truncateToolBody(
        `Timed out (${j.timeout_ms}ms)\n${String(j.stdout || "")}\n${String(j.stderr || "")}`,
      );
    }
    if ("exit_code" in j) {
      const code = j.exit_code;
      const out = String(j.stdout || "");
      const err = String(j.stderr || "");
      return truncateToolBody(
        [`exit ${code}`, out && `stdout:\n${out}`, err && `stderr:\n${err}`]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (typeof j.error === "string") {
      return truncateToolBody(`Error: ${j.error}`);
    }
    if (typeof j.content === "string") {
      return truncateToolBody(j.content);
    }
    return truncateToolBody(JSON.stringify(j, null, 2));
  } catch {
    return truncateToolBody(output);
  }
}

/** Pretty tool name for chips. */
export function displayToolName(name?: string): string {
  if (!name) return "tool";
  return name.replace(/_/g, " ");
}
