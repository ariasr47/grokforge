import { isRichUiLang, liftUnfencedRichUi } from "./richUi";
import { createParseCache, hashKey } from "./parseCache";

export type MarkdownBlock =
  | { type: "code"; lang: string; code: string }
  | { type: "rich"; code: string }
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "task"; items: Array<{ done: boolean; text: string }> }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "blockquote"; text: string };

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && !t.startsWith("```");
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(line) && /-+/.test(line);
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function parseBlocks(src: string): MarkdownBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const code = body.join("\n");
      if (isRichUiLang(lang)) {
        blocks.push({ type: "rich", code });
      } else {
        blocks.push({ type: "code", lang, code });
      }
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSep(lines[i + 1]!)
    ) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!) && !isTableSep(lines[i]!)) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const hm = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (hm) {
      blocks.push({ type: "h", level: hm[1]!.length, text: hm[2]! });
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const parts: string[] = [line.slice(2)];
      i += 1;
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        parts.push(lines[i]!.slice(2));
        i += 1;
      }
      blocks.push({ type: "blockquote", text: parts.join("\n") });
      continue;
    }

    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items: Array<{ done: boolean; text: string }> = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i]!)) {
        const m = lines[i]!.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (m) {
          items.push({
            done: m[1]!.toLowerCase() === "x",
            text: m[2]!,
          });
        }
        i += 1;
      }
      blocks.push({ type: "task", items });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.startsWith("```") &&
      !/^\s{0,3}#{1,4}\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !lines[i]!.startsWith("> ") &&
      !(isTableRow(lines[i]!) && i + 1 < lines.length && isTableSep(lines[i + 1]!))
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}

const blockCache = createParseCache<MarkdownBlock[]>(80);

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const key = hashKey(text);
  const hit = blockCache.get(key);
  if (hit) return hit;
  const blocks = parseBlocks(liftUnfencedRichUi(text));
  blockCache.set(key, blocks);
  return blocks;
}

export function markdownCacheSize(): number {
  return blockCache.size;
}
