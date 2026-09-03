import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { MarkdownBody } from "./markdown";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { writeClipboard } from "./copyClipboard";
import type { ArtifactContentKind } from "./artifactOpenBinding";

/** Test-only seam so AC 15 can exercise the shared-renderer catch path. */
let forceRenderErrorForTests = false;
export function setArtifactPanelForceRenderError(next: boolean): void {
  forceRenderErrorForTests = next;
}

const OPEN_ERROR_COPY = "Couldn't open this artifact.";
const CLOSE_TITLE =
  "Hide the side panel. The turn stays in the transcript.";
const ERROR_TITLE =
  "The side panel could not render this turn’s content. The transcript turn is unchanged.";

function ThrowOnRender(): ReactNode {
  throw new Error("artifact-panel: forced shared renderer failure");
}

class ArtifactRenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(_err: Error, _info: ErrorInfo): void {}
  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/** Same pattern as RichBlocks.tsx's DownloadCard — a temporary object-URL
 *  anchor click, no server round trip. */
function saveTextFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noreferrer";
  a.click();
  URL.revokeObjectURL(url);
}

function exportFileName(title: string): string {
  const base = title.trim() || "artifact";
  const safe = base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${safe || "artifact"}.md`;
}

export function ArtifactPanel({
  body,
  contentKind,
  title = "",
  onClose,
  onChoose,
  forceRenderError = false,
}: {
  body: string | null;
  contentKind: ArtifactContentKind | null;
  /** The session's own title — the same text ThreadHeader shows. Never a
   *  per-artifact title (the data model has none): omitted from the header
   *  when empty rather than showing a placeholder. */
  title?: string;
  onClose: () => void;
  onChoose?: (label: string, meta?: string) => void;
  /** Test-only: throw at the shared MarkdownBody/RichBlocks boundary. */
  forceRenderError?: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // A11Y-3: the panel opened without moving focus in, and closed (Close
  // button or Escape — see App.tsx's Escape chain) without returning it —
  // focus fell to <body> either way. isOpen is a stable boolean (not
  // body/contentKind's identity) so this only fires on the real open/close
  // transition, not on every content update while already open.
  const isOpen = Boolean(body && contentKind);
  const panelRef = useRef<HTMLElement>(null);
  const openTriggerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      openTriggerRef.current = document.activeElement;
      panelRef.current?.focus({ preventScroll: true });
    } else if (!isOpen && wasOpenRef.current) {
      const trigger = openTriggerRef.current as HTMLElement | null;
      // Only reclaim focus if it fell out to <body> — an explicit click
      // elsewhere (e.g. the same toggle that closed this) already moved
      // focus somewhere real; don't fight that.
      if (trigger?.focus && (!document.activeElement || document.activeElement === document.body)) {
        trigger.focus({ preventScroll: true });
      }
      openTriggerRef.current = null;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const onCopy = useCallback(() => {
    if (!body) return;
    void writeClipboard(body)
      .then(() => {
        setCopyState("copied");
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopyState("idle"), 1200);
      })
      .catch(() => {
        setCopyState("failed");
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopyState("idle"), 1500);
      });
  }, [body]);

  const onExportMd = useCallback(() => {
    if (!body) return;
    saveTextFile(exportFileName(title), body, "text/markdown;charset=utf-8");
  }, [body, title]);

  if (!body || !contentKind) return null;
  const forceThrow = Boolean(forceRenderError) || forceRenderErrorForTests;
  const copyLabel = copyState === "failed" ? "Failed" : copyState === "copied" ? "Copied" : "Copy";
  const errorChrome = (
    <div className="artifact-panel-error" role="alert" title={ERROR_TITLE}>
      {OPEN_ERROR_COPY}
    </div>
  );
  return (
    <aside className="artifact-panel" aria-label="Beside" ref={panelRef} tabIndex={-1}>
      <div className="artifact-panel-head">
        <h2>
          <span className="k">Beside</span>
          {title ? ` · ${title}` : null}
        </h2>
        <span className="spacer" />
        <Button
          variant="ghost"
          className="icon-only"
          onClick={onClose}
          title={CLOSE_TITLE}
          aria-label="Close"
        >
          <Icon icon={X} size={14} />
        </Button>
      </div>
      <div className="sr-only" aria-live="polite">
        {forceThrow ? "Couldn't open this artifact" : "Beside opened"}
      </div>
      <div className="artifact-panel-body">
        <ArtifactRenderBoundary fallback={errorChrome}>
          {forceThrow ? (
            <ThrowOnRender />
          ) : (
            <MarkdownBody text={body} onChoose={onChoose} />
          )}
        </ArtifactRenderBoundary>
      </div>
      <div className="artifact-panel-foot">
        <Button size="sm" onClick={onCopy}>
          {copyLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onExportMd}>
          Export .md
        </Button>
        <span className="spacer" />
      </div>
    </aside>
  );
}
