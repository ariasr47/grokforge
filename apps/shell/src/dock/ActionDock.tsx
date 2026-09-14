import { memo, useEffect, useRef } from "react";
import type { PermissionReq } from "../projections/runChangeList";
import type { PlanProposedMember } from "../projections/runReducer";
import { Gate } from "./Gate";
import { Button } from "../ui/Button";
import { GATE_RECOVER } from "../lib/copyDock";
import { inEditable } from "../lib/inEditable";

export {
  PLAN_ACCEPT,
  PLAN_DECISION_FAILURE,
  PLAN_DOCK_EMPTY,
  PLAN_END_EMPTY,
  PLAN_KEEP,
  PLAN_SETTLING,
  planReadyTitle,
} from "../lib/copyDock";

export type PlanDockDecision = {
  empty: boolean;
  proposedMembers?: PlanProposedMember[];
  body?: string | null;
  settling?: boolean;
  error?: string | null;
};

/** A pending recovery_confirmation decision — cyan ask tier. detail is a
 * pass-through question, never parsed; the one real action is Recover. */
export type RecoveryDockDecision = {
  id: string;
  question: string;
};

interface OauthPending {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

interface Props {
  permissions: PermissionReq[];
  oauth: OauthPending | null;
  onPermission: (d: "allow_once" | "allow_session" | "deny" | `option:${number}`, command?: string) => void;
  onTrustFolder?: () => void;
  onEditCommand?: () => void;
  /** Real, host-reported workspace name — shell gate's cwd. Omitted (not faked) when unknown. */
  workspaceName?: string | null;
  onOauthCancel?: () => void;
  planDecision?: PlanDockDecision | null;
  onPlanAccept?: () => void;
  onPlanKeepPlanning?: () => void;
  /** Pending recovery_confirmation — cyan ask tier. */
  recoveryDecision?: RecoveryDockDecision | null;
  onRecover?: () => void;
}

function parseAskDetail(detail: string): { question: string; options: { label: string }[] } | null {
  try {
    const parsed = JSON.parse(detail) as { question?: unknown; options?: unknown };
    if (typeof parsed.question !== "string" || !Array.isArray(parsed.options)) return null;
    const options = parsed.options.map((o) => String(o ?? "").trim()).filter(Boolean);
    if (options.length < 2) return null;
    return { question: parsed.question, options: options.map((label) => ({ label })) };
  } catch {
    return null;
  }
}

/** Normal flex child above the composer — a gate rises here while Grok waits on you. */
export const ActionDock = memo(function ActionDock({
  permissions,
  oauth,
  onPermission,
  onTrustFolder,
  onEditCommand,
  workspaceName = null,
  onOauthCancel,
  planDecision = null,
  onPlanAccept,
  onPlanKeepPlanning,
  recoveryDecision = null,
  onRecover,
}: Props) {
  const head = permissions[0] ?? null;
  const dockRef = useRef<HTMLDivElement>(null);
  const hasPlan = Boolean(planDecision);
  // recovery_confirmation has exactly one real server action (Recover — see
  // api.editRecovery, which carries no decline param). The gate therefore
  // offers no dismiss: hiding the card while the composer stays locked on
  // "settle the card below" would strand the operator with nothing to settle.
  const activeRecovery = recoveryDecision;

  useEffect(() => {
    if (!head && !oauth && !hasPlan && !activeRecovery) return;
    // Focus dock for a11y without stealing composer permanently — but never
    // while the operator is actively typing into a text field (the composer,
    // a rename box, a comment editor, …). A gate arriving mid-sentence must
    // not yank focus onto its own button: the next ordinary character typed
    // (e.g. a bare "s") would then land on the dock instead of the field the
    // operator is looking at, and App.tsx's global shortcuts read a bare
    // S/Y/N as a real decision. The `aria-live` region below still announces
    // the new gate to assistive tech without moving focus.
    if (inEditable(document.activeElement)) return;
    const el = dockRef.current?.querySelector<HTMLElement>(
      "button.btn.primary, a, button",
    );
    el?.focus({ preventScroll: true });
  }, [head?.id, oauth?.user_code, hasPlan, activeRecovery?.id]);

  if (!head && !oauth && !hasPlan && !activeRecovery) return null;

  const ask = head?.kind === "ask" ? parseAskDetail(head.detail) : null;

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

      {permissions.length > 1 ? (
        <div className="queue-pos" role="status">
          1 of {permissions.length}
        </div>
      ) : null}

      {ask ? (
        <Gate
          tier="ask"
          question={ask.question}
          options={ask.options}
          onChoose={(i) => onPermission(`option:${i}`)}
        />
      ) : head && head.kind !== "ask" ? (
        <Gate
          tier={head.kind}
          detail={head.detail}
          cwd={head.kind === "shell" ? workspaceName : undefined}
          onAllow={(command) => onPermission("allow_once", command)}
          onAllowSession={() => onPermission("allow_session")}
          onDeny={() => onPermission("deny")}
          onEditCommand={head.kind === "shell" ? onEditCommand : undefined}
          onTrustFolder={head.kind === "write" ? onTrustFolder : undefined}
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

      {activeRecovery ? (
        <Gate
          tier="ask"
          question={activeRecovery.question}
          // Exactly the one real action the request offers — never padded to
          // look like a multi-choice question.
          options={[{ label: GATE_RECOVER }]}
          onChoose={() => onRecover?.()}
        />
      ) : null}
    </div>
  );
});
