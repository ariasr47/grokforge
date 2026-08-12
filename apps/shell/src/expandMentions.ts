/**
 * Expand @path mentions using workspace file contents (size-capped).
 */

const MAX_PER_FILE = 40_000;
const MAX_TOTAL = 100_000;

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
  return `${text}\n\n[Attached file contents for @mentions]${blocks.join("")}`;
}
