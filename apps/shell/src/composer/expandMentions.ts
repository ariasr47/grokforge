/**
 * Expand @path mentions using workspace file contents (size-capped).
 */

const MAX_PER_FILE = 40_000;
const MAX_TOTAL = 100_000;

/** Injected after the typed prompt for the model. Never show this in You. */
export const MENTION_ATTACH_MARKER = "[Attached file contents for @mentions]";

/** User-typed prompt only — drop the @file body dump. */
export function visibleUserPrompt(prompt: string): string {
  const idx = prompt.indexOf(MENTION_ATTACH_MARKER);
  if (idx === -1) return prompt;
  return prompt.slice(0, idx).trimEnd();
}

export function splitUserPromptMentions(
  text: string,
): Array<{ kind: "text" | "mention"; value: string }> {
  const re = /(@(?:"[^"]+"|[^\s@]+))/g;
  const out: Array<{ kind: "text" | "mention"; value: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push({ kind: "mention", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  if (!out.length) out.push({ kind: "text", value: text });
  return out;
}

export async function expandAtMentions(
  text: string,
  readFile: (path: string) => Promise<{ content: string; truncated?: boolean }>,
): Promise<string> {
  // @path segments: @foo/bar.ts or @"path with spaces"
  const re = /@(?:"([^"]+)"|([^\s@]+))/g;
  const found = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = (m[1] || m[2] || "").trim();
    if (p && !found.has(p)) found.set(p, p);
  }
  if (found.size === 0) return text;

  let budget = MAX_TOTAL;
  const blocks: string[] = [];
  for (const p of found.keys()) {
    if (budget <= 0) break;
    try {
      const { content, truncated } = await readFile(p);
      let body = content.slice(0, Math.min(MAX_PER_FILE, budget));
      budget -= body.length;
      if (truncated || content.length > body.length) {
        body += "\n…[truncated]";
      }
      blocks.push(`\n\n--- File: ${p} ---\n${body}\n--- End: ${p} ---`);
    } catch {
      blocks.push(`\n\n--- File: ${p} ---\n(Could not read file)\n--- End: ${p} ---`);
    }
  }
  if (!blocks.length) return text;
  return `${text}\n\n${MENTION_ATTACH_MARKER}${blocks.join("")}`;
}
