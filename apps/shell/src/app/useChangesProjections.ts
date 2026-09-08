import { useCallback, useMemo, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ProductMode } from "../lib/api";
import { api } from "../lib/api";
import {
  type ChangesDockFilesState,
  type ChangesDockGitState,
  type ChangesDockMember,
  type ChangesDockVerifyState,
} from "../dock/ChangesDock";
import { projectRunVerifyList } from "../projections/runVerifyList";
import { projectRunGitReviewList, draftCommitMessageFromGitReview } from "../projections/runGitReviewList";
import { collapseChangeMembersByPath, projectRunChangeList, type PendingDiff } from "../projections/runChangeList";
import { catchUpForRun, type CatchUpMap } from "../projections/catchUpWindows";
import type { ActivityRecord, RunProjection } from "../projections/runReducer";
import type { useToast } from "../thread/Toast";

export interface UseChangesProjectionsParams {
  runProjection: RunProjection;
  /**
   * App.tsx's own `runProjectionRef` — the same mutable object, not a copy.
   * `settleOwnedDiff`/`acceptDiff`/`rejectDiff`/`recoverChangeMember` all
   * read `.current` for the freshest possible run data (it can run ahead of
   * the committed `runProjection` state while a FrameFlush-coalesced paint
   * is pending — see task-2-report.md and useArtifactBinding.ts's own note,
   * the prior hook extraction with this identical finding). The three dock
   * projection memos below read the plain `runProjection` state instead,
   * matching the pre-move source exactly — only the callbacks use the ref.
   */
  runProjectionRef: RefObject<RunProjection>;
  catchUpByRunId: CatchUpMap;
  productMode: ProductMode;
  sessionId: string | null;
  /**
   * App.tsx's own diffQueue state — not owned here. `onServerEvent` (far
   * outside this move) merges into it from several places, and several
   * App.tsx call sites (switchSession/newSession/removeSession/etc.) clear
   * it directly with `setDiffQueue([])`. Threaded through as a real
   * state/setter pair rather than re-derived, matching Task 9's
   * `pinnedPaths`/`branchMap` precedent for state with external writers.
   */
  diffQueue: PendingDiff[];
  setDiffQueue: Dispatch<SetStateAction<PendingDiff[]>>;
  /** App.tsx's own chrome-store selector; also read directly by ChatView. */
  changesOpen: boolean;
  /** App.tsx's own top-level view state (its local `View` type, restated
   *  here as a literal union so this module does not import from App.tsx);
   *  read in many other places there too. */
  view: "chat" | "settings" | "review";
  /** = App.tsx's `reportError`, renamed to the brief's own parameter name
   *  (mirrors Task 9's `railAuthLabel` -> `authLabel` rename precedent). */
  onError: (message: string) => void;
  toast: ReturnType<typeof useToast>;
}

export interface UseChangesProjectionsResult {
  changesDockFiles: ChangesDockFilesState;
  changesDockVerify: ChangesDockVerifyState;
  changesDockGit: ChangesDockGitState;
  changesActivityStatusById: Map<string, ActivityRecord["status"]>;
  changesActivityLifecycleById: Map<string, ActivityRecord["lifecycle"]>;
  changesActivityOutputById: Map<string, unknown>;
  changesAvailable: boolean;
  /** = App.tsx's old `changesDockVisible` (the brief's "changesVisible") —
   *  gates whether the side panel renders at all, alongside the dock data. */
  changesDockVisible: boolean;
  reviewCommitDraft: { subject: string; body: string } | null;
  /** Passthrough of the param — present so a caller that wants the whole
   *  bundle from one place (the brief's "one object" note) can get it here
   *  too. App.tsx itself keeps using its own already-in-scope `diffQueue`
   *  local (same value; see the report/task-10 for why it does not
   *  destructure this field back out). */
  diffQueue: PendingDiff[];
  changeRecoveryFlash: Record<string, "reverted" | "conflict">;
  changeRevertPendingEditId: string | null;
  acceptDiff: (id: string) => Promise<void>;
  rejectDiff: (id: string) => Promise<void>;
  recoverChangeMember: (member: ChangesDockMember) => Promise<void>;
  acceptAllDiffs: () => void;
  rejectAllDiffs: () => void;
  /**
   * Stable wrappers so ChangesDock (memo()) does not re-render on every App
   * render just because an inline arrow function got a new identity. Both
   * ChangesDock and ReviewSurface are wired to these exact three functions
   * (not separately-declared ones per surface) so the two surfaces cannot
   * drift — the brief's "keep it one object" note.
   */
  onChangesDockAccept: (id: string) => void;
  onChangesDockReject: (id: string) => void;
  onChangesDockRevert: (member: ChangesDockMember) => void;
}

export function useChangesProjections({
  runProjection,
  runProjectionRef,
  catchUpByRunId,
  productMode,
  sessionId,
  diffQueue,
  setDiffQueue,
  changesOpen,
  view,
  onError,
  toast,
}: UseChangesProjectionsParams): UseChangesProjectionsResult {
  const [changeRecoveryFlash, setChangeRecoveryFlash] = useState<Record<string, "reverted" | "conflict">>({});
  const [changeRevertPendingEditId, setChangeRevertPendingEditId] = useState<string | null>(null);

  // Changes dock aggregation — the dock is one panel beside the whole thread
  // (not per-run like the old in-stream sections), so it folds every run in
  // this session together, the same runs `.stream` already renders.
  const sessionRuns = useMemo(
    () =>
      runProjection.runOrder
        .map((id) => runProjection.runsById[id])
        .filter((run): run is NonNullable<typeof run> => Boolean(run) && run.sessionId === sessionId),
    [runProjection, sessionId],
  );
  const changesDockFiles: ChangesDockFilesState = useMemo(() => {
    if (productMode === "chat" || sessionRuns.length === 0) return { state: "ready", members: [] };
    const projections = sessionRuns.map((run) => ({
      run,
      projection: projectRunChangeList(run, catchUpForRun(catchUpByRunId, run.runId)),
    }));
    if (projections.some((p) => p.projection.state === "loading")) return { state: "loading" };
    const errored = projections.find((p): p is typeof p & { projection: { state: "error"; message: string } } =>
      p.projection.state === "error",
    );
    if (errored) return { state: "error", message: errored.projection.message };
    const members: ChangesDockMember[] = [];
    for (const { run, projection } of projections) {
      if (projection.state !== "ready") continue;
      for (const member of projection.members) members.push({ ...member, runId: run.runId });
    }
    return { state: "ready", members: collapseChangeMembersByPath(members) };
  }, [sessionRuns, catchUpByRunId, productMode]);
  const changesDockVerify: ChangesDockVerifyState = useMemo(() => {
    if (productMode === "chat" || sessionRuns.length === 0) return { state: "ready", members: [], runLive: false };
    const projections = sessionRuns.map((run) => projectRunVerifyList(run, catchUpForRun(catchUpByRunId, run.runId)));
    if (projections.some((p) => p.state === "loading")) return { state: "loading" };
    const errored = projections.find((p): p is typeof p & { state: "error"; message: string } => p.state === "error");
    if (errored) return { state: "error", message: errored.message };
    const members = projections.flatMap((p) => (p.state === "ready" ? p.members : []));
    // Any run still in flight keeps the whole set live: a check from an
    // unfinished run may still land, so no summary over these is settled yet.
    const runLive = projections.some((p) => (p.state === "ready" || p.state === "absent") && p.runLive);
    return { state: "ready", members, runLive };
  }, [sessionRuns, catchUpByRunId, productMode]);
  const changesDockGit: ChangesDockGitState = useMemo(() => {
    if (productMode !== "code" || sessionRuns.length === 0) return { state: "ready", members: [] };
    const projections = sessionRuns.map((run) => projectRunGitReviewList(run, catchUpForRun(catchUpByRunId, run.runId)));
    if (projections.some((p) => p.state === "loading")) return { state: "loading" };
    const errored = projections.find((p): p is typeof p & { state: "error"; message: string } => p.state === "error");
    if (errored) return { state: "error", message: errored.message };
    const members = projections.flatMap((p) => (p.state === "ready" ? p.members : []));
    return { state: "ready", members };
  }, [sessionRuns, catchUpByRunId, productMode]);
  const changesActivityStatusById = useMemo(() => {
    const map = new Map<string, ActivityRecord["status"]>();
    for (const run of sessionRuns) {
      for (const a of Object.values(run.activities)) map.set(a.activityId, a.status);
    }
    return map;
  }, [sessionRuns]);
  const changesActivityLifecycleById = useMemo(() => {
    const map = new Map<string, ActivityRecord["lifecycle"]>();
    for (const run of sessionRuns) {
      for (const a of Object.values(run.activities)) map.set(a.activityId, a.lifecycle);
    }
    return map;
  }, [sessionRuns]);
  const changesNonEmpty = (s: { state: string; members?: unknown[] }) =>
    s.state === "loading" || s.state === "error" || (s.state === "ready" && (s.members?.length ?? 0) > 0);
  const changesAvailable =
    changesNonEmpty(changesDockFiles) || changesNonEmpty(changesDockVerify) || changesNonEmpty(changesDockGit);
  // Review surface owns this same footprint (main + the changes panel) while
  // open, so the dock steps aside rather than the two competing for space.
  const changesDockVisible = changesAvailable && changesOpen && view !== "review";
  // Review surface's raw verify output block and its git-evidence commit
  // draft both read real activity.output — the same field paintEnvelopeActivity
  // already formats for the transcript's tool bubbles, just keyed for lookup.
  const changesActivityOutputById = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const run of sessionRuns) {
      for (const a of Object.values(run.activities)) map.set(a.activityId, a.output);
    }
    return map;
  }, [sessionRuns]);
  const reviewCommitDraft = useMemo(
    () =>
      changesDockGit.state === "ready"
        ? draftCommitMessageFromGitReview(changesDockGit.members, changesActivityOutputById)
        : null,
    [changesDockGit, changesActivityOutputById],
  );
  const recoverChangeMember = useCallback(async (member: ChangesDockMember) => {
    const run = runProjectionRef.current.runsById[member.runId];
    if (!run) return;
    setChangeRevertPendingEditId(member.editId);
    try {
      await api.editRecovery({ sessionId: run.sessionId, runId: run.runId, editId: member.editId });
      setChangeRecoveryFlash((prev) => ({
        ...prev,
        [member.editId]: "reverted",
        [member.activityId]: "reverted",
      }));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "recovery_conflict") {
        setChangeRecoveryFlash((prev) => ({
          ...prev,
          [member.editId]: "conflict",
          [member.activityId]: "conflict",
        }));
      } else {
        onError(e instanceof Error ? e.message : "Recovery failed");
      }
    } finally {
      setChangeRevertPendingEditId(null);
    }
  }, [onError]);

  const settleOwnedDiff = useCallback(async (id: string, action: "accept" | "reject") => {
    const owner = runProjectionRef.current.runOrder
      .map((runId) => runProjectionRef.current.runsById[runId])
      .find((run) => run && Object.values(run.decisions).some((d) => d.kind === "diff" && d.requestId === id));
    const decision = owner
      ? Object.values(owner.decisions).find((d) => d.kind === "diff" && d.requestId === id)
      : undefined;
    const activity = owner && decision
      ? Object.values(owner.activities).find(
          (a) => a.editId && (a.invocationId === decision.invocationId || a.editId === decision.requestId),
        )
      : undefined;
    if (owner && decision && activity?.editId) {
      await api.runDiff({
        sessionId: owner.sessionId,
        runId: owner.runId,
        requestId: decision.requestId,
        invocationId: decision.invocationId,
        editId: activity.editId,
        action,
      });
    } else {
      await api.diff(id, action);
    }
    return Boolean(owner && decision && decision.status === "pending");
  }, []);

  const acceptDiff = useCallback(async (id: string) => {
    try {
      const envelopePending = await settleOwnedDiff(id, "accept");
      if (!envelopePending) setDiffQueue((q) => q.filter((d) => d.id !== id));
      else {
        const latest = Object.values(runProjectionRef.current.runsById)
          .flatMap((run) => Object.values(run.decisions))
          .find((d) => d.requestId === id);
        if (!latest || latest.status !== "pending") {
          setDiffQueue((q) => q.filter((d) => d.id !== id));
        }
      }
      toast.push("File accepted", "success");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError, settleOwnedDiff, toast]);

  const rejectDiff = useCallback(async (id: string) => {
    try {
      const envelopePending = await settleOwnedDiff(id, "reject");
      if (!envelopePending) setDiffQueue((q) => q.filter((d) => d.id !== id));
      else {
        const latest = Object.values(runProjectionRef.current.runsById)
          .flatMap((run) => Object.values(run.decisions))
          .find((d) => d.requestId === id);
        if (!latest || latest.status !== "pending") {
          setDiffQueue((q) => q.filter((d) => d.id !== id));
        }
      }
      toast.push("File rejected", "info");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError, settleOwnedDiff, toast]);
  // Stable wrappers so ChangesDock (memo()) does not re-render on every App
  // render just because an inline arrow function got a new identity.
  const onChangesDockAccept = useCallback((id: string) => void acceptDiff(id), [acceptDiff]);
  const onChangesDockReject = useCallback((id: string) => void rejectDiff(id), [rejectDiff]);
  const onChangesDockRevert = useCallback(
    (member: ChangesDockMember) => void recoverChangeMember(member),
    [recoverChangeMember],
  );
  // DiffPanel's inline queue is gone, but its "settle everything currently
  // queued" shape is exactly what the Review surface's footer/Ctrl+⇧A need.
  const acceptAllDiffs = useCallback(() => {
    for (const d of diffQueue) void acceptDiff(d.id);
  }, [diffQueue, acceptDiff]);
  const rejectAllDiffs = useCallback(() => {
    for (const d of diffQueue) void rejectDiff(d.id);
  }, [diffQueue, rejectDiff]);

  return {
    changesDockFiles,
    changesDockVerify,
    changesDockGit,
    changesActivityStatusById,
    changesActivityLifecycleById,
    changesActivityOutputById,
    changesAvailable,
    changesDockVisible,
    reviewCommitDraft,
    diffQueue,
    changeRecoveryFlash,
    changeRevertPendingEditId,
    acceptDiff,
    rejectDiff,
    recoverChangeMember,
    acceptAllDiffs,
    rejectAllDiffs,
    onChangesDockAccept,
    onChangesDockReject,
    onChangesDockRevert,
  };
}
