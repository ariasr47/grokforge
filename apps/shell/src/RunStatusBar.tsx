import { useEffect, useState } from "react";
import { Button } from "./ui/Button";

export type RunPhase =
  | "waiting_model"
  | "reasoning"
  | "tools"
  | "writing"
  | "done"
  | null;

interface Props {
  busy: boolean;
  phase?: RunPhase;
  phaseDetail?: string | null;
  /** Authoritative live phase string from one DerivedLivePhase / phaseCopy. */
  phaseLabel?: string | null;
  /** When the current run started (ms); drives elapsed clock */
  runStartedAt?: number | null;
  permissionPending: boolean;
  diffCount: number;
  effortLabel?: string | null;
  modelLabel?: string | null;
  onJumpPermission?: () => void;
  onJumpDiff?: () => void;
  onCancel?: () => void;
  /** Live Planning chrome — only when DerivedLivePhase kind is plan. */
  planning?: boolean;
}

const HONEST_PHASE_LABEL: Record<string, string> = {
  waiting_model: "Waiting for model…",
  reasoning: "Thinking…",
  tools: "Using tools…",
  writing: "Writing…",
  done: "Done",
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export function RunStatusBar({
  busy,
  phase,
  phaseDetail,
  phaseLabel,
  runStartedAt,
  permissionPending,
  diffCount,
  effortLabel,
  modelLabel,
  onJumpPermission,
  onJumpDiff,
  onCancel,
  planning = false,
}: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy || !runStartedAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy, runStartedAt]);

  if (!busy && !permissionPending && diffCount === 0 && !planning) return null;

  const elapsed =
    busy && runStartedAt ? formatElapsed(Math.max(0, now - runStartedAt)) : null;
  const derived = phaseLabel !== undefined;
  const phaseText = planning
    ? "Planning"
    : derived
      ? (phaseLabel || null)
      : phase && phase !== "done"
        ? HONEST_PHASE_LABEL[phase] || phase
        : busy
          ? "Waiting for model…"
          : null;

  return (
    <div className="run-status" role="status" aria-live="polite">
      <div className="run-status-left">
        {busy && (
          <span className="run-pulse">
            <span className="run-dot" />
            <span className="run-phase-text">
              {derived || planning ? phaseText : (phaseDetail || phaseText)}
              {elapsed ? (
                <span className="run-elapsed" title="Elapsed">
                  {" "}
                  · {elapsed}
                </span>
              ) : null}
            </span>
          </span>
        )}
        {planning ? (
          <span className="run-meta">Plan · no edits applied</span>
        ) : null}
        {busy && (effortLabel || modelLabel) && (
          <span className="run-meta">
            {[effortLabel, modelLabel].filter(Boolean).join(" · ")}
          </span>
        )}
        {permissionPending && (
          <button type="button" className="run-link" onClick={onJumpPermission}>
            Waiting for your approval (Y/N/S)
          </button>
        )}
        {diffCount > 0 && (
          <button type="button" className="run-link" onClick={onJumpDiff}>
            {diffCount} pending change{diffCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {busy && onCancel && (
        <Button onClick={onCancel}>
          Cancel run
        </Button>
      )}
    </div>
  );
}
