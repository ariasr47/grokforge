import { memo, useEffect, useRef } from "react";
import { DiffPanel, type PendingDiff } from "./DiffPanel";
import type { PermissionReq } from "./runChangeList";
import type { PlanProposedMember } from "./runReducer";
import { Gate } from "./Gate";
import { Button } from "./ui/Button";

export {
  PLAN_ACCEPT,
  PLAN_DECISION_FAILURE,
  PLAN_DOCK_EMPTY,
  PLAN_END_EMPTY,
  PLAN_KEEP,
  PLAN_SETTLING,
  planReadyTitle,
} from "./copyDock";

export type PlanDockDecision = {
  empty: boolean;
  proposedMembers?: PlanProposedMember[];
  body?: string | null;
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
  onTrustFolder?: () => void;
  onEditCommand?: () => void;
  /** Real, host-reported workspace name — shell gate's cwd. Omitted (not faked) when unknown. */
  workspaceName?: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onOauthCancel?: () => void;
  planDecision?: PlanDockDecision | null;
  onPlanAccept?: () => void;
  onPlanKeepPlanning?: () => void;
}

/** Normal flex child above the composer — a gate rises here while Grok waits on you. */
export const ActionDock = memo(function ActionDock({
  permissions,
  diffQueue,
  activeDiffId,
  onActiveDiffId,
  oauth,
  onPermission,
  onTrustFolder,
  onEditCommand,
  workspaceName = null,
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
        <Gate
          tier={head.kind}
          detail={head.detail}
          cwd={head.kind === "shell" ? workspaceName : undefined}
          onAllow={() => onPermission("allow_once")}
          onAllowSession={() => onPermission("allow_session")}
          onDeny={() => onPermission("deny")}
          onEditCommand={head.kind === "shell" ? onEditCommand : undefined}
          onTrustFolder={head.kind === "write" ? onTrustFolder : undefined}
        />
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
        <Gate
          tier="plan"
          empty={planDecision.empty}
          members={planDecision.proposedMembers ?? []}
          why={planDecision.body}
          settling={planDecision.settling}
          error={planDecision.error}
          onAccept={() => onPlanAccept?.()}
          onKeepPlanning={() => onPlanKeepPlanning?.()}
        />
      ) : null}
    </div>
  );
});
