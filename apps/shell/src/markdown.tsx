import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isRichUiLang,
  liftUnfencedRichUi,
  parseRichDocument,
  parseRichDocumentProgressive,
} from "./richUi";
import { RichBlocks } from "./RichBlocks";
import { shouldHighlight, tokenizeLine } from "./codeHighlight";
import { createParseCache, hashKey } from "./parseCache";

/**
 * Lightweight markdown for chat (no heavy deps).
 * Supports: fenced code (+ soft highlight), tables, task lists, strikethrough,
 * bold/italic/links, headers, lists, hr, and allowlisted ```grok-ui blocks.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineToNodes(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // code, bold, italic, strike, links
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))|([^*`\[~]+)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    const k = `${keyPrefix}-${i++}`;
    if (m[1]) {
      nodes.push(
        <code key={k} className="md-inline-code">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      nodes.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      nodes.push(
        <del key={k} className="md-strike">
          {m[3].slice(2, -2)}
        </del>,
      );
    } else if (m[4]) {
      nodes.push(<em key={k}>{m[4].slice(1, -1)}</em>);
    } else if (m[5]) {
      const link = m[5];
      const lm = link.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const href = lm[2]!;
        const safe =
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("mailto:");
        nodes.push(
          <a
            key={k}
            href={safe ? href : undefined}
            target={safe ? "_blank" : undefined}
            rel="noreferrer noopener"
            className="md-link"
          >
            {lm[1]}
          </a>,
        );
      } else nodes.push(link);
    } else if (m[6]) {
      nodes.push(m[6]);
    }
  }
  return nodes.length ? nodes : [text];
}

const CodeBlock = memo(function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [code]);

  const lines = useMemo(() => code.replace(/\r\n/g, "\n").split("\n"), [code]);
  const highlight = shouldHighlight(lang) && lines.length <= 400;

  return (
    <div className="md-code-wrap">
      <div className="md-code-bar">
        <span className="md-code-lang">{lang || "code"}</span>
        <span className="md-code-meta">{lines.length} lines</span>
        <button type="button" className="btn ghost md-copy-btn" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="md-code md-code-hl">
        <code>
          {lines.map((line, li) => (
            <span key={li} className="md-code-line">
              <span className="md-code-ln" aria-hidden>
                {li + 1}
              </span>
              <span className="md-code-tx">
                {highlight
                  ? tokenizeLine(line).map((tok, ti) => (
                      <span key={ti} className={`tok-${tok.c}`}>
                        {tok.t}
                      </span>
                    ))
                  : line || " "}
              </span>
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});

type Block =
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

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
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

    // GFM table: header + separator + rows
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

    // Task list
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

const blockCache = createParseCache<Block[]>(80);

export function parseMarkdownBlocks(text: string): Block[] {
  const key = hashKey(text);
  const hit = blockCache.get(key);
  if (hit) return hit;
  const blocks = parseBlocks(liftUnfencedRichUi(text));
  blockCache.set(key, blocks);
  return blocks;
}

/** Exported for perf tests / tooling */
export function markdownCacheSize(): number {
  return blockCache.size;
}

export const MarkdownBody = memo(function MarkdownBody({
  text,
  streaming,
  onChoose,
}: {
  text: string;
  streaming?: boolean;
  onChoose?: (label: string, meta?: string) => void;
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);

  return (
    <div className={`md-body${streaming ? " streaming" : ""}`}>
      {blocks.map((b, idx) => {
        const k = `b-${idx}`;
        if (b.type === "rich") {
          const doc =
            parseRichDocument(b.code) ||
            (streaming ? parseRichDocumentProgressive(b.code) : null);
          if (doc) {
            return <RichBlocks key={k} doc={doc} onChoose={onChoose} />;
          }
          if (streaming) {
            return (
              <div key={k} className="rich-pending" role="status">
                Building rich layout…
              </div>
            );
          }
          return <CodeBlock key={k} code={b.code} lang="grok-ui" />;
        }
        if (b.type === "code") {
          return <CodeBlock key={k} code={b.code} lang={b.lang} />;
        }
        if (b.type === "table") {
          return (
            <div key={k} className="md-table-wrap">
              <table className="md-table">
                <thead>
                  <tr>
                    {b.headers.map((h, hi) => (
                      <th key={hi}>{inlineToNodes(h, `${k}-h${hi}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri}>
                      {b.headers.map((_, ci) => (
                        <td key={ci}>
                          {inlineToNodes(row[ci] ?? "", `${k}-r${ri}c${ci}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === "task") {
          return (
            <ul key={k} className="md-task">
              {b.items.map((it, j) => (
                <li key={`${k}-${j}`} className={it.done ? "done" : ""}>
                  <span className="md-task-box" aria-hidden>
                    {it.done ? "☑" : "☐"}
                  </span>
                  {inlineToNodes(it.text, `${k}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "h") {
          const Tag = (`h${Math.min(b.level + 1, 5)}` as unknown) as "h2";
          return (
            <Tag key={k} className={`md-h md-h${b.level}`}>
              {inlineToNodes(b.text, k)}
            </Tag>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={k} className="md-ul">
              {b.items.map((it, j) => (
                <li key={`${k}-${j}`}>{inlineToNodes(it, `${k}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={k} className="md-ol">
              {b.items.map((it, j) => (
                <li key={`${k}-${j}`}>{inlineToNodes(it, `${k}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "hr") return <hr key={k} className="md-hr" />;
        if (b.type === "blockquote") {
          return (
            <blockquote key={k} className="md-quote">
              {inlineToNodes(b.text, k)}
            </blockquote>
          );
        }
        return (
          <p key={k} className="md-p">
            {inlineToNodes(b.text, k)}
          </p>
        );
      })}
      {streaming ? <span className="md-caret" aria-hidden /> : null}
    </div>
  );
});

export function safeText(s: string): string {
  return escapeHtml(s);
}
