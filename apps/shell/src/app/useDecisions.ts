import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { api } from "../lib/api";
import type { PlanEngagementView, ProductMode, PublicState } from "../lib/api";
import { PLAN_DECISION_FAILURE } from "../dock/ActionDock";
import { projectPlanArm, type PlanArmProjection } from "../projections/planArm";
import { isLivePlanning, planReadyIsEmpty } from "../projections/runPlanSection";
import { isStalePermissionDecision } from "../projections/stalePermissionDecision";
import type { PendingDiff, PermissionReq } from "../projections/runChangeList";
import { mergeRunSnapshot, reduceRunEvents, type DecisionRequest, type RunProjection, type RunProjectionRun } from "../projections/runReducer";
import type { useToast } from "../thread/Toast";

/**
 * Restates App.tsx's own, unexported `OAuthPending` shape rather than
 * importing it from App.tsx — matches Task 10's `View` precedent
 * (useChangesProjections.ts) for a private App.tsx type this hook only
 * needs the shape of. Only ever tested for truthiness here
 * (`Boolean(oauth)`, inside `anyDecisionPending`) — never destructured.
 */
type OAuthPendingLike = {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
};

export interface PendingPlanDecision {
  run: RunProjectionRun;
  decision: DecisionRequest;
  empty: boolean;
}

export interface PendingRecoveryDecision {
  run: RunProjectionRun;
  decision: DecisionRequest;
  editId: string | null;
}

export interface UseDecisionsParams {
  /**
   * App.tsx's own `permissions`/`diffQueue`/`oauth` state — NOT owned here,
   * despite the brief's "Moves: permissions/diffQueue/oauth state" line.
   * All three are read (`.length`/truthiness only, never mutated) by the
   * "rAF-throttle scroll-to-bottom" effect — App.tsx, unrelated to
   * decisions, untouched by this task — at that effect's own original,
   * early position (`App.tsx`, right after `messagesRef`'s mirror effect),
   * well before any legal call site for this hook (which needs `reportError`
   * at minimum, declared far later, and `productMode`/`activeRun` for
   * `planArm`, later still). Moving any of the three `useState`s into this
   * hook would place their declaration after that effect's own dependency
   * array already reads them — a TDZ error. See task-11-report.md Step 1
   * for the full call-site inventory. `setPermissions` (not `setDiffQueue`/
   * `setOauth` — nothing moved here writes either one) is still threaded
   * through, for `decidePermission`.
   */
  permissions: PermissionReq[];
  setPermissions: Dispatch<SetStateAction<PermissionReq[]>>;
  diffQueue: PendingDiff[];
  oauth: OAuthPendingLike | null;
  runProjection: RunProjection;
  /**
   * App.tsx's own `runProjectionRef` — the same mutable object, not a copy
   * (Task 7's finding, restated here). `decidePermission` reads `.current`
   * right after settling, to see whether the engine re-opened the same
   * decision (can run ahead of the committed `runProjection` state).
   */
  runProjectionRef: RefObject<RunProjection>;
  sessionId: string | null;
  /**
   * App.tsx's own `stateRef` — a latest-value mirror written in an effect
   * (task-2-report.md's "pre-existing correct example"). `trustFolder`
   * reads `.current` for the freshest `state` inside its async callback,
   * exactly as the pre-move source does.
   */
  stateRef: RefObject<PublicState | null>;
  applyState: (payload: PublicState) => void;
  toast: ReturnType<typeof useToast>;
  reportError: (message: string, meta?: Record<string, unknown>) => void;
  /**
   * App.tsx's own `useSessionFlagsStore` selectors — also called directly
   * elsewhere (workspace open/switch reset both flags to false), so
   * threaded through as parameters rather than a second store subscription
   * inside this hook (Task 9's `openPalette` precedent: a passed-through
   * value is the more literal match and keeps the hook stub-testable).
   */
  setSessionWrite: (value: boolean) => void;
  setSessionShell: (value: boolean) => void;
  productMode: ProductMode;
  connected: boolean;
  /** App.tsx's own `activeRun` memo — many other consumers, stays there. */
  activeRun: RunProjectionRun | null;
  /** = App.tsx's `state?.workspace ?? null`, for `planArm` only. Note this
   *  is deliberately shadowed inside `trustFolder` below by that function's
   *  own `stateRef.current?.workspace` local of the same name — see the
   *  comment there. */
  workspace: string | null;
  /** = App.tsx's `state?.planEngagement`, for `planArm` only. */
  planEngagement: PlanEngagementView | undefined;
  /** App.tsx's own state, written only by `setPlanEngagementUi` (far
   *  outside this move) — read-only here, for `planArm`. */
  planArmError: string | null;
  /**
   * App.tsx's own `planDecisionError` setter. This task's move includes
   * `pendingPlanDecision`'s reset effect and `settlePlan`, both of which
   * write this state to null/a failure string — but `switchSession` (far
   * outside this move) also calls `setPlanDecisionError(null)` directly on
   * a workspace switch, so the state itself stays in App.tsx (Task 9/10's
   * "external writer" precedent) and only the setter is threaded through.
   * Nothing moved here ever reads the current value.
   */
  setPlanDecisionError: Dispatch<SetStateAction<string | null>>;
  /**
   * App.tsx's `commitRunProjection` — settlePlan catch-up after agent-done
   * folds post-terminal plan Accept into the same projection the dock reads.
   */
  commitRunProjection?: (next: RunProjection) => void;
}

export interface UseDecisionsResult {
  pendingPlanDecision: PendingPlanDecision | null;
  pendingRecoveryDecision: PendingRecoveryDecision | null;
  planArm: PlanArmProjection;
  decidePermission: (decision: "allow_once" | "allow_session" | "deny" | `option:${number}`) => Promise<void>;
  trustFolder: () => Promise<void>;
  settlePlan: (action: "accept" | "keep_planning") => Promise<void>;
  recoverFromDock: () => Promise<void>;
  chooseAskOption: (index: number) => void;
  /**
   * Owned here — nothing outside `settlePlan` ever wrote it (checked by
   * grepping every `setPlanSettling` call site before the move: exactly two,
   * both inside `settlePlan`), so unlike `planDecisionError` this state
   * moved in fully, matching Task 10's `changeRecoveryFlash` precedent. No
   * setter is exposed: nothing outside `settlePlan` needs to set it either.
   */
  planSettling: boolean;
  /**
   * = `Boolean(oauth) || permissions.length > 0 || diffQueue.length > 0 ||
   * pendingPlanDecision != null` — exactly as the brief names it, and
   * exactly what the tinykeys effect's own `dockOwns` local and `sendText`'s
   * own early-return check already compute inline today (both outside this
   * move, both untouched — see task-11-report.md). That report's Step 1
   * also found the brief's other two named "four places" are not, in fact,
   * this same formula: `sendDisabledReason` and ComposerPane's
   * `lockedReason` (App.tsx / ChatView.tsx) OR in one more term
   * (`sessionHasDockOwnedPending`, unmoved, App.tsx-local) — both were
   * rewired to `anyDecisionPending || sessionHasDockOwnedPending`, which is
   * algebraically identical to what they computed before this task. The
   * fourth (ThreadHeader's `decisionPending`, computed inside ChatView.tsx)
   * ORs `sessionHasDockOwnedPending` in place of `oauth` — not equal to any
   * combination of this field — and reaching it would require a new
   * ChatView prop, which the Global Constraints forbid adding to a
   * user-facing component; it was left untouched, still re-deriving inline.
   */
  anyDecisionPending: boolean;
}

export function useDecisions({
  permissions,
  setPermissions,
  diffQueue,
  oauth,
  runProjection,
  runProjectionRef,
  sessionId,
  stateRef,
  applyState,
  toast,
  reportError,
  setSessionWrite,
  setSessionShell,
  productMode,
  connected,
  activeRun,
  workspace,
  planEngagement,
  planArmError,
  setPlanDecisionError,
  commitRunProjection,
}: UseDecisionsParams): UseDecisionsResult {
  const permissionInFlightRef = useRef<string | null>(null);
  const recoveryInFlightRef = useRef<string | null>(null);
  const [planSettling, setPlanSettling] = useState(false);

  const pendingPlanDecision = useMemo(() => {
    for (const id of runProjection.runOrder) {
      const run = runProjection.runsById[id];
      if (!run || run.sessionId !== sessionId) continue;
      const decision = Object.values(run.decisions).find(
        (d) => d.kind === "plan" && d.status === "pending",
      );
      if (!decision) continue;
      return {
        run,
        decision,
        empty: planReadyIsEmpty(run.plan?.body, run.plan?.proposedMembers.length ?? 0),
      };
    }
    return null;
  }, [runProjection, sessionId]);
  useEffect(() => {
    setPlanDecisionError(null);
  }, [pendingPlanDecision?.decision.requestId, pendingPlanDecision?.run.runId, sessionId]);
  // Cyan ask tier — recovery_confirmation. Same run-scan shape as
  // pendingPlanDecision above; editId is resolved the same way RunSurface's
  // now-removed submitDecision used to (match the activity by invocationId).
  const pendingRecoveryDecision = useMemo(() => {
    for (const id of runProjection.runOrder) {
      const run = runProjection.runsById[id];
      if (!run || run.sessionId !== sessionId) continue;
      const decision = Object.values(run.decisions).find(
        (d) => d.kind === "recovery_confirmation" && d.status === "pending",
      );
      if (!decision) continue;
      const activity = Object.values(run.activities).find(
        (a) => a.invocationId === decision.invocationId,
      );
      return { run, decision, editId: activity?.editId ?? null };
    }
    return null;
  }, [runProjection, sessionId]);
  // = App.tsx's own (unmemoized) `planBusyOther` const, folded in here since
  // it exists solely to feed `planArm` below and is not read anywhere else
  // (checked before moving it) — Task 10's `changesDockVisible` precedent
  // for a value not itself named in the brief's Moves line but sitting
  // inside the named scope of what it feeds.
  const planBusyOther = Boolean(activeRun && !isLivePlanning(activeRun));
  const planArm = useMemo(
    () =>
      projectPlanArm({
        mode: productMode,
        workspace: workspace ?? null,
        connected,
        planEngagement,
        busyOther: planBusyOther,
        armError: planArmError,
      }),
    [productMode, workspace, connected, planEngagement, planBusyOther, planArmError],
  );

  const decidePermission = useCallback(
    async (decision: "allow_once" | "allow_session" | "deny" | `option:${number}`, command?: string) => {
      const p = permissions[0];
      if (!p) return;
      if (permissionInFlightRef.current === p.id) return;
      permissionInFlightRef.current = p.id;
      setPermissions((prev) => prev.filter((x) => x.id !== p.id));
      try {
        await api.runPermission({
          sessionId: p.sessionId,
          runId: p.runId,
          requestId: p.id,
          invocationId: p.invocationId,
          decision,
          ...(command?.trim() ? { command: command.trim() } : {}),
        });
        if (decision === "allow_session") {
          if (p.kind === "write") setSessionWrite(true);
          if (p.kind === "shell") setSessionShell(true);
        }
        setPermissions((prev) => {
          const owner = runProjectionRef.current.runsById[p.runId];
          const stillPending = owner && Object.values(owner.decisions).some(
            (d) => d.requestId === p.id && d.kind === "permission" && d.status === "pending",
          );
          if (stillPending) return prev.some((x) => x.id === p.id) ? prev : [p, ...prev];
          return prev.filter((x) => x.id !== p.id);
        });
        if (decision !== "allow_once" && !decision.startsWith("option:")) {
          toast.push(
            decision === "deny"
              ? `Denied ${p.kind}`
              : `Allowed ${p.kind} (session)`,
            decision === "deny" ? "info" : "success",
          );
        }
      } catch (err) {
        if (isStalePermissionDecision(err)) return;
        setPermissions((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]));
        reportError(err instanceof Error ? err.message : String(err));
      } finally {
        if (permissionInFlightRef.current === p.id) permissionInFlightRef.current = null;
      }
    },
    [permissions, reportError, toast],
  );

  const trustFolder = useCallback(async () => {
    // Shadows the `workspace` parameter above on purpose: this reads
    // stateRef's latest-value mirror (correct inside an async callback),
    // not the reactive `workspace` prop `planArm` uses — the same two-
    // mechanisms-for-one-field split the pre-move source had, preserved by
    // leaving this local exactly as it was rather than renaming it.
    const workspace = stateRef.current?.workspace;
    if (!sessionId || !workspace) return;
    try {
      const result = await api.saveWorkspacePolicy({
        sessionId,
        workspace,
        mode: "trusted_workspace",
      });
      const latest = stateRef.current;
      if (latest) {
        applyState({
          ...latest,
          permissionPolicy: result.policy as PublicState["permissionPolicy"],
        });
      }
      // Current card only — Trusted applies to later turns via the stored
      // policy. allow_session would skip diffs for binary writes too.
      await decidePermission("allow_once");
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    }
  }, [applyState, decidePermission, reportError, sessionId]);

  const settlePlan = useCallback(
    async (action: "accept" | "keep_planning") => {
      if (!pendingPlanDecision) return;
      setPlanSettling(true);
      setPlanDecisionError(null);
      let postedOk = false;
      try {
        await api.runPlan({
          sessionId: pendingPlanDecision.run.sessionId,
          runId: pendingPlanDecision.run.runId,
          requestId: pendingPlanDecision.decision.requestId,
          invocationId: pendingPlanDecision.decision.invocationId,
          connectionGeneration: pendingPlanDecision.run.connectionGeneration,
          action,
        });
        postedOk = true;
      } catch {
        postedOk = false;
      }
      // Agent-done finalizes the plan run *before* Accept. Settlement is
      // appended after run_terminal; health reconcile skips terminal runs,
      // so the dock stays pending unless this click folds the journal.
      try {
        const replay = await api.runState(
          pendingPlanDecision.run.runId,
          pendingPlanDecision.run.sessionId,
          pendingPlanDecision.run.lastEventSeq,
        );
        if (replay?.run && Array.isArray(replay.events)) {
          commitRunProjection?.(
            reduceRunEvents(
              mergeRunSnapshot(runProjectionRef.current, replay.run),
              replay.events,
            ),
          );
        }
      } catch {
        /* journal catch-up is best-effort; POST outcome still governs the error */
      }
      const latest = runProjectionRef.current.runsById[pendingPlanDecision.run.runId];
      const stillPending = Boolean(
        latest &&
          Object.values(latest.decisions).some(
            (d) =>
              d.requestId === pendingPlanDecision.decision.requestId &&
              d.kind === "plan" &&
              d.status === "pending",
          ),
      );
      if (!postedOk && stillPending) setPlanDecisionError(PLAN_DECISION_FAILURE);
      setPlanSettling(false);
    },
    [commitRunProjection, pendingPlanDecision],
  );

  const recoverFromDock = useCallback(async () => {
    const pending = pendingRecoveryDecision;
    if (!pending) return;
    if (recoveryInFlightRef.current === pending.decision.requestId) return;
    if (!pending.editId) {
      reportError("Recovery details unavailable");
      return;
    }
    recoveryInFlightRef.current = pending.decision.requestId;
    try {
      await api.editRecovery({
        sessionId: pending.run.sessionId,
        runId: pending.run.runId,
        editId: pending.editId,
      });
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Recovery failed");
    } finally {
      if (recoveryInFlightRef.current === pending.decision.requestId) {
        recoveryInFlightRef.current = null;
      }
    }
  }, [pendingRecoveryDecision, reportError]);

  // F4: the ask gate's <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> hints (Gate.tsx)
  // need a real handler per index. recovery_confirmation is the only live
  // "ask" tier caller today and it always offers exactly one option (Recover,
  // at index 0 — see ActionDock's `options={[{ label: GATE_RECOVER }]}`), so
  // only index 0 does anything; Digit2/Digit3 stay bound (not silently
  // missing) so their hint never lies again once a second option exists.
  const chooseAskOption = useCallback(
    (index: number) => {
      const p = permissions[0];
      if (p?.kind === "ask") {
        void decidePermission(`option:${index}`);
        return;
      }
      if (!pendingRecoveryDecision) return;
      if (index === 0) void recoverFromDock();
    },
    [permissions, decidePermission, pendingRecoveryDecision, recoverFromDock],
  );

  const anyDecisionPending =
    Boolean(oauth) ||
    permissions.length > 0 ||
    diffQueue.length > 0 ||
    pendingPlanDecision != null;

  return {
    pendingPlanDecision,
    pendingRecoveryDecision,
    planArm,
    decidePermission,
    trustFolder,
    settlePlan,
    recoverFromDock,
    chooseAskOption,
    planSettling,
    anyDecisionPending,
  };
}
