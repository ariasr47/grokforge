import { memo, useEffect, useRef } from "react";
import { DiffPanel, type PendingDiff } from "./DiffPanel";
import { PermissionCard, type PermissionReq } from "./PermissionCard";

interface OauthPending {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

interface Props {
  permissions: PermissionReq[];
  diffQueue: PendingDiff[];
  activeDiffId: string | null;
  onActiveDiffId: (id: string | null) => void;
  oauth: OauthPending | null;
  onPermission: (d: "allow_once" | "allow_session" | "deny") => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onOauthCancel?: () => void;
}

/** Sticky dock above composer — always visible while agent waits. */
export const ActionDock = memo(function ActionDock({
  permissions,
  diffQueue,
  activeDiffId,
  onActiveDiffId,
  oauth,
  onPermission,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onOauthCancel,
}: Props) {
  const head = permissions[0] ?? null;
  const rest = permissions.length - 1;
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!head && diffQueue.length === 0 && !oauth) return;
    // Focus dock for a11y without stealing composer permanently
    const el = dockRef.current?.querySelector<HTMLElement>(
      "button.btn.primary, a, button",
    );
    el?.focus({ preventScroll: true });
  }, [head?.id, diffQueue.length, oauth?.user_code]);

  if (!head && diffQueue.length === 0 && !oauth) return null;

  return (
    <div
      className="action-dock"
      ref={dockRef}
      role="region"
      aria-label="Pending agent actions"
      aria-live="polite"
    >
      <div className="action-dock-label">
        Attention required
        {rest > 0 ? ` · ${permissions.length} permissions queued` : ""}
      </div>

      {oauth && (
        <div className="oauth-dock" data-oauth-dock>
          <div className="oauth-dock-head">
            <strong>Complete Grok sign-in</strong>
            <span className="oauth-code">{oauth.user_code}</span>
          </div>
          <p>
            Open{" "}
            <a
              href={oauth.verification_uri_complete || oauth.verification_uri}
              target="_blank"
              rel="noreferrer"
            >
              {oauth.verification_uri}
            </a>{" "}
            and enter the code.
          </p>
          {onOauthCancel && (
            <button type="button" className="btn ghost" onClick={onOauthCancel}>
              Cancel sign-in
            </button>
          )}
        </div>
      )}

      {head ? (
        <PermissionCard permission={head} onDecision={onPermission} />
      ) : null}

      {diffQueue.length > 0 ? (
        <DiffPanel
          queue={diffQueue}
          activeId={activeDiffId}
          onActiveId={onActiveDiffId}
          onAccept={onAccept}
          onReject={onReject}
          onAcceptAll={onAcceptAll}
          onRejectAll={onRejectAll}
        />
      ) : null}
    </div>
  );
});
