import { useEffect, useId, useMemo, useState } from "react";
import { loadPrefs } from "../lib/prefs";
import { Button } from "../ui/Button";
import { writeClipboard } from "../lib/copyClipboard";
import {
  MERMAID_EMPTY_COPY,
  MERMAID_FAIL_COPY,
  renderMermaidSvg,
} from "./mermaidFence";

export function MermaidDiagram({ code }: { code: string }) {
  const reactId = useId().replace(/:/g, "");
  const [appearanceKey, setAppearanceKey] = useState(() => loadPrefs().theme);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const trimmed = code.trim();
  const empty = trimmed === "";

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

  useEffect(() => {
    if (empty) {
      setSvg(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const id = `mmd${reactId}${Math.random().toString(36).slice(2, 8)}`;
    void renderMermaidSvg(trimmed, id, appearanceKey).then(
      (out) => {
        if (cancelled) return;
        setFailed(false);
        setSvg(out);
      },
      () => {
        if (cancelled) return;
        setSvg(null);
        setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [trimmed, appearanceKey, empty, reactId]);

  const copyBtn = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        className="md-copy-btn"
        onClick={() => {
          void writeClipboard(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    ),
    [code, copied],
  );

  if (empty) {
    return (
      <div className="md-code-wrap md-mermaid is-plain" data-mermaid="empty">
        <p className="md-mermaid-status" role="status">
          {MERMAID_EMPTY_COPY}
        </p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="md-code-wrap md-mermaid is-plain" data-mermaid="failed">
        <div className="md-code-bar">
          <span className="md-code-lang">mermaid</span>
          <span className="md-code-meta">{MERMAID_FAIL_COPY}</span>
          {copyBtn}
        </div>
        <p className="md-mermaid-status" role="status">
          {MERMAID_FAIL_COPY} Showing the source.
        </p>
        <pre className="md-code md-code-hl">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="md-code-wrap md-mermaid" data-mermaid="drawing">
        <div className="md-code-bar">
          <span className="md-code-lang">mermaid</span>
          {copyBtn}
        </div>
        <p className="md-mermaid-status" role="status">
          Drawing diagram…
        </p>
      </div>
    );
  }

  return (
    <div className="md-code-wrap md-mermaid" data-mermaid="drawn">
      <div className="md-code-bar">
        <span className="md-code-lang">mermaid</span>
        {copyBtn}
      </div>
      <div
        className="md-mermaid-svg"
        role="img"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
