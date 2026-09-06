import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseRichDocument, parseRichDocumentProgressive } from "./richUi";
import { parseMarkdownBlocks } from "./markdownParse";
import { RichBlocks } from "./RichBlocks";
import { classifyFence, tokenizeLine } from "./codeHighlight";
import { highlightToHtml } from "./codeHighlightAsync";
import { loadPrefs } from "../lib/prefs";
import { Button } from "../ui/Button";
import { writeClipboard } from "../lib/copyClipboard";

/**
 * Lightweight markdown for chat (no heavy deps).
 * Supports: fenced code (+ soft highlight), tables, task lists, strikethrough,
 * bold/italic/links, headers, lists, hr, and allowlisted ```grok-ui blocks.
 */

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

export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [richHtml, setRichHtml] = useState<string | null>(null);
  const [appearanceKey, setAppearanceKey] = useState(() => loadPrefs().theme);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);
  const gate = useMemo(() => classifyFence(code, lang), [code, lang]);
  const label = gate.token || "code";

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // Recolor without restart: applyPrefsToDom writes html[data-theme]; memoized
  // CodeBlock would otherwise keep a stale loadPrefs() snapshot (AC3/AC5).
  useEffect(() => {
    const sync = () => {
      const next = loadPrefs().theme;
      setAppearanceKey((prev) => (prev === next ? prev : next));
    };
    const root = document.documentElement;
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const onCopy = useCallback(() => {
    void writeClipboard(code).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [code]);

  useEffect(() => {
    const gen = ++genRef.current;
    if (!gate.token && gate.lineCount === 1 && code.trim() !== "") {
      setRichHtml(null);
      return;
    }
    if (!gate.gatePassed) {
      // AC12 / exclusions: immediate plain — drop any last-rich hold.
      setRichHtml(null);
      return;
    }
    // Gate-passed: hold prior richHtml while pending (warm-flip / streaming).
    void highlightToHtml(code, lang, appearanceKey).then(
      (html) => {
        if (gen !== genRef.current) return;
        // Success → swap; null/throw path → tokenizer degrade (clear rich).
        setRichHtml(html);
      },
      () => {
        if (gen !== genRef.current) return;
        setRichHtml(null);
      },
    );
    // Cleanup does not clear richHtml (streaming hold + pending warm hold).
  }, [code, lang, appearanceKey, gate.gatePassed, gate.class, gate.resolvedLang, gate.lineCount]);

  const lines = useMemo(
    () => code.replace(/\r\n/g, "\n").split("\n"),
    [code],
  );
  const unlabeled = !gate.token;
  const compact = unlabeled && gate.lineCount === 1 && code.trim() !== "";
  const plain = unlabeled && !compact;
  // Gate exclusions (incl. oversize crossing) drop last-rich immediately (AC12).
  const bodyHtml = !compact && gate.gatePassed ? richHtml : null;

  const copyBtn = (
    <Button variant="ghost" size="sm" className="md-copy-btn" onClick={onCopy}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );

  return (
    <div
      className={`md-code-wrap${compact ? " is-oneline" : ""}${plain ? " is-plain" : ""}`}
    >
      {compact ? null : plain ? (
        <div className="md-code-plain-actions">{copyBtn}</div>
      ) : (
        <div className="md-code-bar">
          <span className="md-code-lang">{label}</span>
          <span className="md-code-meta">{gate.lineCount} lines</span>
          {copyBtn}
        </div>
      )}
      {compact ? (
        <>
          <pre className="md-code md-code-hl">
            <code>{code}</code>
          </pre>
          {copyBtn}
        </>
      ) : bodyHtml ? (
        <div
          className="md-code md-code-hl"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <pre className="md-code md-code-hl">
          <code>
            {lines.map((line, li) => (
              <span key={li} className="md-code-line">
                {plain ? null : (
                  <span className="md-code-ln" aria-hidden>
                    {li + 1}
                  </span>
                )}
                <span className="md-code-tx">
                  {gate.gatePassed
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
      )}
    </div>
  );
});

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
              <pre key={k} className="md-stream-pre">
                {b.code}
              </pre>
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
