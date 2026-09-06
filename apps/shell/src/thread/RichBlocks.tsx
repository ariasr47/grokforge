import { memo, useId, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import type { RichBlock, RichDocument, RichTone } from "./richUi";

interface Props {
  doc: RichDocument;
  /** When user picks a decision card / choice */
  onChoose?: (label: string, meta?: string) => void;
}

function toneClass(tone?: RichTone): string {
  return `rich-callout tone-${tone || "info"}`;
}

const Callout = memo(function Callout({
  block,
}: {
  block: Extract<RichBlock, { type: "callout" }>;
}) {
  return (
    <div className={toneClass(block.tone)} role="note">
      {block.title ? <div className="rich-callout-title">{block.title}</div> : null}
      <div className="rich-callout-body">{block.body}</div>
    </div>
  );
});

const Carousel = memo(function Carousel({
  block,
  onChoose,
}: {
  block: Extract<RichBlock, { type: "carousel" }>;
  onChoose?: Props["onChoose"];
}) {
  const [i, setI] = useState(0);
  const n = block.items.length;
  const item = block.items[Math.min(i, n - 1)]!;
  return (
    <div className="rich-carousel" role="region" aria-label={block.title || "Cards"}>
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <div className="rich-card">
        <div className="rich-card-head">
          <strong>{item.title}</strong>
          {item.badge ? <span className="rich-badge">{item.badge}</span> : null}
        </div>
        {item.body ? <p className="rich-card-body">{item.body}</p> : null}
        {item.footer ? <div className="rich-card-footer">{item.footer}</div> : null}
        {onChoose ? (
          <Button
            variant="primary"
            className="rich-card-action"
            onClick={() => onChoose(item.title, item.body)}
          >
            Choose this
          </Button>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="rich-carousel-nav">
          <Button
            variant="ghost"
            disabled={i <= 0}
            onClick={() => setI((x) => Math.max(0, x - 1))}
            aria-label="Previous card"
          >
            ←
          </Button>
          <span className="rich-carousel-dots">
            {block.items.map((_, di) => (
              <button
                key={di}
                type="button"
                className={`rich-dot${di === i ? " active" : ""}`}
                onClick={() => setI(di)}
                aria-label={`Card ${di + 1}`}
              />
            ))}
          </span>
          <Button
            variant="ghost"
            disabled={i >= n - 1}
            onClick={() => setI((x) => Math.min(n - 1, x + 1))}
            aria-label="Next card"
          >
            →
          </Button>
          <span className="rich-carousel-count">
            {i + 1} / {n}
          </span>
        </div>
      ) : null}
    </div>
  );
});

const Choices = memo(function Choices({
  block,
  onChoose,
}: {
  block: Extract<RichBlock, { type: "choices" }>;
  onChoose?: Props["onChoose"];
}) {
  return (
    <div className="rich-choices" role="group" aria-label={block.prompt || "Choices"}>
      {block.prompt ? <div className="rich-section-title">{block.prompt}</div> : null}
      <div className="rich-choices-grid">
        {block.options.map((opt, idx) => (
          <button
            key={opt.id || idx}
            type="button"
            className="rich-choice"
            onClick={() => onChoose?.(opt.label, opt.description)}
          >
            <span className="rich-choice-label">
              {opt.label}
              {opt.recommended ? (
                <span className="rich-badge">Recommended</span>
              ) : null}
            </span>
            {opt.description ? (
              <span className="rich-choice-desc">{opt.description}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
});

const Steps = memo(function Steps({
  block,
}: {
  block: Extract<RichBlock, { type: "steps" }>;
}) {
  return (
    <div className="rich-steps">
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <ol>
        {block.items.map((s, i) => (
          <li key={i}>
            <span className="rich-step-n">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
});

const Kv = memo(function Kv({ block }: { block: Extract<RichBlock, { type: "kv" }> }) {
  return (
    <div className="rich-kv">
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <dl>
        {block.pairs.map((p, i) => (
          <div key={i} className="rich-kv-row">
            <dt>{p.k}</dt>
            <dd>{p.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});

const Compare = memo(function Compare({
  block,
}: {
  block: Extract<RichBlock, { type: "compare" }>;
}) {
  return (
    <div className="rich-compare">
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <div className="rich-table-wrap">
        <table className="rich-table">
          <thead>
            <tr>
              {block.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {block.headers.map((_, ci) => (
                  <td key={ci}>{row[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const Metrics = memo(function Metrics({
  block,
}: {
  block: Extract<RichBlock, { type: "metrics" }>;
}) {
  return (
    <div className="rich-metrics">
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <div className="rich-metrics-grid">
        {block.items.map((m, i) => (
          <div key={i} className="rich-metric">
            <div className="rich-metric-value">{m.value}</div>
            <div className="rich-metric-label">{m.label}</div>
            {m.hint ? <div className="rich-metric-hint">{m.hint}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
});

const Tabs = memo(function Tabs({
  block,
}: {
  block: Extract<RichBlock, { type: "tabs" }>;
}) {
  const [i, setI] = useState(0);
  const activeIndex = Math.min(i, block.tabs.length - 1);
  const tab = block.tabs[activeIndex]!;
  // A11Y-4: useId scopes these ids per instance — a chat turn can render
  // more than one tabs block, and ids must not collide across them.
  const uid = useId();
  const tabId = (idx: number) => `${uid}-rt-tab-${idx}`;
  const panelId = (idx: number) => `${uid}-rt-panel-${idx}`;
  return (
    <div className="rich-tabs">
      <div
        className="rich-tabs-bar"
        role="tablist"
        onKeyDown={(e) => {
          // Roving tabindex + arrow keys, automatic activation (same
          // activation the existing click already does).
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const next = (activeIndex + dir + block.tabs.length) % block.tabs.length;
          setI(next);
          document.getElementById(tabId(next))?.focus();
        }}
      >
        {block.tabs.map((t, ti) => (
          <button
            key={ti}
            type="button"
            id={tabId(ti)}
            role="tab"
            aria-selected={ti === activeIndex}
            aria-controls={panelId(ti)}
            tabIndex={ti === activeIndex ? 0 : -1}
            className={`rich-tab${ti === activeIndex ? " active" : ""}`}
            onClick={() => setI(ti)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="rich-tab-panel"
        role="tabpanel"
        id={panelId(activeIndex)}
        aria-labelledby={tabId(activeIndex)}
      >
        {tab.body}
      </div>
    </div>
  );
});

const Progress = memo(function Progress({
  block,
}: {
  block: Extract<RichBlock, { type: "progress" }>;
}) {
  return (
    <div className="rich-progress">
      {(block.title || block.label) && (
        <div className="rich-progress-head">
          {block.title ? <span>{block.title}</span> : null}
          <span className="rich-progress-val">
            {block.label || `${Math.round(block.value)}%`}
          </span>
        </div>
      )}
      <div
        className="rich-progress-track"
        role="progressbar"
        aria-valuenow={block.value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="rich-progress-fill"
          style={{ width: `${block.value}%` }}
        />
      </div>
    </div>
  );
});

const Timeline = memo(function Timeline({
  block,
}: {
  block: Extract<RichBlock, { type: "timeline" }>;
}) {
  return (
    <div className="rich-timeline">
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <ul>
        {block.items.map((it, i) => (
          <li key={i}>
            <span className="rich-timeline-dot" aria-hidden />
            <div>
              <div className="rich-timeline-title">
                {it.title}
                {it.time ? (
                  <span className="rich-timeline-time">{it.time}</span>
                ) : null}
              </div>
              {it.body ? <div className="rich-timeline-body">{it.body}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});

const Quote = memo(function Quote({
  block,
}: {
  block: Extract<RichBlock, { type: "quote" }>;
}) {
  return (
    <blockquote className="rich-quote">
      <p>{block.text}</p>
      {block.cite ? <cite>— {block.cite}</cite> : null}
    </blockquote>
  );
});

const Checklist = memo(function Checklist({
  block,
}: {
  block: Extract<RichBlock, { type: "checklist" }>;
}) {
  return (
    <div className="rich-checklist">
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <ul>
        {block.items.map((it, i) => (
          <li key={i} className={it.done ? "done" : ""}>
            <span className="rich-check" aria-hidden>
              {it.done ? "✓" : "○"}
            </span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Citation chip — mono, cyan-tinted, `<name> · p.N`. The page suffix only
 *  ever appears when the block itself carries one (richUi.ts's sanitizer is
 *  the only source of `page`); never guessed from name/path. */
const FileChip = memo(function FileChip({
  block,
}: {
  block: Extract<RichBlock, { type: "file" }>;
}) {
  const label = block.page ? `${block.name} · p.${block.page}` : block.name;
  return (
    <span className="rich-cite" title={block.path || block.note || block.name}>
      {label}
    </span>
  );
});

function saveTextFile(name: string, content: string, mime?: string) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noreferrer";
  a.click();
  URL.revokeObjectURL(url);
}

const DownloadCard = memo(function DownloadCard({
  block,
}: {
  block: Extract<RichBlock, { type: "download" }>;
}) {
  return (
    <div className="rich-file rich-download">
      <span className="rich-file-icon" aria-hidden>
        ⬇
      </span>
      <div>
        <div className="rich-file-name">{block.name}</div>
        {block.note ? <div className="rich-file-meta">{block.note}</div> : null}
      </div>
      {block.content != null ? (
        <Button
          variant="ghost"
          onClick={() => saveTextFile(block.name, block.content!, block.mime)}
        >
          Download
        </Button>
      ) : block.href ? (
        <a
          className="btn ghost"
          href={block.href}
          download={block.name}
          target="_blank"
          rel="noreferrer noopener"
        >
          Download
        </a>
      ) : null}
    </div>
  );
});

function mapsEmbedSrc(query: string, zoom?: number): string {
  const u = new URL("https://www.google.com/maps");
  u.searchParams.set("q", query);
  u.searchParams.set("output", "embed");
  if (zoom != null) u.searchParams.set("z", String(zoom));
  return u.toString();
}

function mapsOpenHref(query: string): string {
  const u = new URL("https://www.google.com/maps/search/");
  u.searchParams.set("api", "1");
  u.searchParams.set("query", query);
  return u.toString();
}

const MapCard = memo(function MapCard({
  block,
}: {
  block: Extract<RichBlock, { type: "map" }>;
}) {
  const src = mapsEmbedSrc(block.query, block.zoom);
  return (
    <figure className="rich-map">
      {block.label ? <figcaption className="rich-section-title">{block.label}</figcaption> : null}
      <iframe
        className="rich-map-frame"
        title={block.label || `Map of ${block.query}`}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      />
      <a
        className="rich-map-open"
        href={mapsOpenHref(block.query)}
        target="_blank"
        rel="noreferrer noopener"
      >
        Open in Google Maps
      </a>
    </figure>
  );
});

const ImageCard = memo(function ImageCard({
  block,
}: {
  block: Extract<RichBlock, { type: "image" }>;
}) {
  return (
    <figure className="rich-image">
      <img src={block.src} alt={block.alt || ""} loading="lazy" />
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
});

const Actions = memo(function Actions({
  block,
  onChoose,
}: {
  block: Extract<RichBlock, { type: "actions" }>;
  onChoose?: Props["onChoose"];
}) {
  return (
    <div className="rich-actions" role="group" aria-label={block.title || "Actions"}>
      {block.title ? <div className="rich-section-title">{block.title}</div> : null}
      <div className="rich-actions-row">
        {block.items.map((it, i) =>
          it.href ? (
            <a
              key={i}
              className="btn ghost"
              href={it.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {it.label}
            </a>
          ) : (
            <Button
              key={i}
              variant="primary"
              onClick={() => onChoose?.(it.label, it.value)}
            >
              {it.label}
            </Button>
          ),
        )}
      </div>
    </div>
  );
});

function embedSrc(provider: "youtube" | "vimeo", id: string): string {
  if (provider === "vimeo") return `https://player.vimeo.com/video/${id}`;
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

const EmbedCard = memo(function EmbedCard({
  block,
}: {
  block: Extract<RichBlock, { type: "embed" }>;
}) {
  return (
    <figure className="rich-embed">
      {block.title ? <figcaption className="rich-section-title">{block.title}</figcaption> : null}
      <iframe
        className="rich-embed-frame"
        title={block.title || `${block.provider} video`}
        src={embedSrc(block.provider, block.id)}
        loading="lazy"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </figure>
  );
});

function renderBlock(
  block: RichBlock,
  key: number,
  onChoose?: Props["onChoose"],
): ReactNode {
  switch (block.type) {
    case "callout":
      return <Callout key={key} block={block} />;
    case "carousel":
      return <Carousel key={key} block={block} onChoose={onChoose} />;
    case "choices":
      return <Choices key={key} block={block} onChoose={onChoose} />;
    case "steps":
      return <Steps key={key} block={block} />;
    case "kv":
      return <Kv key={key} block={block} />;
    case "compare":
      return <Compare key={key} block={block} />;
    case "metrics":
      return <Metrics key={key} block={block} />;
    case "tabs":
      return <Tabs key={key} block={block} />;
    case "progress":
      return <Progress key={key} block={block} />;
    case "timeline":
      return <Timeline key={key} block={block} />;
    case "quote":
      return <Quote key={key} block={block} />;
    case "checklist":
      return <Checklist key={key} block={block} />;
    case "file":
      return <FileChip key={key} block={block} />;
    case "download":
      return <DownloadCard key={key} block={block} />;
    case "map":
      return <MapCard key={key} block={block} />;
    case "image":
      return <ImageCard key={key} block={block} />;
    case "actions":
      return <Actions key={key} block={block} onChoose={onChoose} />;
    case "embed":
      return <EmbedCard key={key} block={block} />;
    default:
      return null;
  }
}

export const RichBlocks = memo(function RichBlocks({ doc, onChoose }: Props) {
  return (
    <div className="rich-root">
      {doc.blocks.map((b, i) => renderBlock(b, i, onChoose))}
    </div>
  );
});
