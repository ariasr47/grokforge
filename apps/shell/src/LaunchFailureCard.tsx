// F3/F4 — one of the six launch-failure cards (SPEC §5), full-screen, plus
// the stored-history "conversations are saved" line (F4, branch B of §4
// flow 3 — operator ruling: the criterion is the outcome, not the
// realisation).
import { BrandMark } from "./BrandMark";
import { CARD_COPY, cardFor, type FailureStatus } from "./failureCard";
import type { DesktopHostStatus } from "./api";
import { Button } from "./ui/Button";

/** AC-U5: with `owned: false` no restart affordance renders anywhere — the
 *  shell does not own the listener it is talking to (dev-shell-only state;
 *  unreachable in a packaged prod build, SPEC §2.5). */
export function canRetryEngine(status: Pick<DesktopHostStatus, "owned">): boolean {
  return status.owned !== false;
}

interface Props {
  status: DesktopHostStatus;
  /** F4 — SPEC §4 flow 3 branch B: rendered above the actions when at least
   *  one stored session holds at least one message. */
  hasStoredHistory: boolean;
  onRetry: () => void;
  onSaveDiagnostics: () => void;
  diagnosticsStatus?: string | null;
  /** N-2 (QA GATE Q pass-1b, AC-S8) — `GET /api/health`'s version/channel,
   *  best-effort (may be null if the engine was never reachable this boot).
   *  A full-screen failure card is exactly the moment Settings is
   *  unreachable, so `Details` is this card's only channel-carrying surface
   *  — see LaunchFailureCard.test.tsx for the mutation-probe check. */
  buildInfo?: { version?: string; channel?: string; channelLabel?: string } | null;
}

export function LaunchFailureCard({
  status,
  hasStoredHistory,
  onRetry,
  onSaveDiagnostics,
  diagnosticsStatus,
  buildInfo,
}: Props) {
  const cardId = cardFor(status as FailureStatus);
  const copy = CARD_COPY[cardId];
  // AC-U5's two card-specific rules — refused-copy renders no `Try again`
  // at all; missing-file renders it only as a secondary — are properties of
  // the class itself (SPEC §5's "Retry offered" column, baked into
  // `CARD_COPY`), not of `owned`. Every real launcher failure reports
  // `owned: false` (nothing was ever attached — see api.ts's
  // `DesktopHostStatus.owned` doc), so gating this card's own action on
  // `canRetryEngine` silently zeroed `Try again` on every failure card,
  // including ones SPEC keeps retryable (GATE Q pass 1d, AC-U5 bounce).
  // AC-U5's "no Restart engine affordance anywhere" clause is enforced
  // separately, in App.tsx, against the *live* app's ambient restart
  // affordances (Settings, command palette, topbar, banners) — not against
  // this card's own action, whose policy is exactly `copy.retryOffered`.
  const retryOffered = copy.retryOffered;

  // GATE Q pass 1h, AC-U5 bounce (round 7): visual weight belongs to the
  // *slot* (primary vs secondary), never to which action happens to occupy
  // it. `try-again` is primary on every card except missing-file (SPEC §5
  // card 4), where it is demoted to secondary and `save-diagnostics` takes
  // the primary slot instead — so the class must be keyed on `isPrimary`,
  // not on `which`.
  const renderAction = (
    which: "try-again" | "save-diagnostics" | null,
    key: string,
    isPrimary: boolean,
  ) => {
    if (which === "try-again") {
      if (!retryOffered) return null;
      return (
        <Button
          key={key}
          variant={isPrimary ? "primary" : "default"}
          onClick={onRetry}
        >
          Try again
        </Button>
      );
    }
    if (which === "save-diagnostics") {
      return (
        <Button
          key={key}
          variant={isPrimary ? "primary" : "default"}
          onClick={onSaveDiagnostics}
        >
          Save troubleshooting file
        </Button>
      );
    }
    return null;
  };

  return (
    <div className="boot-screen">
      <div className="boot-card launch-failure-card" data-card={cardId}>
        <div className="brand">
          <BrandMark className="brand-mark brand-mark-lg" />
          <span className="brand-word">Forge</span>
        </div>
        {hasStoredHistory && (
          <p className="boot-hint saved-history-line">
            Your conversations are saved and will be here when Forge starts.
          </p>
        )}
        <h1 className="boot-msg error">{copy.headline}</h1>
        <p className="boot-body">{copy.body}</p>
        <div className="row" style={{ justifyContent: "center", gap: 10 }}>
          {[
            renderAction(copy.primaryAction, "primary", true),
            renderAction(copy.secondaryAction, "secondary", false),
          ]}
        </div>
        {diagnosticsStatus && <p className="boot-hint">{diagnosticsStatus}</p>}
        <details className="launch-details">
          <summary>Details</summary>
          <dl>
            <dt>reason</dt>
            <dd>{status.reason ?? "—"}</dd>
            <dt>osError</dt>
            <dd>{status.osError ?? "—"}</dd>
            <dt>phase</dt>
            <dd>{status.phase}</dd>
            <dt>owned</dt>
            <dd>{String(status.owned)}</dd>
            <dt>port</dt>
            <dd>{status.port ?? "—"}</dd>
            <dt>pid</dt>
            <dd>{status.pid ?? "—"}</dd>
            <dt>message</dt>
            <dd>{status.message || "—"}</dd>
            <dt>version</dt>
            <dd>{buildInfo?.version ?? "—"}</dd>
            <dt>channel</dt>
            <dd>
              {buildInfo?.channel ?? "—"}
              {buildInfo?.channelLabel ? ` (${buildInfo.channelLabel})` : ""}
            </dd>
          </dl>
        </details>
      </div>
    </div>
  );
}
