import type { ReactNode } from "react";
import { api, type PublicState } from "../lib/api";
import { PermissionPolicyControl } from "./PermissionPolicyControl";
import { BypassPermissionsControl } from "./BypassPermissionsControl";

export interface PolicyControlsProps {
  state: PublicState | null;
  sessionId: string | null;
  /** App.tsx's own `hostOk` — not part of `PublicState`, so it must be
   *  threaded in separately to reproduce the exact same "offline" vs.
   *  "unconfirmed" branch both original call sites shared. */
  hostOk: boolean;
  /** App.tsx's own `runStartedAt` — same reason as `hostOk`. */
  runStartedAt: number | null;
  /** Matches `applyState`'s real signature in App.tsx. */
  onApplyState: (next: PublicState) => void;
  /**
   * Matches `reportError`'s real signature in App.tsx (message + optional
   * meta). Neither original call site wired anything like this in — both
   * copies of this block already let `PermissionPolicyControl` /
   * `BypassPermissionsControl` show their own inline failure copy, and the
   * one silent guard (no session/workspace) simply did nothing. Wiring
   * `reportError` in here would newly surface the app's error banner in a
   * case that shows nothing today, which is a rendered-behavior change this
   * task doesn't authorize — so this stays optional and unpassed at both
   * call sites. It exists so a future caller (e.g. the Settings-view
   * extraction) has the seam without another prop-surface change.
   */
  onError?: (message: string, meta?: Record<string, unknown>) => void;
  /**
   * Rendered between the policy control and the bypass control. Settings
   * places `TrustedCommandClassesControl` there today; the composer popover
   * passes nothing. Using `children` for this (rather than folding
   * `TrustedCommandClassesControl` itself in here) keeps both call sites'
   * DOM order exactly as it was — this component only owns the part that
   * was actually duplicated.
   */
  children?: ReactNode;
}

/**
 * The Review ⌄ composer popover and the Settings view each wired up their
 * own copy of PermissionPolicyControl + BypassPermissionsControl — same
 * `onSave` save flow, same `onActiveChange` wiring, differing only in local
 * variable names. Task 4: unify both call sites here so this trust-critical
 * plumbing can't drift between them, and so a future Settings-view
 * extraction doesn't orphan one copy.
 */
export function PolicyControls({
  state,
  sessionId,
  hostOk,
  runStartedAt,
  onApplyState,
  onError,
  children,
}: PolicyControlsProps) {
  const policy = (
    state as PublicState & {
      permissionPolicy?: { effectiveMode?: string; fallbackReason?: string | null; status?: string };
    }
  )?.permissionPolicy;
  const bypass = (
    state as PublicState & {
      bypassPermissions?: { unlocked?: boolean; available?: boolean; activeForSession?: boolean; blockedReason?: string | null };
    }
  )?.bypassPermissions;

  return (
    <>
      <PermissionPolicyControl
        status={!state ? "loading" : !state.workspace ? "no_workspace" : policy?.status === "confirmed" ? "confirmed" : hostOk ? "unconfirmed" : "offline"}
        confirmedMode={policy?.effectiveMode === "trusted_workspace" ? "trusted_workspace" : policy?.effectiveMode === "review" ? "review" : null}
        fallbackReason={policy?.fallbackReason}
        disabled={Boolean(runStartedAt)}
        onSave={async (mode) => {
          if (!sessionId || !state?.workspace) {
            const err = new Error("No session or workspace");
            onError?.(err.message, { source: "policy" });
            throw err;
          }
          try {
            const result = await api.saveWorkspacePolicy({ sessionId, workspace: state.workspace, mode });
            onApplyState({ ...state, permissionPolicy: result.policy as PublicState["permissionPolicy"] });
          } catch (err) {
            onError?.(err instanceof Error ? err.message : String(err), { source: "policy" });
            throw err;
          }
        }}
      />
      {children}
      {sessionId ? (
        <BypassPermissionsControl
          sessionId={sessionId}
          unlocked={Boolean(bypass?.unlocked)}
          available={Boolean(bypass?.available)}
          active={Boolean(bypass?.activeForSession)}
          blockedReason={bypass?.blockedReason}
          onActiveChange={(active) => {
            if (!state || !bypass) {
              onError?.("No session or workspace", { source: "bypass" });
              return;
            }
            onApplyState({ ...state, bypassPermissions: { ...bypass, activeForSession: active } });
          }}
        />
      ) : null}
    </>
  );
}
