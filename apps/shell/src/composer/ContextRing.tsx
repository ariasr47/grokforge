import type { UsageVoucher } from "../projections/runReducer";

/** Full circumference of the `r=7.5` ring (`2 * PI * 7.5`, rounded to match
 *  the design mock's own literal) — see docs/design/forge-next/Main.dc.html. */
const RING_CIRCUMFERENCE = 47.1;
/** The one place amber is not "needs you" — it flags compaction is near. */
const COMPACT_THRESHOLD = 0.8;

/**
 * Composer meta-bar context ring (Task 11's mount point in ComposerPane).
 * House/guest rule: Forge shows only what the engine actually reported.
 * Renders nothing when there is no usage, or the model catalog has no real
 * context-window number for the active model — never a guessed pct/ring.
 */
export function ContextRing({ usage }: { usage: UsageVoucher | null }) {
  if (!usage) return null;
  const { promptTokens, contextWindow } = usage;
  if (contextWindow == null) return null;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;

  const rawPct = promptTokens / contextWindow;
  const pctLabel = Math.round(rawPct * 100);
  const arcPct = Math.min(1, Math.max(0, rawPct));
  const dashoffset = RING_CIRCUMFERENCE * (1 - arcPct);
  // Warn off the rounded label, not the raw fraction: at 79.6% the label
  // already reads "80%", and a ring that stayed cyan would deny its own text.
  const amber = pctLabel >= Math.round(COMPACT_THRESHOLD * 100);
  // W3-10: "compacts at 80%" named a specific engine mechanism (compaction)
  // that doesn't exist in apps/host or packages/grok-acp — 80% is Forge's
  // own amber threshold (sanctioned exception, F7/Wave 1), not a promise
  // about what the engine will do. State only the real, known percentage.
  const title = `${pctLabel}% of context used`;

  return (
    <span className={`ring${amber ? " ring-amber" : ""}`} title={title}>
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
        <circle
          className="ring-progress"
          cx="10"
          cy="10"
          r="7.5"
          fill="none"
          stroke={amber ? "var(--attention)" : "var(--accent)"}
          strokeWidth="2.5"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span>{pctLabel}%</span>
    </span>
  );
}
