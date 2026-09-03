import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, ListTree, PanelRight, Square } from "lucide-react";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Icon } from "./ui/Icon";

export interface ThreadHeaderProps {
  title: string;
  /** Real applied model id, or omitted — never guessed. */
  model?: string | null;
  /** Already display-cased ("Fast"/"Expert"/"Heavy"); omitted when the session is on Auto. */
  effortLabel?: string | null;
  /** Whole minutes elapsed for the session's most recent run; omitted when no run exists yet. */
  elapsedMinutes?: number | null;
  /** phaseCopy's real text (Thinking…/Using tools…/Writing…/Waiting for model…/Planning/…);
   *  null when nothing is live. Ignored while `decisionPending`. */
  liveStatusText?: string | null;
  /** A decision needs the operator — paints amber "Waiting for you" over any phase text. */
  decisionPending?: boolean;
  /** Elapsed seconds for the live-status suffix ("· 41s"); omitted when unknown. */
  elapsedSeconds?: number | null;
  cancellable?: boolean;
  onCancel?: () => void;
  /** OverviewStrip, already built from the same projection App.tsx feeds it elsewhere. */
  overview: ReactNode;
  onExport: () => void;
  exportDisabled?: boolean;
  /** Real member count once the changes list has loaded; omitted (never a
   *  fabricated 0) while it is still loading or errored — see
   *  `changesAvailable`, which the caller deliberately keeps true in both of
   *  those states. */
  changesCount?: number;
  changesOpen: boolean;
  onToggleChanges: () => void;
  /** Nothing to show in the dock — the toggle chip does not render at all. */
  changesAvailable: boolean;
  /** Beside panel is currently open for this session. The chip is a
   *  close/indicator affordance — it only renders while true, since there is
   *  no single "the artifact for this session" the header could discover and
   *  offer to open on its own (opening a specific turn's document stays the
   *  transcript's own job — each elevatable turn's own `.beside` card). */
  artifactOpen?: boolean;
  onToggleArtifact?: () => void;
}

function formatElapsedSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export function ThreadHeader({
  title,
  model,
  effortLabel,
  elapsedMinutes,
  liveStatusText,
  decisionPending = false,
  elapsedSeconds,
  cancellable = false,
  onCancel,
  overview,
  onExport,
  exportDisabled = false,
  changesCount,
  changesOpen,
  onToggleChanges,
  changesAvailable,
  artifactOpen = false,
  onToggleArtifact,
}: ThreadHeaderProps) {
  const [overviewOpen, setOverviewOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overviewOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverviewOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOverviewOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [overviewOpen]);

  const meta = [model, effortLabel, elapsedMinutes != null ? `${elapsedMinutes} min` : null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  const statusText = decisionPending ? "Waiting for you" : liveStatusText || null;
  const elapsedSuffix = elapsedSeconds != null ? ` · ${formatElapsedSeconds(elapsedSeconds)}` : "";

  return (
    <div className="thead" ref={rootRef}>
      <span className="title">{title}</span>
      {meta ? <span className="meta">{meta}</span> : null}
      <span className="spacer" />
      {statusText ? (
        <span className={`hstat${decisionPending ? " needs" : ""}`}>
          <i className={`dot ${decisionPending ? "needs" : "live"}`} aria-hidden="true" />
          <span>
            {statusText}
            {elapsedSuffix}
          </span>
        </span>
      ) : null}
      {cancellable ? (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <Icon icon={Square} size={13} />
          Cancel run
        </Button>
      ) : null}
      <Button
        variant="ghost"
        className="icon-only"
        title="Overview"
        aria-expanded={overviewOpen}
        onClick={() => setOverviewOpen((open) => !open)}
      >
        <Icon icon={ListTree} size={15} />
      </Button>
      <Button variant="ghost" className="icon-only" title="Export" disabled={exportDisabled} onClick={onExport}>
        <Icon icon={Download} size={15} />
      </Button>
      {changesAvailable ? (
        <Chip
          tone={changesOpen ? "on" : "default"}
          className="changes-chip"
          onPress={onToggleChanges}
          trailing={
            changesCount != null ? (
              <span className="changes-chip-count">{changesCount}</span>
            ) : undefined
          }
        >
          Changes
        </Chip>
      ) : null}
      {artifactOpen ? (
        <Chip
          tone="on"
          icon={<Icon icon={PanelRight} size={13} />}
          onPress={onToggleArtifact ?? (() => {})}
        >
          Beside
        </Chip>
      ) : null}
      {overviewOpen ? (
        <div className="overview-popover" role="dialog" aria-label="Run overview">
          {overview}
        </div>
      ) : null}
    </div>
  );
}
