import { useCallback, useEffect, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { api, ApiError } from "./api";
import type { EffortLevel, PublicState } from "./api";
import {
  beginPageSend,
  cancelDuringAdmission,
  composerSendAdmitted,
  endPageSend,
  queueAdmitted,
  shouldFlushQueue,
} from "./composerSend";
import {
  composeArmedPromptText,
  shouldClearArmedInvocation,
  SKILLS_UNAVAILABLE,
  type SkillsPaletteProjection,
} from "./skillsCatalogComposer";
import { PLAN_ARM_BLOCKED_UNVOUCHED } from "./planArm";
import { patchFirstRun, type FirstRunState } from "./firstRun";
import { pushPromptHistory } from "./promptHistory";
import {
  cancelledDoneShouldPaint,
  foldRunAnswersIntoHistory,
  stripTrailingStopAndAssistant,
} from "./promptSendHistory";
import { expandAtMentions } from "./expandMentions";
import {
  mergeRunSnapshot,
  reduceRunEvents,
  type ActivityRecord,
  type RunProjection,
  type RunProjectionRun,
} from "./runReducer";
import {
  mergePendingDiffs,
  mergePendingPermissions,
  type PendingDiff,
  type PermissionReq,
} from "./runChangeList";
import { WAITING_PLACEHOLDER_HEAD, type ChatMessage } from "./MessageList";
import type { PendingPlanDecision } from "./useDecisions";
import type { useToast } from "./Toast";

/**
 * Restates App.tsx's own, unexported `RunPhase` shape rather than importing
 * it from App.tsx — matches Task 10's `View` precedent (useChangesProjections.ts)
 * for a private App.tsx type this hook only needs the shape of.
 */
type RunPhase = "waiting_model" | "reasoning" | "tools" | "writing" | "done" | null;

/**
 * Restates App.tsx's own, unexported `OAuthPending` shape rather than
 * importing it from App.tsx — same precedent as `RunPhase` above (and
 * matches useDecisions.ts's own `OAuthPendingLike`, which restates the
 * identical shape for the identical reason). Only ever tested for
 * truthiness here (`oauth ||` in `sendText`'s own guard) — never
 * destructured.
 */
type OAuthPendingLike = {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
};

export interface UseComposerSendParams {
  // ---- draft/queue state ------------------------------------------------
  /**
   * App.tsx's own `draft`/`setDraft`. NOT owned here, despite the brief's
   * "Moves: draft/queue state" line — a hook-ordering impossibility, not a
   * style choice. `useSkillsPalette` (called earlier in App(), since this
   * hook needs its `armedSkillName`/`skillsPalette` return values) already
   * takes the real `setDraft` as a parameter (`armSkill` calls it directly —
   * see task-8-report.md), and `draft` is also read in App()'s own
   * `skillsFilter` line and written from history navigation, at-mention
   * completion, and skill-arming, none of which are part of this move. A
   * `useComposerSend` call can only sit at *one* textual position; that
   * position cannot be before `useSkillsPalette`'s own call (for `setDraft`
   * to exist when *it* needs threading) and also after it (for this hook's
   * own inputs, `armedSkillName`/`skillsPalette`/`pendingPlanDecision`, to
   * exist). See task-12-report.md Step 1.
   */
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;

  // ---- identity / session ------------------------------------------------
  sessionId: string | null;
  /** App.tsx's own `busy` (derived from `composerChromeBusy`) — many other
   *  consumers (JSX, `onComposerKeyDown`), stays there. */
  busy: boolean;
  connected: boolean;

  // ---- gating -------------------------------------------------------------
  codePreAcquireOk: boolean;
  codeHardFail: boolean;
  vendorCode: boolean;
  /**
   * App.tsx's own `permissions`/`diffQueue`/`oauth` state — NOT owned here,
   * for the same reason `useDecisions` could not own them either (see
   * task-11-report.md Step 1, finding A): an unrelated, unmoved "rAF-throttle
   * scroll-to-bottom" effect reads all three in its own dependency array at
   * their original, very early declaration position, well before any legal
   * call site for this hook. `sendText` also *writes* `permissions`/
   * `diffQueue` (via `mergePendingPermissions`/`mergePendingDiffs`, after a
   * successful admission), so both setters are threaded through too;
   * `oauth` is read-only here (truthiness only).
   */
  permissions: PermissionReq[];
  setPermissions: Dispatch<SetStateAction<PermissionReq[]>>;
  diffQueue: PendingDiff[];
  setDiffQueue: Dispatch<SetStateAction<PendingDiff[]>>;
  oauth: OAuthPendingLike | null;
  /** `useDecisions`'s own return value (Task 11) — a plain value by the
   *  time it reaches here, not a ref; threaded through under its original
   *  name exactly like `armedSkillName`/`skillsPalette` below. */
  pendingPlanDecision: PendingPlanDecision | null;
  /** App.tsx's own reactive `state` (`PublicState | null`). Passed through
   *  whole, not decomposed into scalar fields: `sendText`'s own dependency
   *  array already lists five separate `state?.field` entries (not `state`
   *  itself), so keeping the parameter named `state` means neither the body
   *  nor the deps array needs a single textual change. */
  state: PublicState | null;
  effortLevel: EffortLevel;

  // ---- useSkillsPalette's own return (Task 8), threaded through untouched -
  /**
   * The raw `skillsPalette` projection and `armedSkillName`/
   * `setArmedSkillName` — not `effectiveArmedName`. `sendText` reads
   * `armedSkillName` directly (not `effectiveArmedName`) and lists it in its
   * own dependency array; substituting `effectiveArmedName` would silently
   * change `sendText`'s memoization identity on renders where the palette
   * isn't "ready" (task-8-report.md's own finding for this exact
   * expression). `setArmedSkillName` is called directly by `sendText` too
   * (after a successful admit; on `skill_handoff_unavailable`).
   */
  skillsPalette: SkillsPaletteProjection;
  armedSkillName: string | null;
  setArmedSkillName: Dispatch<SetStateAction<string | null>>;

  // ---- run projection -------------------------------------------------------
  runProjection: RunProjection;
  /** The same mutable object App.tsx owns, not a copy (Task 7's finding,
   *  restated here — many other consumers). */
  runProjectionRef: RefObject<RunProjection>;

  // ---- refs (Task 7 precedent: pass the real object, never re-derive) -----
  /**
   * `busyRef`/`sendInFlightRef` — Task 2 moved both from render-time writes
   * into effects/eager-callback writes; this hook only *reads* them
   * (`sendText`'s own admission guard), so that timing is unaffected by the
   * move either way. Contrary to this task's own briefing note, `sendText`
   * does **not** read `sessionIdRef` anywhere in its body — verified by
   * grepping the moved block before writing this file; only the closed-over
   * `sessionId` *value* (a parameter above) is used. `busyRef` is the one
   * ref the note correctly named: read once in the admission guard, then
   * (unrelated to that read, and untouched by this task, per Task 2's own
   * note) eagerly set to `true` inside `sendText` itself the instant a send
   * is admitted — a second, independent write from the `busy`-mirroring
   * effect that stays in App.tsx, closing the double-send race. Both writes
   * are preserved verbatim below; they are not consolidated.
   */
  busyRef: RefObject<boolean>;
  sendInFlightRef: RefObject<boolean>;
  cancelInFlightRef: RefObject<boolean>;
  messagesRef: RefObject<ChatMessage[]>;
  pendingPromptMessageIdRef: RefObject<string | null>;
  pendingPromptSessionIdRef: RefObject<string | null>;
  streamEpochRef: RefObject<number>;
  cancelGenerationRef: RefObject<number>;
  normalizedRunIdRef: RefObject<string | null>;
  applyRailEvidenceRef: RefObject<(nextRun: RunProjectionRun) => void>;
  paintEnvelopeActivityRef: RefObject<(activity: ActivityRecord, runId?: string | null) => void>;

  // ---- App()-owned callbacks with other consumers, threaded through --------
  /** Not named in the brief's "Moves:" line, and not moved: `beginStreamRun`
   *  is a self-contained callback (bumps several stream/activity refs) whose
   *  only *caller* happens to be `sendText`, but it is declared, and stays,
   *  in App.tsx like `bindNormalizedRun`/`commitRunProjection` below. */
  beginStreamRun: () => void;
  bindNormalizedRun: (runId: string, ownerSessionId: string) => void;
  commitRunProjection: (next: RunProjection) => void;
  reportError: (message: string, meta?: Record<string, unknown>) => void;
  toast: ReturnType<typeof useToast>;
  /** App.tsx's own module-level `uid()` helper (a plain, stateless id
   *  generator declared above `App()`, not exported) — threaded through as
   *  a parameter rather than imported, to avoid a circular App.tsx <->
   *  useComposerSend.ts import for a function with zero dependency on
   *  component state. */
  uid: () => string;

  // ---- plain setters for state this task does not move ---------------------
  setHistIdx: Dispatch<SetStateAction<number>>;
  setAtSuggestions: Dispatch<SetStateAction<string[]>>;
  setHistory: Dispatch<SetStateAction<string[]>>;
  setErrorBanner: Dispatch<SetStateAction<string | null>>;
  setRecovery: Dispatch<SetStateAction<"api_key" | "reconnect" | "tools" | "workspace" | null>>;
  setAwaitingNextTurn: Dispatch<SetStateAction<boolean>>;
  setRunPhase: Dispatch<SetStateAction<RunPhase>>;
  setRunPhaseDetail: Dispatch<SetStateAction<string | null>>;
  setRunStartedAt: Dispatch<SetStateAction<number | null>>;
  setRunFooter: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setFirstRun: Dispatch<SetStateAction<FirstRunState>>;
}

export interface UseComposerSendResult {
  /** Pass-through of the `draft` parameter above — App.tsx already owns
   *  `draft`/`setDraft` via its own `useState` (see the params doc) and does
   *  not destructure these two back out of this hook's return; they are
   *  still part of the return type so the hook matches the brief's stated
   *  interface and remains independently testable/callable. */
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  /**
   * Owned here — unlike `draft`, nothing between `queuedDraft`'s old
   * declaration and this hook's own call position ever referenced it, and
   * its two external writers (`removeSession`, `requestCancel`, both far
   * outside this move) are declared *after* this hook's call site, so
   * threading the raw setter back out (Task 7/8's `setArtifactOpenBinding`/
   * `setArmedSkillName` precedent) works with zero forward-reference risk.
   * See task-12-report.md Step 1.
   */
  queuedDraft: { sessionId: string; text: string } | null;
  /** The raw setter. `removeSession` (session deleted) and `requestCancel`
   *  (manual Stop) both clear this directly, outside this move — see the
   *  comment on `queuedDraft` above. */
  setQueuedDraft: Dispatch<SetStateAction<{ sessionId: string; text: string } | null>>;
  sendText: (
    raw: string,
    opts?: { skipUserBubble?: boolean; stripTrailingAssistant?: boolean },
  ) => Promise<boolean>;
  send: () => Promise<void>;
  queueCurrentDraft: () => void;
  cancelQueuedDraft: () => void;
  /**
   * Named in the brief's "Moves:" line but omitted from its illustrative
   * return list — required here regardless, since the Review surface's
   * `onSendToGrok` JSX prop (App.tsx, outside this move) is wired straight
   * to this identifier. Same shape as Task 10's `onChangesDockAccept`/
   * `onChangesDockReject`/`onChangesDockRevert` finding.
   */
  onReviewSendToGrok: (text: string) => void;
}

/**
 * `sendText` (the largest callback in App.tsx, ~290 lines) plus `send`,
 * `queueCurrentDraft`, `cancelQueuedDraft`, the queue-flush effect, and
 * `onReviewSendToGrok` — moved verbatim out of App.tsx (Task 12). The moved
 * bodies and every dependency array are byte-for-byte identical to the
 * pre-move source: every closed-over identifier that stays declared in
 * App.tsx keeps its exact original name as a parameter here (see
 * task-12-report.md's diff proof), so zero renames were needed anywhere in
 * this move — not even in `sendText`'s own 22-entry dependency array.
 *
 * `draft`/`setDraft` deliberately stay outside (see `UseComposerSendParams`
 * doc); `queuedDraft`/`setQueuedDraft` move in fully as owned state, unlike
 * `draft` — the brief's "draft/queue state" is therefore only half-movable,
 * for a hook-ordering reason specific to `draft` alone.
 */
export function useComposerSend({
  draft,
  setDraft,
  sessionId,
  busy,
  connected,
  codePreAcquireOk,
  codeHardFail,
  vendorCode,
  permissions,
  setPermissions,
  diffQueue,
  setDiffQueue,
  oauth,
  pendingPlanDecision,
  state,
  effortLevel,
  skillsPalette,
  armedSkillName,
  setArmedSkillName,
  runProjection,
  runProjectionRef,
  busyRef,
  sendInFlightRef,
  cancelInFlightRef,
  messagesRef,
  pendingPromptMessageIdRef,
  pendingPromptSessionIdRef,
  streamEpochRef,
  cancelGenerationRef,
  normalizedRunIdRef,
  applyRailEvidenceRef,
  paintEnvelopeActivityRef,
  beginStreamRun,
  bindNormalizedRun,
  commitRunProjection,
  reportError,
  toast,
  uid,
  setHistIdx,
  setAtSuggestions,
  setHistory,
  setErrorBanner,
  setRecovery,
  setAwaitingNextTurn,
  setRunPhase,
  setRunPhaseDetail,
  setRunStartedAt,
  setRunFooter,
  setMessages,
  setFirstRun,
}: UseComposerSendParams): UseComposerSendResult {
  /** Queue ⇧⏎ (Task 11): a single held draft, bound to the session it was
   *  queued against — never a bare string. `busy`, `sendText`, and the
   *  "Queued" chip all key off whichever session is *currently selected*,
   *  so a draft with no session id of its own would flush into (or show
   *  in) the wrong session after a switch. `switchSession`/`newSession`
   *  deliberately do nothing to this slot: the draft simply stays inert —
   *  hidden and unflushed — until the user selects its own session again,
   *  at which point it flushes as soon as that session reads idle (see
   *  composerSend.ts's queueAdmitted/shouldFlushQueue).
   *  (The "Task 11" above is the original feature's own task label from
   *  before this refactor existed — unrelated to this refactor's own Task
   *  11, `useDecisions`.) */
  const [queuedDraft, setQueuedDraft] = useState<{ sessionId: string; text: string } | null>(null);

  /**
   * Returns whether the send was actually admitted (every guard passed and
   * the request was handed off) — never whether the network round-trip
   * later succeeded. The queue flush effect relies on this: a queued draft
   * must only be cleared once it truly left the queue's hands, never on a
   * guard bail-out (offline, engine down, a pending gate) where dropping
   * it would silently lose the message with no error and nothing to retry.
   * Once admission passes, the normal send machinery owns the outcome
   * (toast/reportError on a later failure) exactly as it would for a live
   * Enter — the queue's job is done either way.
   */
  const sendText = useCallback(
    async (
      raw: string,
      opts?: { skipUserBubble?: boolean; stripTrailingAssistant?: boolean },
    ): Promise<boolean> => {
      const armed = shouldClearArmedInvocation(skillsPalette) ? null : armedSkillName;
      const text = (armed ? composeArmedPromptText(armed, raw) : raw).trim();
      const skillHandoff = armed ? { name: armed } : null;
      const ownedRunActive = runProjection.runOrder.some((id) => {
        const run = runProjection.runsById[id];
        return run?.sessionId === sessionId && run.state !== "terminal";
      });
      if (
        !composerSendAdmitted({
          text,
          sessionBusy: busyRef.current,
          ownedRunActive,
          sendInFlight: sendInFlightRef.current,
        }) ||
        (!connected && !codePreAcquireOk) ||
        !sessionId
      ) {
        return false;
      }
      if (
        oauth ||
        permissions.length > 0 ||
        diffQueue.length > 0 ||
        pendingPlanDecision
      ) {
        return false;
      }
      // F8 / AC6 — before any credential is stored, no message is sent and
      // no unlabeled provider error appears; the composer's disabled-reason
      // chip is the only signal, so a bypass via Enter (which does not read
      // the disabled attribute) must be refused here too.
      if (codeHardFail) return false;
      if (!state) return false;
      if (!state.hasApiKey && !vendorCode) return false;
      if (!state.permissionPolicy || state.permissionPolicy.status !== "confirmed") return false;
      const mode = state?.mode === "code" ? "code" : "chat";
      if (mode === "code" && !state?.workspace) {
        reportError("Open a project folder first — use Open folder…", {
          source: "prompt",
        });
        return false;
      }
      if (mode === "code" && (!state?.planEngagement || state.planEngagement.vouched === false)) {
        reportError(PLAN_ARM_BLOCKED_UNVOUCHED, { source: "prompt" });
        return false;
      }
      if (!beginPageSend()) return false;
      busyRef.current = true;
      sendInFlightRef.current = true;
      setDraft("");
      setHistIdx(-1);
      setAtSuggestions([]);
      setHistory(pushPromptHistory(text));
      setErrorBanner(null);
      setRecovery(null);
      setAwaitingNextTurn(false);
      cancelInFlightRef.current = false;
      // New generation — accepts only this run's stream events
      beginStreamRun();
      setRunPhase("waiting_model");
      setRunPhaseDetail(WAITING_PLACEHOLDER_HEAD);
      setRunStartedAt(Date.now());
      setRunFooter(null);

      // Build transcript base for history + UI (sync, before setState lag)
      let base = messagesRef.current.slice();
      if (opts?.stripTrailingAssistant) {
        base = stripTrailingStopAndAssistant(base);
      }
      let promptMessageId: string | null = null;
      if (!opts?.skipUserBubble) {
        promptMessageId = uid();
        base = [...base, { id: promptMessageId, role: "user", content: text }];
      } else {
        promptMessageId = [...base].reverse().find((message) => message.role === "user")?.id ?? null;
      }
      pendingPromptMessageIdRef.current = promptMessageId;
      pendingPromptSessionIdRef.current = sessionId;
      setMessages(base);
      setFirstRun((fr) => patchFirstRun({ ...fr, sentMessage: true }));

      // Prior turns only — last bubble is the user prompt we're about to send.
      // Run-backed answers skip text_delta into messages; fold vouched run
      // answers so follow-up history is not user-only.
      const runAnswerById: Record<string, string> = {};
      for (const run of Object.values(runProjectionRef.current.runsById)) {
        if (run.answerVouched && run.finalAnswer?.trim()) runAnswerById[run.runId] = run.finalAnswer;
      }
      const history = foldRunAnswersIntoHistory(
        base
          .slice(0, -1)
          .filter(
            (m) =>
              (m.role === "user" ||
                m.role === "assistant" ||
                m.role === "system") &&
              m.content?.trim() &&
              !m.content.startsWith("Stopped by you"),
          )
          .map((m) => ({
            role: m.role,
            content: m.content.slice(0, 12_000),
            projectedRunId: m.projectedRunId,
          })),
        runAnswerById,
      ).slice(-30);

      let outbound = text;
      if (state?.workspace && /@/.test(text)) {
        try {
          outbound = await expandAtMentions(text, async (p) => {
            const r = await api.workspaceRead(p);
            return { content: r.content, truncated: r.truncated };
          });
        } catch {
          /* keep original */
        }
      }

      try {
        if (
          cancelDuringAdmission({
            cancelRequested: cancelInFlightRef.current,
            admitted: false,
          }) === "abort_before_post"
        ) {
          endPageSend();
          sendInFlightRef.current = false;
          setRunStartedAt(null);
          setRunPhase(null);
          setRunPhaseDetail(null);
          setRunFooter("Stopped by you");
          setAwaitingNextTurn(true);
          cancelInFlightRef.current = false;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              !cancelledDoneShouldPaint({
                promptGeneration: streamEpochRef.current,
                cancelGeneration: cancelGenerationRef.current,
                lastRole: last?.role ?? null,
                lastContent: last?.content ?? "",
                userCount: prev.filter((m) => m.role === "user").length,
              })
            ) {
              return prev;
            }
            return [...prev, { id: uid(), role: "system", content: "Stopped by you." }];
          });
          toast.push("Stopped by you", "info");
          // Admission had already begun (beginPageSend succeeded, the draft
          // and bubble were already committed) before this race resolved —
          // same as a live Enter immediately followed by Stop. The queue's
          // job is done; this is not a guard bail-out to retry.
          return true;
        }
        // Contract path: admission returns the authoritative RunSnapshot (202).
        // A successful response without it is invalid and is never retried via
        // the legacy endpoint, which could dispatch the prompt twice.
        const admitted = await api.promptRun({
          sessionId,
          conversationId: sessionId,
          text: outbound,
          effort: effortLevel,
          history,
          skillHandoff,
        });
        if (!admitted.run) throw new Error("Host returned no run snapshot; prompt was not admitted");
        setArmedSkillName(null);
        {
          const run = admitted.run;
          bindNormalizedRun(run.runId, run.sessionId);
          if (
            cancelDuringAdmission({
              cancelRequested: cancelInFlightRef.current,
              admitted: true,
            }) === "cancel_admitted_run" &&
            sessionId &&
            run.state !== "terminal"
          ) {
            const cancelled = await api.cancelRun(sessionId, run.runId);
            if (cancelled.run) {
              commitRunProjection(mergeRunSnapshot(runProjectionRef.current, cancelled.run));
            }
            endPageSend();
            sendInFlightRef.current = false;
            setRunStartedAt(null);
            setRunPhase(null);
            setRunPhaseDetail(null);
            setRunFooter("Stopped by you");
            setAwaitingNextTurn(true);
            return true;
          }
          if (run.state === "terminal") {
            endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
            setRunPhase(null);
            setRunPhaseDetail(null);
            setAwaitingNextTurn(true);
          }
          // Project identity immediately, but never fabricate an eventSeq from
          // the snapshot. Early WS frames may already be in flight; replay the
          // journal from the reducer's cursor so those frames remain admissible.
          commitRunProjection(mergeRunSnapshot(runProjectionRef.current, run));
          try {
            const replay = await api.runState(run.runId, run.sessionId, 0);
            const next = reduceRunEvents(mergeRunSnapshot(runProjectionRef.current, replay.run), replay.events);
            commitRunProjection(next);
            const nextRun = next.runsById[run.runId];
            if (nextRun) {
              // Admission GET can land activity_update before the live WS
              // frame. Duplicate WS envelopes then no-op the reducer and
              // never paint Tool activity rows — Chat pack materialize
              // makes that race common.
              for (const activity of Object.values(nextRun.activities)) {
                paintEnvelopeActivityRef.current(activity, nextRun.runId);
              }
              setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
              setPermissions((prev) => mergePendingPermissions(prev, nextRun));
              applyRailEvidenceRef.current(nextRun);
            }
            if (replay.run.state === "terminal") {
              endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
              setRunPhase(null);
              setRunPhaseDetail(null);
              setAwaitingNextTurn(true);
            }
          } catch {
            // WS resume remains authoritative and will retry on reconnect.
          }
        }
        return true;
      } catch (err) {
        if (!normalizedRunIdRef.current) {
          pendingPromptMessageIdRef.current = null;
          pendingPromptSessionIdRef.current = null;
        }
        setRunPhase(null);
        endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
        setAwaitingNextTurn(true);
        if (err instanceof ApiError && err.code === "skill_handoff_unavailable") {
          setArmedSkillName(null);
          toast.push(SKILLS_UNAVAILABLE, "error");
          reportError(SKILLS_UNAVAILABLE, { source: "prompt" });
          return true;
        }
        if (err instanceof ApiError && err.code === "plan_engagement_unvouched") {
          reportError(PLAN_ARM_BLOCKED_UNVOUCHED, { source: "prompt" });
          return true;
        }
        if (err instanceof ApiError && err.code === "plan_decision_pending") {
          reportError(err.message || "plan_decision_pending", { source: "prompt" });
          return true;
        }
        reportError(err instanceof Error ? err.message : String(err));
        // Admission had already succeeded (beginPageSend, draft/bubble
        // committed) before this network failure — the same outcome a live
        // Enter would have. Not a guard bail-out, so the queue must not
        // hold and silently retry a message the user already saw sent.
        return true;
      }
    },
    [
      connected,
      sessionId,
      state?.workspace,
      state?.mode,
      state?.planEngagement,
      state?.permissionPolicy,
      state?.hasApiKey,
      vendorCode,
      codeHardFail,
      codePreAcquireOk,
      effortLevel,
      reportError,
      beginStreamRun,
      bindNormalizedRun,
      runProjection,
      armedSkillName,
      skillsPalette,
      toast,
      oauth,
      permissions.length,
      diffQueue.length,
      pendingPlanDecision,
    ],
  );

  const send = useCallback(async () => {
    await sendText(draft);
  }, [draft, sendText]);

  /** Queue ⇧⏎ — holds the current draft against the currently selected
   *  session; the run's Send stays unavailable while busy, so this is the
   *  only way to compose a follow-up mid-run. Single slot: queuing again
   *  replaces whatever was already held (for this or any other session). */
  const queueCurrentDraft = useCallback(() => {
    if (!queueAdmitted({ text: draft, busy })) return;
    if (!sessionId) return;
    setQueuedDraft({ sessionId, text: draft.trim() });
    setDraft("");
    setHistIdx(-1);
  }, [draft, busy, sessionId]);

  const cancelQueuedDraft = useCallback(() => setQueuedDraft(null), []);

  // Flush once the queued draft's own session is selected and idle — either
  // because it just went busy->idle while selected, or because the user
  // switched back to it after it had already finished elsewhere (see
  // shouldFlushQueue). Goes through the normal sendText path (never a
  // second, parallel send), same as a live Enter would, and only clears the
  // slot once sendText reports the send was actually admitted — a guard
  // bail-out (offline, engine down, a pending gate) leaves the draft queued
  // and still surfaced as "Queued · 1" instead of silently dropping it.
  useEffect(() => {
    if (!queuedDraft) return;
    if (
      !shouldFlushQueue({
        queuedSessionId: queuedDraft.sessionId,
        currentSessionId: sessionId,
        busy,
      })
    ) {
      return;
    }
    const pending = queuedDraft;
    void sendText(pending.text).then((sent) => {
      if (!sent) return;
      setQueuedDraft((prev) =>
        prev && prev.sessionId === pending.sessionId && prev.text === pending.text
          ? null
          : prev,
      );
    });
  }, [busy, queuedDraft, sessionId, sendText]);

  // The Review surface's line comments, "Ask Grok to change this file…"
  // field, and "Commit accepted files" all go through this same composer
  // send path — never a separate api call, and never git run by Forge itself.
  const onReviewSendToGrok = useCallback(
    (text: string) => {
      void sendText(text);
    },
    [sendText],
  );

  return {
    draft,
    setDraft,
    queuedDraft,
    setQueuedDraft,
    sendText,
    send,
    queueCurrentDraft,
    cancelQueuedDraft,
    onReviewSendToGrok,
  };
}
