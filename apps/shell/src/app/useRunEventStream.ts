import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { api, mergeState } from "../lib/api";
import type { PublicState, ServerEvent } from "../lib/api";
import {
  activityIdentityFor,
  closeFirstSights,
  createLiveActivityRun,
  freezeDisconnected,
  mergeToolDetail,
  reduceToolRun,
  stampFirstSight,
  type ActivityStamp,
  type LiveActivityRun,
} from "../projections/activityRun";
import {
  isRunStreamDelta,
  mergeRunSnapshot,
  reduceRunEvent,
  reduceRunEvents,
  type ActivityRecord,
  type RunEventEnvelope,
  type RunProjection,
  type RunProjectionRun,
} from "../projections/runReducer";
import { isOwnedMembership, ownedRunKeysFromProjection } from "../projections/activityMembership";
import {
  mergePendingDiffs,
  mergePendingPermissions,
  isStaleRailChip,
  railEvidenceFromRun,
  settledRailIdentities,
  type PendingDiff,
  type PermissionReq,
} from "../projections/runChangeList";
import {
  appliedThroughLastEventSeq,
  closeCatchUp,
  failCatchUp,
  openCatchUp,
  shouldOpenCatchUp,
  type CatchUpMap,
  type RestoreIntent,
} from "../projections/catchUpWindows";
import { parseRunEventEnvelope } from "../projections/runEventSchema";
import { endPageSend } from "../composer/composerSend";
import { notifyDesktop } from "../lib/desktopNotify";
import { cancelledDoneShouldPaint } from "../composer/promptSendHistory";
import { patchFirstRun, type FirstRunState } from "../lib/firstRun";
import { formatToolInput, formatToolOutput } from "../projections/toolFormat";
import { FrameFlush, StreamBuffer } from "../thread/streamBuffer";
import type { ChatMessage } from "../surfaces/MessageList";
import type { useToast } from "../thread/Toast";

/**
 * Restates App.tsx's own, unexported `RunPhase` shape rather than importing
 * it from App.tsx — matches useComposerSend.ts's own precedent (which
 * restates the identical shape for the identical reason: App.tsx's type is
 * private, and `setRunPhase`'s Dispatch type only needs its shape, not the
 * name itself).
 */
type RunPhase = "waiting_model" | "reasoning" | "tools" | "writing" | "done" | null;

/**
 * Restates App.tsx's own, unexported `OAuthPending` shape rather than
 * importing it from App.tsx — same precedent as `RunPhase` above, and
 * matches useComposerSend.ts's/useDecisions.ts's own `OAuthPendingLike`.
 * Unlike those two hooks (which only ever test `oauth` for truthiness),
 * `onServerEvent`'s own `oauth_pending`/`oauth_complete` handlers construct
 * and clear a real value of this exact shape, so the full shape — not just
 * truthiness — is required here.
 */
type OAuthPendingLike = {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
};

export interface UseRunEventStreamParams {
  // ---- identity -------------------------------------------------------
  /** App.tsx's own `sessionIdRef` — many other consumers (Task 2's mirror
   *  effect; `useComposerSend`/`useChangesProjections`/`useDecisions` all
   *  take it too), stays declared there. */
  sessionIdRef: RefObject<string | null>;

  // ---- run projection / messages (App.tsx-owned; NOT owned here) -------
  /**
   * `runProjection`/`messages`'s own `useState`s — and everything in
   * `runProjection`'s own cluster (`runProjectionRef`,
   * `pendingProjectionPaintRef`, `projectionFlushRef`, `commitRunProjection`,
   * `setRunProjection`) — do **not** move into this hook, despite being
   * named in the brief's illustrative "Returns" list. This is a
   * hook-ordering impossibility, not a style choice — the same shape as
   * Task 11's finding for `permissions`/`diffQueue`/`oauth` and Task 12's
   * for `draft`. `useArtifactBinding` (Task 7) is called from `App()` at a
   * position well before any legal call site for this hook (`onServerEvent`
   * below needs `reportError`, itself declared after `useArtifactBinding`'s
   * own call site), and takes `runProjection`/`messages`/`runProjectionRef`/
   * `messagesRef` directly as constructor-time parameters. A
   * `useRunEventStream` call can only sit at *one* textual position; moving
   * `runProjection`/`messages`'s `useState` into this hook would force
   * `useArtifactBinding`'s own already-committed, already-tested call site
   * to move too, which is out of this task's scope and a materially larger,
   * riskier change than leaving the state exactly where it is. Both `const
   * [messages, setMessages]` and `const [runProjection, setRunProjection]`
   * (plus `runProjectionRef`'s own render-time, `pendingProjectionPaintRef`-
   * gated write) stay byte-for-byte untouched in App.tsx — this hook
   * receives full read/write access to the pieces it actually touches as
   * parameters instead. See task-13-report.md Step 1 for the full trace.
   *
   * `catchUpByRunId` has no such blocker (its only outside reader is a JSX
   * prop, far downstream of any legal call site for this hook) and *is*
   * owned here — see `UseRunEventStreamResult`.
   */
  runProjectionRef: RefObject<RunProjection>;
  pendingProjectionPaintRef: RefObject<boolean>;
  projectionFlushRef: RefObject<FrameFlush | null>;
  setRunProjection: Dispatch<SetStateAction<RunProjection>>;
  commitRunProjection: (next: RunProjection) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  /** Task 2's "pre-existing correct example" — mirrored from `messages` in
   *  an App.tsx effect. Read-only here (`exportSessionDiagnostics`-style
   *  latest-value reads inside `onServerEvent`'s "done" handler and the
   *  `tool_run` handler). */
  messagesRef: RefObject<ChatMessage[]>;

  // ---- refs shared with other, already-extracted hooks (Task 7's
  //      precedent: pass the real object through, never re-derive) ------
  /** Has an outside consumer (`useComposerSend`'s `sendText`, plus
   *  `requestCancel`, both outside this move) — stays declared in App.tsx. */
  streamEpochRef: RefObject<number>;
  normalizedRunIdRef: RefObject<string | null>;
  pendingPromptMessageIdRef: RefObject<string | null>;
  pendingPromptSessionIdRef: RefObject<string | null>;
  cancelGenerationRef: RefObject<number>;
  /** Written here (`stampActivity`), but read by the unmoved "First-sight
   *  of a tool group" `useLayoutEffect` in App.tsx — stays declared there. */
  activityRevealRef: RefObject<string | null>;
  /** Written in an effect in App.tsx (Task 2's "pre-existing correct
   *  example"); read-only here (`onServerEvent`'s `state` event handler). */
  stateRef: RefObject<PublicState | null>;
  /** Dual-write ref (Task 2): mirrored from `busy` in an App.tsx effect, and
   *  set eagerly inside `useComposerSend`'s `sendText` the instant a send is
   *  admitted. This hook only ever reads it. */
  busyRef: RefObject<boolean>;
  sendInFlightRef: RefObject<boolean>;
  cancelInFlightRef: RefObject<boolean>;

  // ---- App()-owned state this task does not move (setters only — every
  //      call site below is a bare reset or a functional updater, so no
  //      value ever needs to be threaded through, only the setter) ------
  setModelDraft: Dispatch<SetStateAction<string>>;
  setShellAllowlist: Dispatch<SetStateAction<boolean>>;
  setOauth: Dispatch<SetStateAction<OAuthPendingLike | null>>;
  setErrorBanner: Dispatch<SetStateAction<string | null>>;
  setFirstRun: Dispatch<SetStateAction<FirstRunState>>;
  setRunFooter: Dispatch<SetStateAction<string | null>>;
  setRunStartedAt: Dispatch<SetStateAction<number | null>>;
  setRunPhase: Dispatch<SetStateAction<RunPhase>>;
  setRunPhaseDetail: Dispatch<SetStateAction<string | null>>;
  setAwaitingNextTurn: Dispatch<SetStateAction<boolean>>;
  /** `permissions`/`diffQueue`'s own `useState`s cannot move here either —
   *  the same rAF-throttle-effect blocker Tasks 11/12 already documented
   *  (an unmoved effect reads both at their original, very early
   *  declaration position). Written here via `mergePendingDiffs`/
   *  `mergePendingPermissions`, so both setters are threaded through; the
   *  raw values are never read by anything in this move. */
  setDiffQueue: Dispatch<SetStateAction<PendingDiff[]>>;
  setPermissions: Dispatch<SetStateAction<PermissionReq[]>>;

  // ---- App()-owned callbacks --------------------------------------------
  applyState: (payload: PublicState) => void;
  reportError: (message: string, meta?: Record<string, unknown>) => void;
  toast: ReturnType<typeof useToast>;
  /** App.tsx's own module-level `uid()` helper (a plain, stateless id
   *  generator declared above `App()`, not exported) — threaded through as
   *  a parameter rather than imported, matching `useComposerSend`'s own
   *  precedent (avoids a circular App.tsx <-> useRunEventStream.ts import
   *  for a function with zero dependency on component state). */
  uid: () => string;
}

export interface UseRunEventStreamResult {
  // ---- owned here (no outside blocker; see the params doc above) -------
  catchUpByRunId: CatchUpMap;

  // ---- the streaming engine ----------------------------------------------
  discardTranscriptStream: () => void;
  /**
   * Named in the brief's "Moves:" line but omitted from its illustrative
   * return list — required regardless, since `useComposerSend`'s own
   * `sendText` (Task 12, already extracted) takes it as a real parameter
   * (its only caller in the whole file). Same shape as Task 10's
   * `onChangesDockAccept`/Task 12's `onReviewSendToGrok` finding.
   */
  beginStreamRun: () => void;
  /** Same story as `beginStreamRun` — `onServerEvent` (below) calls it
   *  internally, and `useComposerSend`'s `sendText` also calls it directly,
   *  as a real parameter. */
  bindNormalizedRun: (runId: string, ownerSessionId: string) => void;

  // ---- activity/rail identity — only the ref mirrors have an outside
  //      consumer (`useComposerSend`'s `sendText`); the raw
  //      `applyRailEvidence`/`paintEnvelopeActivity` callbacks and
  //      `stampActivity` have none, so only the refs are part of this
  //      return type ------------------------------------------------------
  applyRailEvidenceRef: RefObject<(nextRun: RunProjectionRun) => void>;
  paintEnvelopeActivityRef: RefObject<(activity: ActivityRecord, runId?: string | null) => void>;
  /** The unmoved HostSocket-connect effect in App.tsx calls this directly
   *  (transport-loss freeze) and lists it in its own dependency array — not
   *  in the brief's illustrative return list, required regardless. */
  markDisconnectedActivity: () => void;

  onServerEvent: (ev: ServerEvent) => void;

  // ---- journal restore/reconcile trio -------------------------------------
  /**
   * `restoreOwnedRunJournal` — the third, unnamed member of the brief's
   * "journal restore/reconcile trio" — has no outside caller (only
   * `restoreOwnedRuns` calls it), so it is not part of this return type.
   */
  restoreOwnedRuns: (intent: RestoreIntent) => Promise<{ ok: boolean; hasNonterminal: boolean }>;
  reconcileOwnedRuns: () => Promise<{ ok: boolean; hasNonterminal: boolean }>;
}

/**
 * The run-event stream engine — the highest-value, highest-risk extraction
 * in this series (Task 13). Owns `messages`'s and `runProjection`'s *write*
 * paths (nearly every other region of App.tsx reads one or both), so this
 * hook's return shape is the app-wide contract those regions now depend on.
 *
 * Moved verbatim out of App.tsx: the streaming engine
 * (`discardTranscriptStream`/`beginStreamRun`/`bindNormalizedRun`, the
 * batched projection-flush effect, the StreamBuffer token-accumulation
 * effect), the activity/rail identity helpers (`stampActivity`/
 * `applyRailEvidence`/`paintEnvelopeActivity`/`markDisconnectedActivity` and
 * their ref mirrors), `onServerEvent`, and the journal restore/reconcile
 * trio (`restoreOwnedRunJournal`/`restoreOwnedRuns`/`reconcileOwnedRuns`) —
 * in that order, matching both the brief's own listing and the pre-move
 * source's relative order. Every closed-over identifier that stays declared
 * in App.tsx (refs, setters, `reportError`/`toast`/`applyState`/`uid`) is
 * threaded through under its exact original name, so zero renames were
 * needed anywhere in the moved bodies — see task-13-report.md's diff proof.
 *
 * Two ref-mirror pairs deliberately stay behind in App.tsx instead of
 * moving with the callback they mirror, because their only reader is an
 * unmoved effect that exists purely to avoid rebuilding the transport on
 * every callback-identity change:
 *  - `onServerEventRef` (mirrors `onServerEvent` for the HostSocket-connect
 *    effect's `sock.on((ev) => onServerEventRef.current(ev))`).
 *  - `restoreOwnedRunsRef` (mirrors `restoreOwnedRuns` for that same
 *    effect's disconnect-reconnect continuation).
 * Both effects now read the mirrored value off this hook's return
 * (`onServerEvent`/`restoreOwnedRuns`) instead of a same-file `const` — see
 * task-13-report.md Step 3.
 *
 * `runProjectionRef`'s render-time, `pendingProjectionPaintRef`-gated write
 * is not part of this hook at all — it lives in App.tsx, right alongside
 * the `runProjection` state it mirrors, completely untouched by this move.
 * Its FrameFlush-coalescing timing is therefore preserved exactly, by
 * construction: nothing about it changed.
 */
export function useRunEventStream({
  sessionIdRef,
  runProjectionRef,
  pendingProjectionPaintRef,
  projectionFlushRef,
  setRunProjection,
  commitRunProjection,
  setMessages,
  messagesRef,
  streamEpochRef,
  normalizedRunIdRef,
  pendingPromptMessageIdRef,
  pendingPromptSessionIdRef,
  cancelGenerationRef,
  activityRevealRef,
  stateRef,
  busyRef,
  sendInFlightRef,
  cancelInFlightRef,
  setModelDraft,
  setShellAllowlist,
  setOauth,
  setErrorBanner,
  setFirstRun,
  setRunFooter,
  setRunStartedAt,
  setRunPhase,
  setRunPhaseDetail,
  setAwaitingNextTurn,
  setDiffQueue,
  setPermissions,
  applyState,
  reportError,
  toast,
  uid,
}: UseRunEventStreamParams): UseRunEventStreamResult {
  // ---- state/refs owned fully here — no outside consumer beyond their own
  //      declaration (checked by grep across the whole file before moving
  //      anything; see task-13-report.md Step 1) --------------------------
  const [catchUpByRunId, setCatchUpByRunId] = useState<CatchUpMap>({});
  const reconcileRunsInFlightRef = useRef<Promise<{ ok: boolean; hasNonterminal: boolean }> | null>(null);
  const toolFailCountRef = useRef(0);
  const streamBufRef = useRef<StreamBuffer | null>(null);
  const liveActivityRunRef = useRef<LiveActivityRun | null>(null);
  const eventEpochRef = useRef(0);
  const nextActivityRunCounterRef = useRef(0);
  const streamIdRef = useRef<string | null>(null);
  const thinkingIdRef = useRef<string | null>(null);

  const discardTranscriptStream = useCallback(() => {
    // Invalidate in-flight stream paint (session/mode switch).
    if (liveActivityRunRef.current) {
      liveActivityRunRef.current.acceptingFirstSight = false;
    }
    eventEpochRef.current += 1;
    streamEpochRef.current = eventEpochRef.current; // keep equal — only send() opens a new run
    streamBufRef.current?.reset();
    streamIdRef.current = null;
    thinkingIdRef.current = null;
    normalizedRunIdRef.current = null;
    pendingPromptMessageIdRef.current = null;
    pendingPromptSessionIdRef.current = null;
  }, []);

  /** Start accepting stream events for a new user turn. */
  const beginStreamRun = useCallback(() => {
    eventEpochRef.current += 1;
    streamEpochRef.current = eventEpochRef.current;
    const counter = nextActivityRunCounterRef.current++;
    liveActivityRunRef.current = createLiveActivityRun(
      eventEpochRef.current,
      `activity-run:${counter}`,
    );
    streamBufRef.current?.reset();
    streamIdRef.current = null;
    thinkingIdRef.current = null;
    normalizedRunIdRef.current = null;
    pendingPromptMessageIdRef.current = null;
    pendingPromptSessionIdRef.current = null;
  }, []);

  const bindNormalizedRun = useCallback((runId: string, ownerSessionId: string) => {
    normalizedRunIdRef.current = runId;
    if (pendingPromptSessionIdRef.current !== ownerSessionId) return;
    const promptMessageId = pendingPromptMessageIdRef.current;
    if (!promptMessageId) return;
    setMessages((prev) => prev.map((message) =>
      message.id === promptMessageId
        ? { ...message, projectedRunId: runId }
        : message,
    ));
  }, []);

  // Batched stream flushes → single setMessages per frame
  useEffect(() => {
    const projectionFlush = new FrameFlush(() => {
      pendingProjectionPaintRef.current = false;
      setRunProjection(runProjectionRef.current);
    });
    projectionFlushRef.current = projectionFlush;
    return () => {
      projectionFlush.cancel();
      if (projectionFlushRef.current === projectionFlush) projectionFlushRef.current = null;
    };
  }, []);

  useEffect(() => {
    const buf = new StreamBuffer((text) => {
      if (streamEpochRef.current !== eventEpochRef.current) return;
      if (!text) return;
      setMessages((prev) => {
        let sid = streamIdRef.current;
        if (sid) {
          const idx = prev.findIndex((m) => m.id === sid);
          if (idx >= 0) {
            const next = prev.slice();
            const cur = next[idx]!;
            next[idx] = {
              ...cur,
              content: (cur.content || "") + text,
              projectedRunId: cur.projectedRunId ?? normalizedRunIdRef.current ?? undefined,
              streaming: true,
            };
            return next;
          }
          // Race: streamId was reserved but this message isn't in `prev` yet
          // (prior setState not committed). Do NOT mint a second bubble — create
          // with the same id so later flushes merge into one answer.
          return [
            ...prev,
            {
              id: sid,
              role: "assistant",
              content: text,
              projectedRunId: normalizedRunIdRef.current ?? undefined,
              streaming: true,
            },
          ];
        }
        // Prefer continuing the open streaming assistant (tools / thinking)
        const openAsst = [...prev]
          .reverse()
          .find((m) => m.role === "assistant" && m.streaming);
        if (openAsst) {
          streamIdRef.current = openAsst.id;
          return prev.map((m) =>
            m.id === openAsst.id
              ? {
                  ...m,
                  content: (m.content || "") + text,
                  projectedRunId: m.projectedRunId ?? normalizedRunIdRef.current ?? undefined,
                  streaming: true,
                }
              : m,
          );
        }
        // Reattach trailing junk (e.g. lone ".") to the last assistant answer
        const lastAsst = [...prev]
          .reverse()
          .find((m) => m.role === "assistant");
        const trivial = /^[.\s…·•]+$/.test(text);
        if (
          lastAsst &&
          (trivial ||
            (busyRef.current &&
              Boolean(normalizedRunIdRef.current) &&
              lastAsst.projectedRunId === normalizedRunIdRef.current)) &&
          (lastAsst.content?.trim() || lastAsst.thinking?.trim())
        ) {
          if (trivial && lastAsst.content?.trim()) {
            return prev;
          }
          streamIdRef.current = lastAsst.id;
          return prev.map((m) =>
            m.id === lastAsst.id
              ? {
                  ...m,
                  content: (m.content || "") + text,
                  projectedRunId: m.projectedRunId ?? normalizedRunIdRef.current ?? undefined,
                  streaming: Boolean(busyRef.current),
                }
              : m,
          );
        }
        const id = uid();
        streamIdRef.current = id;
        return [
          ...prev,
          {
            id,
            role: "assistant",
            content: text,
            projectedRunId: normalizedRunIdRef.current ?? undefined,
            streaming: true,
          },
        ];
      });
    });
    streamBufRef.current = buf;
    return () => {
      buf.flush();
      buf.reset();
    };
  }, []);

  const stampActivity = useCallback(
    (identity: string): ActivityStamp | null => {
      const run = liveActivityRunRef.current;
      if (!run || run.epoch !== eventEpochRef.current || run.frozenDisconnected) {
        if (run?.frozenDisconnected) {
          void api.clientLog("debug", "activity ignored while disconnected", { identity });
        }
        return null;
      }
      const wasFirstSight = run.acceptingFirstSight && !run.seen.has(identity);
      const stamp = stampFirstSight(run, identity);
      if (wasFirstSight && stamp) {
        activityRevealRef.current = stamp.activityRunKey;
      }
      return stamp;
    },
    [],
  );

  const applyRailEvidence = useCallback((nextRun: NonNullable<RunProjection["runsById"][string]>) => {
    const owned = ownedRunKeysFromProjection(
      runProjectionRef.current.runOrder.map((id) => runProjectionRef.current.runsById[id]),
      sessionIdRef.current,
    );
    if (!isOwnedMembership(owned, { sessionId: nextRun.sessionId, runId: nextRun.runId })) return;
    const evidence = railEvidenceFromRun(nextRun);
    const settled = settledRailIdentities(nextRun);
    setMessages((prev) => {
      let changed = false;
      const next = prev.filter((m) => {
        if (!isStaleRailChip(m, settled)) return true;
        changed = true;
        return false;
      });
      const identities = new Set(next.map((m) => m.activityIdentity).filter((id): id is string => Boolean(id)));
      for (const item of evidence) {
        if (identities.has(item.identity)) continue;
        if (next.some((m) => m.role === "system" && m.content === item.content)) continue;
        const stamp = stampActivity(item.identity);
        next.push({
          id: `rail-${item.identity}`,
          role: "system",
          content: item.content,
          activityIdentity: stamp?.activityIdentity ?? item.identity,
          activityRunKey: stamp?.activityRunKey,
          activityOrder: stamp?.activityOrder,
        });
        identities.add(item.identity);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [stampActivity]);
  const applyRailEvidenceRef = useRef(applyRailEvidence);
  // Mirror in an effect, not during render (Task 2) — matches
  // onServerEventRef's established pattern for a callback-identity mirror.
  useEffect(() => {
    applyRailEvidenceRef.current = applyRailEvidence;
  }, [applyRailEvidence]);

  const paintEnvelopeActivity = useCallback((activity: ActivityRecord, runId?: string | null) => {
    const rid = runId ?? normalizedRunIdRef.current ?? null;
    if (!rid) return;
    const ownerSessionId = runProjectionRef.current.runsById[rid]?.sessionId;
    if (!ownerSessionId) return;
    const owned = ownedRunKeysFromProjection(
      runProjectionRef.current.runOrder.map((id) => runProjectionRef.current.runsById[id]),
      sessionIdRef.current,
    );
    if (!isOwnedMembership(owned, { sessionId: ownerSessionId, runId: rid })) return;
    const identity = `tool:${activity.activityId}:${activity.invocationId}`;
    const stamp = stampActivity(identity);
    if (!stamp) return;
    const body = activity.output != null ? formatToolOutput(activity.output) : "";
    const projectedRunId = rid;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.role === "tool" && m.activityIdentity === identity);
      const entry: ChatMessage = {
        id: activity.activityId,
        role: "tool",
        content: body || (activity.input != null ? formatToolInput(activity.input) : ""),
        activityIdentity: stamp.activityIdentity,
        activityRunKey: stamp.activityRunKey,
        activityOrder: stamp.activityOrder,
        projectedRunId,
        toolMeta: {
          activityId: activity.activityId,
          toolCallId: activity.invocationId,
          name: activity.name,
          title: activity.title ?? null,
          summary: activity.summary ?? activity.command ?? activity.path ?? undefined,
          ok: activity.execution === "executed" ? activity.status === "succeeded" : undefined,
          done: activity.lifecycle === "terminal",
          lifecycle: activity.lifecycle,
          execution: activity.execution,
          status: activity.status,
          command: activity.command,
        },
      };
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx]!, ...entry, toolMeta: { ...next[idx]!.toolMeta, ...entry.toolMeta } };
        return next;
      }
      return [...prev, entry];
    });
  }, [stampActivity]);
  const paintEnvelopeActivityRef = useRef(paintEnvelopeActivity);
  // Mirror in an effect, not during render (Task 2) — matches
  // onServerEventRef's established pattern for a callback-identity mirror.
  useEffect(() => {
    paintEnvelopeActivityRef.current = paintEnvelopeActivity;
  }, [paintEnvelopeActivity]);

  const markDisconnectedActivity = useCallback(() => {
    const run = liveActivityRunRef.current;
    if (!run || run.frozenDisconnected) return;
    freezeDisconnected(run);
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "tool" && m.toolMeta?.done === false
          ? { ...m, content: `${m.content}\nOffline — tool status may be incomplete.` }
          : m,
      ),
    );
  }, []);

  const onServerEvent = useCallback((ev: ServerEvent) => {
    // Contract v1 run envelopes are reduced by owner identity and eventSeq;
    // legacy transcript events below remain for older hosts during migration.
    if (typeof (ev as unknown as { schemaVersion?: number }).schemaVersion === "number" && "eventSeq" in (ev as object)) {
      const parsed = parseRunEventEnvelope(ev);
      if (!parsed) return;
      const runEvent = parsed as unknown as RunEventEnvelope;
      if (runEvent.payload.kind === "run_started") {
        bindNormalizedRun(runEvent.runId, runEvent.sessionId);
      }
      // Sequential live envelopes must reduce from the latest snapshot, not
      // a batched updater. Dock pending is rebuilt from durable evidence.
      // Token deltas stay on the ref and paint once per frame; other kinds
      // cancel that coalesce so decision/activity/terminal land immediately.
      const prevProjection = runProjectionRef.current;
      const next = reduceRunEvent(prevProjection, runEvent);
      if (next === prevProjection) return;
      runProjectionRef.current = next;
      if (isRunStreamDelta(runEvent.payload.kind)) {
        pendingProjectionPaintRef.current = true;
        projectionFlushRef.current?.ping();
      } else {
        commitRunProjection(next);
      }
      const nextRun = next.runsById[runEvent.runId];
      const envelopeOwned = isOwnedMembership(
        ownedRunKeysFromProjection(
          next.runOrder.map((id) => next.runsById[id]),
          sessionIdRef.current,
        ),
        { sessionId: runEvent.sessionId, runId: runEvent.runId },
      );
      if (
        nextRun &&
        envelopeOwned &&
        (runEvent.payload.kind === "decision_request" || runEvent.payload.kind === "activity_update")
      ) {
        setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
        setPermissions((prev) => mergePendingPermissions(prev, nextRun));
        applyRailEvidenceRef.current(nextRun);
        if (runEvent.payload.kind === "activity_update") {
          paintEnvelopeActivityRef.current(runEvent.payload.activity, runEvent.runId);
        }
      }
      if (runEvent.payload.kind === "run_terminal") {
        if (!envelopeOwned) return;
        if (nextRun) {
          setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
          setPermissions((prev) => mergePendingPermissions(prev, nextRun));
          applyRailEvidenceRef.current(nextRun);
        }
        endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
        setRunPhase(null);
        setRunPhaseDetail(null);
        setAwaitingNextTurn(true);
        const kind = runEvent.payload.terminalKind;
        void notifyDesktop(
          "Forge",
          kind === "answered" ? "Answer ready" : kind === "cancelled" ? "Run cancelled" : "Run ended",
        );
      } else if (runEvent.payload.kind === "run_state") {
        if (!envelopeOwned) return;
        setRunPhaseDetail(runEvent.payload.state === "recovering" ? "Recovering run…" : runEvent.payload.state === "cancelling" ? "Ending run…" : null);
      }
      return;
    }
    if (ev.type === "state") {
      applyState(ev.state);
      setModelDraft(ev.state.model);
      const merged = mergeState(stateRef.current, ev.state);
      const codeAgent = merged.codeAgent ?? null;
      const codePreAcquireOk =
        merged.mode === "code" &&
        codeAgent != null &&
        codeAgent.resolveStatus !== "hard_fail";
      // Pre-acquire Code `connected: false` is expected (no child yet) — not
      // transport/ownership loss. Do not freeze activity as disconnected.
      if (!merged.connected && !codePreAcquireOk) markDisconnectedActivity();
      if (typeof ev.state.shellAllowlist === "boolean") {
        setShellAllowlist(ev.state.shellAllowlist);
      }
      return;
    }
    if (ev.type === "oauth_pending") {
      setOauth({
        user_code: ev.user_code,
        verification_uri: ev.verification_uri,
        verification_uri_complete: ev.verification_uri_complete,
      });
      return;
    }
    if (ev.type === "oauth_complete") {
      setOauth(null);
      if (ev.ok) {
        setErrorBanner(null);
        setFirstRun((fr) => patchFirstRun({ ...fr, signedIn: true }));
        setMessages((m) => [
          ...m,
          { id: uid(), role: "system", content: "Signed in with Grok (OAuth)." },
        ]);
      } else {
        reportError(ev.message || "OAuth failed", { source: "oauth" });
      }
      return;
    }
    // Transcript-bound events: ignore after session/mode switch
    const epochOk = streamEpochRef.current === eventEpochRef.current;
    if (ev.type === "run_phase") {
      // Owned-run journal is live thought/tools/answer/phase authority.
      if (normalizedRunIdRef.current) return;
      // Always update chrome for active busy runs even if epoch drifted
      if (epochOk || busyRef.current) {
        setRunPhase(ev.phase === "done" ? null : ev.phase);
        setRunPhaseDetail(ev.detail ?? null);
      }
      if (ev.phase === "done" && epochOk) {
        // keep thinkingId until text flush / done handler
      }
      return;
    }
    if (ev.type === "thinking_delta") {
      if (normalizedRunIdRef.current) return;
      if (!epochOk) return;
      setRunPhase((p) => p || "reasoning");
      setMessages((prev) => {
        const tid = thinkingIdRef.current;
        if (tid) {
          const idx = prev.findIndex((m) => m.id === tid);
          if (idx >= 0) {
            const next = prev.slice();
            const cur = next[idx]!;
            next[idx] = {
              ...cur,
              thinking: (cur.thinking || "") + ev.text,
              projectedRunId: cur.projectedRunId ?? normalizedRunIdRef.current ?? undefined,
              streaming: true,
            };
            return next;
          }
          // Same race as text stream: keep one bubble id
          return [
            ...prev,
            {
              id: tid,
              role: "assistant",
              content: "",
              thinking: ev.text,
              projectedRunId: normalizedRunIdRef.current ?? undefined,
              streaming: true,
            },
          ];
        }
        // Prefer existing streaming assistant over a second bubble
        const openAsst = [...prev]
          .reverse()
          .find((m) => m.role === "assistant" && m.streaming);
        if (openAsst) {
          thinkingIdRef.current = openAsst.id;
          streamIdRef.current = openAsst.id;
          return prev.map((m) =>
            m.id === openAsst.id
              ? {
                  ...m,
                  thinking: (m.thinking || "") + ev.text,
                  projectedRunId: m.projectedRunId ?? normalizedRunIdRef.current ?? undefined,
                  streaming: true,
                }
              : m,
          );
        }
        const id = uid();
        thinkingIdRef.current = id;
        streamIdRef.current = id;
        return [
          ...prev,
          {
            id,
            role: "assistant",
            content: "",
            thinking: ev.text,
            projectedRunId: normalizedRunIdRef.current ?? undefined,
            streaming: true,
          },
        ];
      });
      return;
    }
    if (ev.type === "text_delta") {
      if (normalizedRunIdRef.current) return;
      if (!epochOk) {
        // Recovery: if we are still busy, re-bind epoch so answer is not lost
        if (busyRef.current) {
          streamEpochRef.current = eventEpochRef.current;
        } else {
          return;
        }
      }
      // Prefer same bubble as thinking if open
      if (thinkingIdRef.current && !streamIdRef.current) {
        streamIdRef.current = thinkingIdRef.current;
      }
      streamBufRef.current?.push(ev.text);
      return;
    }
    if (ev.type === "tool_run") {
      if (normalizedRunIdRef.current) return;
      if (!epochOk) return;
      streamBufRef.current?.flush();
      const toolEvent = ev;
      const validTuple =
        toolEvent.schemaVersion === 2 &&
        Boolean(toolEvent.activityId.trim()) &&
        Boolean(toolEvent.toolCallId.trim()) &&
        ((toolEvent.lifecycle === "pending" && toolEvent.execution === null && toolEvent.status === "running") ||
          (toolEvent.lifecycle === "terminal" &&
            ((toolEvent.execution === "executed" && (toolEvent.status === "succeeded" || toolEvent.status === "failed")) ||
              (toolEvent.execution === "not_executed" && toolEvent.status === "rejected"))));
      if (!validTuple) {
        void api.clientLog("warn", "ignored malformed tool_run event", {
          activityId: toolEvent.activityId,
          toolCallId: toolEvent.toolCallId,
        });
        return;
      }
      setRunPhase("tools");
      const identity = activityIdentityFor(toolEvent);
      const stamp = stampActivity(identity);
      if (!stamp) return;
      const current = messagesRef.current.find(
        (m) => m.role === "tool" && m.activityIdentity === identity,
      );
      const reduction = reduceToolRun(
        current
          ? {
              activityRunKey: current.activityRunKey,
              activityOrder: current.activityOrder,
              activityIdentity: current.activityIdentity,
              activity: current.toolMeta?.activityEvent,
            }
          : null,
        toolEvent,
        stamp,
      );
      if (reduction.kind === "ignore") return;
      const body = toolEvent.output ? formatToolOutput(toolEvent.output) : "";
      if (toolEvent.status === "failed") {
        toolFailCountRef.current += 1;
        if (toolFailCountRef.current === 1 || toolFailCountRef.current % 3 === 0) {
          reportError(`${toolEvent.name || "tool"} failed`, {
            code: "tool_error", source: "tool", snippet: (toolEvent.error || body).slice(0, 200),
          });
        }
      }
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.role === "tool" && m.activityIdentity === identity);
        if (reduction.kind === "enrich" && idx >= 0) {
          const cur = prev[idx]!;
          const existing = cur.toolMeta?.activityEvent;
          if (!existing) return prev;
          const enriched = mergeToolDetail(existing, reduction.detail);
          const next = prev.slice();
          next[idx] = {
            ...cur,
            toolMeta: {
              ...cur.toolMeta,
              activityEvent: enriched,
              name: enriched.name ?? cur.toolMeta?.name,
              summary: enriched.summary ?? cur.toolMeta?.summary,
            },
          };
          return next;
        }
        const st = reduction.stamp;
        const entry: ChatMessage = {
          id: toolEvent.activityId,
          role: "tool",
          content: body || (toolEvent.input != null ? formatToolInput(toolEvent.input) : current?.content || ""),
          activityIdentity: st.activityIdentity,
          activityRunKey: st.activityRunKey,
          activityOrder: st.activityOrder,
          toolMeta: {
            activityId: toolEvent.activityId,
            toolCallId: toolEvent.toolCallId,
            activityEvent: toolEvent,
            name: toolEvent.name ?? current?.toolMeta?.name,
            summary: toolEvent.summary ?? current?.toolMeta?.summary,
            ok: toolEvent.execution === "executed" ? toolEvent.status === "succeeded" : undefined,
            done: toolEvent.lifecycle === "terminal",
            lifecycle: toolEvent.lifecycle,
            execution: toolEvent.execution,
            status: toolEvent.status,
            detailAvailable: toolEvent.detailAvailable,
            reasonCode: toolEvent.reasonCode,
            reason: toolEvent.reason,
            command: toolEvent.command,
          },
        };
        if (idx >= 0) {
          const next = prev.slice();
          const prior = next[idx]!;
          if (prior.toolMeta?.activityEvent?.lifecycle === "terminal" && toolEvent.lifecycle === "pending") {
            const enriched = mergeToolDetail(prior.toolMeta.activityEvent, {
              activityId: toolEvent.activityId,
              toolCallId: toolEvent.toolCallId,
              name: toolEvent.name,
              input: toolEvent.input,
              summary: toolEvent.summary,
              command: toolEvent.command,
              shellDisplayName: toolEvent.shellDisplayName,
            });
            next[idx] = {
              ...prior,
              toolMeta: {
                ...prior.toolMeta,
                activityEvent: enriched,
                name: enriched.name ?? prior.toolMeta.name,
                summary: enriched.summary ?? prior.toolMeta.summary,
              },
            };
            return next;
          }
          next[idx] = {
            ...entry,
            activityRunKey: entry.activityRunKey ?? prior.activityRunKey,
            activityOrder: entry.activityOrder ?? prior.activityOrder,
            activityIdentity: entry.activityIdentity ?? prior.activityIdentity,
            toolMeta: {
              ...prior.toolMeta,
              ...entry.toolMeta,
              name: entry.toolMeta?.name ?? prior.toolMeta?.name,
              summary: entry.toolMeta?.summary ?? prior.toolMeta?.summary,
              activityEvent: toolEvent,
            },
          };
          return next;
        }
        return [...prev, entry];
      });
      return;
    }
    if (ev.type === "permission_request") {
      if (!epochOk) return;
      streamBufRef.current?.flush();
      const stamp = stampActivity(`permission:${ev.id}`);
      if (!stamp) return;
      setPermissions((q) => {
        if (q.some((p) => p.id === ev.id)) return q;
        const owner = Object.values(runProjectionRef.current.runsById).find(
          (r) => r.state !== "terminal",
        );
        return [...q, {
          id: ev.id,
          kind: ev.kind,
          detail: ev.detail,
          sessionId: owner?.sessionId ?? "",
          runId: owner?.runId ?? "",
          invocationId: ev.id,
        }];
      });
      setMessages((prev) => {
        if (prev.some((m) => m.activityIdentity === stamp.activityIdentity)) return prev;
        return [...prev, {
          id: `perm-sys-${ev.id}`, role: "system", content: `Permission requested: ${ev.kind}`,
          activityRunKey: stamp.activityRunKey, activityOrder: stamp.activityOrder,
          activityIdentity: stamp.activityIdentity,
        }];
      });
      return;
    }
    if (ev.type === "file_edit") {
      if (!epochOk) return;
      streamBufRef.current?.flush();
      if (!ev.id) return;
      const stamp = stampActivity(`diff:${ev.id}`);
      if (!stamp) return;
      if (ev.status === "proposed") {
        setDiffQueue((q) => {
          if (q.some((d) => d.id === ev.id)) return q;
          const owner = Object.values(runProjectionRef.current.runsById).find((r) => r.state !== "terminal");
          return [...q, { id: ev.id!, path: ev.path, diff: ev.diff, runId: owner?.runId }];
        });
        setMessages((prev) => prev.some((m) => m.activityIdentity === stamp.activityIdentity)
          ? prev
          : [...prev, { id: `diff-sys-${ev.id}`, role: "system", content: `Diff proposed: ${ev.path}`, activityRunKey: stamp.activityRunKey, activityOrder: stamp.activityOrder, activityIdentity: stamp.activityIdentity }]);
      } else if (ev.status === "accepted" || ev.status === "rejected") {
        setDiffQueue((q) => q.filter((d) => d.id !== ev.id));
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.activityIdentity === stamp.activityIdentity);
          const msg = { id: `diff-sys-${ev.id}`, role: "system" as const, content: `Diff ${ev.status}: ${ev.path}`, activityRunKey: stamp.activityRunKey, activityOrder: stamp.activityOrder, activityIdentity: stamp.activityIdentity };
          if (existing < 0) return [...prev, msg];
          const next = prev.slice(); next[existing] = { ...next[existing]!, ...msg }; return next;
        });
      }
      return;
    }
    if (ev.type === "error") {
      if (epochOk) streamBufRef.current?.flush();
      reportError(ev.message, {
        code: ev.code,
        source: "agent",
        detail: ev.detail,
        status: ev.status,
      });
      // Don't paint system bubbles onto a switched-away transcript
      if (epochOk && ev.code !== "agent_stderr") {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            content: `Error (${ev.code}): ${ev.message}`,
          },
        ]);
      }
      return;
    }
    if (ev.type === "done") {
      if (epochOk && liveActivityRunRef.current) closeFirstSights(liveActivityRunRef.current);
      // Always flush buffered tokens first
      if (epochOk || busyRef.current) {
        streamBufRef.current?.flush();
      }
      const reason = ev.reason || "stop";
      if (reason === "cancelled") {
        const settled = messagesRef.current.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
        const cleaned = settled.filter(
          (m) =>
            !(
              m.role === "assistant" &&
              !m.content?.trim() &&
              !m.thinking?.trim()
            ),
        );
        const last = cleaned[cleaned.length - 1];
        const paintStop = cancelledDoneShouldPaint({
          promptGeneration: streamEpochRef.current,
          cancelGeneration: cancelGenerationRef.current,
          lastRole: last?.role ?? null,
          lastContent: last?.content ?? "",
          userCount: cleaned.filter((m) => m.role === "user").length,
        });
        setMessages(
          paintStop
            ? [...cleaned, { id: uid(), role: "system", content: "Stopped by you." }]
            : cleaned,
        );
        if (paintStop) {
          setRunFooter("Stopped by you");
          toast.push("Stopped by you", "info");
        }
        setAwaitingNextTurn(true);
        cancelInFlightRef.current = false;
      } else {
        setMessages((prev) => {
          let settled = prev.map((m) =>
            m.streaming ? { ...m, streaming: false } : m,
          );
          // Merge adjacent assistant bubbles only when they look like a mid-stream
          // split (same run race), not two deliberate turns.
          {
            const merged: typeof settled = [];
            for (const m of settled) {
              const prevM = merged[merged.length - 1];
              const looksLikeSplit =
                m.role === "assistant" &&
                prevM?.role === "assistant" &&
                !prevM.toolMeta &&
                !m.toolMeta &&
                // Second piece is a continuation: no user between, and either
                // short fragment or first bubble was clearly cut mid-stream.
                ((m.content?.length ?? 0) > 0 &&
                  (prevM.content?.length ?? 0) > 80 &&
                  !(
                    /^(#{1,6}\s|[-*]\s|\d+\.\s)/.test(
                      (m.content || "").trimStart(),
                    ) && (m.content?.length ?? 0) > 40
                  ));
              if (looksLikeSplit) {
                merged[merged.length - 1] = {
                  ...prevM!,
                  content: `${prevM!.content || ""}${m.content || ""}`,
                  thinking:
                    [prevM!.thinking, m.thinking].filter(Boolean).join("\n") ||
                    undefined,
                  streaming: false,
                };
                continue;
              }
              merged.push(m);
            }
            settled = merged;
          }
          // Drop trailing punctuation-only assistant noise
          while (settled.length >= 2) {
            const last = settled[settled.length - 1]!;
            if (
              last.role === "assistant" &&
              /^[.\s…·•]+$/.test(last.content?.trim() || "") &&
              !last.thinking?.trim() &&
              settled.some(
                (m, i) =>
                  i < settled.length - 1 &&
                  m.role === "assistant" &&
                  (m.content?.trim().length ?? 0) > 1,
              )
            ) {
              settled = settled.slice(0, -1);
              continue;
            }
            break;
          }
          return settled;
        });
        if (reason === "error" || reason === "agent_exited") {
          setRunFooter(`Run ended · ${reason}`);
          setAwaitingNextTurn(true);
        } else if (reason === "auth_missing") {
          setRunFooter("Auth missing");
          setAwaitingNextTurn(false);
        } else if (reason === "stop") {
          setRunFooter(null);
          setAwaitingNextTurn(true);
        } else {
          setRunFooter(`Done · ${reason}`);
          setAwaitingNextTurn(true);
        }
      }
      streamIdRef.current = null;
      thinkingIdRef.current = null;
      setRunPhase(null);
      setRunPhaseDetail(null);
      endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
      toolFailCountRef.current = 0;
      return;
    }
  }, [applyState, bindNormalizedRun, commitRunProjection, markDisconnectedActivity, reportError, stampActivity, toast]);

  const restoreOwnedRunJournal = useCallback(async (
    run: NonNullable<RunProjection["runsById"][string]>,
    intent: RestoreIntent,
  ) => {
    const openWindow = shouldOpenCatchUp(intent);
    if (openWindow) setCatchUpByRunId((m) => openCatchUp(m, run.runId));
    try {
      const after = intent === "explicit_reconnect" ? 0 : run.lastEventSeq;
      const replay = await api.runState(run.runId, run.sessionId, after);
      const next = reduceRunEvents(mergeRunSnapshot(runProjectionRef.current, replay.run), replay.events);
      const nextRun = next.runsById[run.runId];
      commitRunProjection(next);
      if (nextRun) {
        for (const activity of Object.values(nextRun.activities)) {
          paintEnvelopeActivityRef.current(activity, nextRun.runId);
        }
        setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
        setPermissions((prev) => mergePendingPermissions(prev, nextRun));
        applyRailEvidenceRef.current(nextRun);
      }
      if (openWindow) {
        const applied = nextRun?.lastEventSeq ?? 0;
        if (appliedThroughLastEventSeq(applied, replay.run.lastEventSeq)) {
          setCatchUpByRunId((m) => closeCatchUp(m, run.runId));
        }
      }
      return { ok: true as const, run: replay.run };
    } catch {
      if (openWindow) setCatchUpByRunId((m) => failCatchUp(m, run.runId));
      return { ok: false as const, run: null };
    }
  }, [commitRunProjection]);

  const restoreOwnedRuns = useCallback(async (intent: RestoreIntent): Promise<{ ok: boolean; hasNonterminal: boolean }> => {
    const runs = runProjectionRef.current.runOrder
      .map((id) => runProjectionRef.current.runsById[id])
      .filter((run): run is NonNullable<typeof run> => Boolean(run));
    if (!runs.length) return { ok: true, hasNonterminal: false };
    const results = await Promise.allSettled(runs.map((run) => restoreOwnedRunJournal(run, intent)));
    const ok = results.every((result) => result.status === "fulfilled" && result.value.ok);
    const hasNonterminal = results.some((result) =>
      result.status === "fulfilled" && result.value.ok && result.value.run?.state !== "terminal",
    );
    return { ok, hasNonterminal };
  }, [restoreOwnedRunJournal]);
  const reconcileOwnedRuns = useCallback(async (): Promise<{ ok: boolean; hasNonterminal: boolean }> => {
    if (reconcileRunsInFlightRef.current) return reconcileRunsInFlightRef.current;
    const task = (async () => {
      const runs = runProjectionRef.current.runOrder
        .map((id) => runProjectionRef.current.runsById[id])
        .filter((run): run is NonNullable<typeof run> => Boolean(run));
      if (!runs.length) return { ok: true, hasNonterminal: false };
      const results = await Promise.allSettled(runs.map(async (run) => {
        // Health-poll reconcile is incremental completeness — it must not
        // open a File changes catch-up window (W3).
        const replay = await api.runState(run.runId, run.sessionId, run.lastEventSeq);
        const next = reduceRunEvents(mergeRunSnapshot(runProjectionRef.current, replay.run), replay.events);
        commitRunProjection(next);
        const nextRun = next.runsById[run.runId];
        if (nextRun) {
          for (const activity of Object.values(nextRun.activities)) {
            paintEnvelopeActivityRef.current(activity, nextRun.runId);
          }
          setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
          setPermissions((prev) => mergePendingPermissions(prev, nextRun));
        }
        return replay.run;
      }));
      const ok = results.every((result) => result.status === "fulfilled");
      const hasNonterminal = results.some((result) =>
        result.status === "fulfilled" && result.value.state !== "terminal",
      );
      return { ok, hasNonterminal };
    })();
    reconcileRunsInFlightRef.current = task;
    try { return await task; }
    finally {
      if (reconcileRunsInFlightRef.current === task) reconcileRunsInFlightRef.current = null;
    }
  }, [commitRunProjection]);

  return {
    catchUpByRunId,
    discardTranscriptStream,
    beginStreamRun,
    bindNormalizedRun,
    applyRailEvidenceRef,
    paintEnvelopeActivityRef,
    markDisconnectedActivity,
    onServerEvent,
    restoreOwnedRuns,
    reconcileOwnedRuns,
  };
}
