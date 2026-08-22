import { memo, useEffect, useRef } from "react";
import { DiffPanel, type PendingDiff } from "./DiffPanel";
import { PermissionCard, type PermissionReq } from "./PermissionCard";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Bell } from "lucide-react";

export const PLAN_DOCK_REVIEW = "Review plan";
export const PLAN_DOCK_EMPTY = "Plan complete · no changes";
export const PLAN_ACCEPT = "Accept plan";
export const PLAN_END_EMPTY = "End Plan · no changes proposed";
export const PLAN_KEEP = "Keep planning";
export const PLAN_SETTLING = "Updating plan decision…";
export const PLAN_DECISION_FAILURE =
  "Couldn’t record that plan decision. The proposal is unchanged.";

export type PlanDockDecision = {
  empty: boolean;
  settling?: boolean;
  error?: string | null;
};

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
  planDecision?: PlanDockDecision | null;
  onPlanAccept?: () => void;
  onPlanKeepPlanning?: () => void;
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
  planDecision = null,
  onPlanAccept,
  onPlanKeepPlanning,
}: Props) {
  const head = permissions[0] ?? null;
  const rest = permissions.length - 1;
  const dockRef = useRef<HTMLDivElement>(null);
  const hasPlan = Boolean(planDecision);

  useEffect(() => {
    if (!head && diffQueue.length === 0 && !oauth && !hasPlan) return;
    // Focus dock for a11y without stealing composer permanently
    const el = dockRef.current?.querySelector<HTMLElement>(
      "button.btn.primary, a, button",
    );
    el?.focus({ preventScroll: true });
  }, [head?.id, diffQueue.length, oauth?.user_code, hasPlan]);

  if (!head && diffQueue.length === 0 && !oauth && !hasPlan) return null;

  return (
    <div
      className="action-dock"
      ref={dockRef}
      role="region"
      aria-label="Pending agent actions"
      aria-live={hasPlan ? "assertive" : "polite"}
    >
      <div className="action-dock-label">
        <Icon icon={Bell} size={14} />
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
            <Button variant="ghost" onClick={onOauthCancel}>
              Cancel sign-in
            </Button>
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

      {planDecision ? (
        <div
          className="plan-dock"
          data-plan-dock={planDecision.empty ? "empty" : "ready"}
          role="group"
          aria-label={planDecision.empty ? PLAN_DOCK_EMPTY : PLAN_DOCK_REVIEW}
          aria-busy={planDecision.settling === true}
        >
          <strong className="plan-dock-title">
            {planDecision.empty ? PLAN_DOCK_EMPTY : PLAN_DOCK_REVIEW}
          </strong>
          {planDecision.settling ? (
            <p className="plan-dock-settling" role="status">{PLAN_SETTLING}</p>
          ) : null}
          {planDecision.error ? (
            <p className="plan-dock-error" role="alert">
              {planDecision.error}
              <Button variant="ghost" onClick={onPlanAccept}>
                Try again
              </Button>
            </p>
          ) : (
            <div className="plan-dock-actions">
              <Button
                variant="primary"
                disabled={planDecision.settling === true}
                onClick={onPlanAccept}
              >
                {planDecision.empty ? PLAN_END_EMPTY : PLAN_ACCEPT}
              </Button>
              <Button
                variant="ghost"
                disabled={planDecision.settling === true}
                onClick={onPlanKeepPlanning}
              >
                {PLAN_KEEP}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});
