import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  api,
  ensureDesktopHost,
  HostSocket,
  localBuildIdentity,
  pollHostHealth,
  restartDesktopHost,
  type DesktopHostStatus,
  type PublicState,
  type ServerEvent,
} from "../lib/api";
import {
  DIAGNOSTICS_REVEAL_MS,
  INITIAL_PHASE_LINE,
  SLOW_START_MS,
  phaseLine,
} from "../projections/launchState";
import { canRetryEngine } from "../surfaces/LaunchFailureCard";
import { endPageSend } from "../composer/composerSend";
import { patchFirstRun, type FirstRunState } from "../lib/firstRun";
import { installHealthPollTestScheduler } from "../lib/healthPollTestClock";
import type { InstallerShaVoucher } from "../lib/installerHonesty";
import type { RunProjection } from "../projections/runReducer";
import type { RestoreIntent } from "../projections/catchUpWindows";
import type { useToast } from "../thread/Toast";

/**
 * Restates App.tsx's own, unexported `BootPhase` shape rather than importing
 * it from App.tsx — matches useRunEventStream.ts's/useComposerSend.ts's own
 * precedent (restating `RunPhase`/`OAuthPendingLike` for the identical
 * reason): App.tsx's type is private, and `setBoot`'s Dispatch type only
 * needs its shape, not the name itself.
 */
type BootPhase = "booting" | "ready" | "error";

/**
 * Restates App.tsx's own, unexported `RunPhase` shape — see
 * useRunEventStream.ts's identical restatement, for the identical reason.
 */
type RunPhase = "waiting_model" | "reasoning" | "tools" | "writing" | "done" | null;

/** The shape of App.tsx's own `buildInfo` state — previously an inline
 *  object-literal type on that `useState` call, now named here since the
 *  state itself moved. */
export interface EngineBuildInfo {
  version?: string;
  channel?: string;
  channelLabel?: string;
  installerShaVoucher: InstallerShaVoucher;
}

export interface UseEngineHealthParams {
  // ---- App()-owned boot/launch state this task does NOT move — a
  //      hook-ordering impossibility, not a style choice. `App.tsx`'s own
  //      `exportSessionDiagnostics` (a `useCallback` declared well before
  //      `useRunEventStream`'s own call, which this hook's back-references
  //      below require having already run) reads `boot`/`bootMsg`/
  //      `launchStatus` directly in its body and its own dependency array —
  //      that array is evaluated at `exportSessionDiagnostics`'s own
  //      textual position, long before any legal call site for this hook.
  //      Moving any of the three into this hook would reference them before
  //      their `const` initializes at that earlier position. See
  //      task-14-report.md Step 1. ----------------------------------------
  /** Read (every guard in the moved effects/callbacks) and written
   *  (`setBoot`, below) by the moved code. */
  boot: BootPhase;
  setBoot: Dispatch<SetStateAction<BootPhase>>;
  /** Every moved call site is either a bare reset (`setBootMsg(INITIAL_PHASE_LINE)`)
   *  or a functional updater (`setBootMsg((prev) => phaseLine(status, prev))`)
   *  — the current value is never read directly by anything that moved, so
   *  only the setter is threaded through (matching `useRunEventStream.ts`'s
   *  own "setter-only" params). */
  setBootMsg: Dispatch<SetStateAction<string>>;
  /** Read (`engineRetryAllowed`'s memo, moved here) and written
   *  (`setLaunchStatus`, in `bootApp`/`retryHost`). */
  launchStatus: DesktopHostStatus | null;
  setLaunchStatus: Dispatch<SetStateAction<DesktopHostStatus | null>>;
  /**
   * `hostOk`'s own `useState` has the same hook-ordering blocker as
   * `boot`/`bootMsg`/`launchStatus`, for a different unmoved reader:
   * `refreshBranches` (`App.tsx`, declared even earlier than
   * `exportSessionDiagnostics`) reads `hostOk` in its own dependency array.
   * Unlike `boot`/`launchStatus`, nothing that moved here ever reads
   * `hostOk`'s *value* (grep-confirmed across `bootApp`/the socket-connect
   * effect/the health-poll effect/`retryHost`: every site is a bare
   * `setHostOk(true)`/`setHostOk(false)`) — so only the setter is threaded
   * through, and (unlike `boot`/`launchStatus`) `hostOk` is not part of
   * this hook's params as a read value at all.
   */
  setHostOk: Dispatch<SetStateAction<boolean>>;

  // ---- refs shared with other, already-extracted hooks (Task 7's
  //      precedent: pass the real object through, never re-derive) --------
  /** Read by the health-poll effect (`hasOwnedNonterminal`) — the same
   *  object `useRunEventStream`/`useChangesProjections`/`useDecisions`
   *  already receive. */
  runProjectionRef: RefObject<RunProjection>;
  /** Read by the socket-connect effect's disconnect branch (whether to
   *  surface the "reconnecting" toast/footer). */
  busyRef: RefObject<boolean>;
  /** Written by the socket-connect effect's reconnect-restore continuation. */
  sendInFlightRef: RefObject<boolean>;
  cancelInFlightRef: RefObject<boolean>;

  // ---- App()-owned setters this task does not move (every call site
  //      below is a bare reset, so no value ever needs threading, only the
  //      setter) -----------------------------------------------------------
  setRunStartedAt: Dispatch<SetStateAction<number | null>>;
  setRunPhase: Dispatch<SetStateAction<RunPhase>>;
  setRunPhaseDetail: Dispatch<SetStateAction<string | null>>;
  setRunFooter: Dispatch<SetStateAction<string | null>>;
  setAwaitingNextTurn: Dispatch<SetStateAction<boolean>>;
  /** `bootApp` alone (`retryHost` does not) seeds `pathInput`/`firstRun`
   *  from the freshly-fetched `GET /api/state` — `setPathInput` has other,
   *  unrelated call sites in `App.tsx` (`openPath` et al.), so `pathInput`'s
   *  own `useState` stays there. */
  setPathInput: Dispatch<SetStateAction<string>>;
  setFirstRun: Dispatch<SetStateAction<FirstRunState>>;
  /** Shared with `useRunEventStream` (Task 13) — both hooks seed this from
   *  their own `GET /api/state`-shaped response. */
  setModelDraft: Dispatch<SetStateAction<string>>;
  setShellAllowlist: Dispatch<SetStateAction<boolean>>;

  // ---- App()-owned callbacks ----------------------------------------------
  applyState: (payload: PublicState) => void;
  toast: ReturnType<typeof useToast>;

  // ---- back-references into the run domain (useRunEventStream's return,
  //      Task 13) — this hook cannot be called until after that one, since
  //      it needs these. `reconcileOwnedRuns` is a fourth, brief-unnamed
  //      back-reference: the health-poll effect calls it directly
  //      (`if (hasOwnedNonterminal) void reconcileOwnedRuns();`), the same
  //      shape as every prior task's finding that the brief's proposed
  //      interface omits a real dependency. -------------------------------
  onServerEvent: (ev: ServerEvent) => void;
  restoreOwnedRuns: (intent: RestoreIntent) => Promise<{ ok: boolean; hasNonterminal: boolean }>;
  markDisconnectedActivity: () => void;
  reconcileOwnedRuns: () => Promise<{ ok: boolean; hasNonterminal: boolean }>;
}

export interface UseEngineHealthResult {
  slowStart: boolean;
  diagRevealed: boolean;
  wsOk: boolean;
  healthFailStreak: number;
  buildInfo: EngineBuildInfo | null;
  engineRetryAllowed: boolean;
  retryHost: () => Promise<void>;
  refreshBuildInfo: () => Promise<void>;
  /** The unmoved "reconnect/replay is driven by durable per-session
   *  cursors" effect in `App.tsx` reads `socketRef.current?.resume(...)`
   *  directly — returned as the same ref object, not re-derived. */
  socketRef: RefObject<HostSocket | null>;
  /** Not in the brief's illustrative return list, required regardless: a
   *  `SettingsView` JSX prop in `App.tsx` (a dev-only "restart" affordance)
   *  calls it directly — the same shape as Task 13's `beginStreamRun`/
   *  `bindNormalizedRun` finding (named in a brief's "Moves:" line, omitted
   *  from its own "Returns" sketch, needed regardless because of a real
   *  external consumer). */
  bootApp: () => Promise<void>;
}

/**
 * Engine boot/health/reconnect state machine (Task 14) — F2 (starting
 * card)/F3-F4 (failure cards)/F5 (debounced engine-death band)/F6 (bounded
 * recovery attempts). Moved verbatim out of App.tsx: the boot/launch/health
 * state that has no earlier unmoved reader (`slowStart`/`diagRevealed`/the
 * two boot timers/`recoveryAttemptsRef`/`TERMINAL_ATTEMPTS`/
 * `healthFailStreak`(+ref)/`wsOk`/`buildInfo`/`socketRef`/`onServerEventRef`),
 * `clearBootTimers`/`refreshBuildInfo`/`bootApp`, the mount-boot effect, the
 * socket connect/reconnect effect (plus its `restoreOwnedRunsRef` latest-
 * value mirror), the health-poll effect, `engineRetryAllowed`, and
 * `retryHost` — in that order, matching the pre-move source's own relative
 * order (only `engineRetryAllowed`/`retryHost` are pulled forward from much
 * later in the file to meet everything else at this hook's single legal
 * call site — see task-14-report.md Step 3). Every closed-over identifier
 * that stays declared in App.tsx (refs, setters, `applyState`/`toast`, the
 * four `useRunEventStream` back-references) is threaded through under its
 * exact original name, so zero renames were needed anywhere in the moved
 * bodies.
 *
 * `boot`/`bootMsg`/`launchStatus`/`hostOk` do **not** move into this hook,
 * despite being named in the brief's illustrative "Returns" list — see the
 * params doc above. All four stay declared in App.tsx, byte-for-byte
 * untouched, and are threaded in as parameters instead (read+write for
 * `boot`/`launchStatus`; write-only for `bootMsg`/`hostOk`, since nothing
 * that moved here ever reads either value). Because App.tsx already owns
 * all four locally under those exact names, this hook's own return type
 * does not re-list them either (a second `const boot = ...` at the call
 * site would be a SyntaxError) — matching `useDecisions.ts`'s identical
 * treatment of `permissions`/`diffQueue`/`oauth` (real params, absent from
 * its own return type) rather than `useRunEventStream.ts`'s treatment of
 * `runProjection`/`messages` (also absent from its params' *read* need, but
 * kept in the return type there only because nothing forced the choice
 * either way). Here, nothing downstream reads `boot`/`bootMsg`/
 * `launchStatus`/`hostOk` off this hook's return — App.tsx's own locals are
 * what every other region of the file already reads — so adding them to
 * `UseEngineHealthResult` would be unused surface area.
 */
export function useEngineHealth({
  boot,
  setBoot,
  setBootMsg,
  launchStatus,
  setLaunchStatus,
  setHostOk,
  runProjectionRef,
  busyRef,
  sendInFlightRef,
  cancelInFlightRef,
  setRunStartedAt,
  setRunPhase,
  setRunPhaseDetail,
  setRunFooter,
  setAwaitingNextTurn,
  setPathInput,
  setFirstRun,
  setModelDraft,
  setShellAllowlist,
  applyState,
  toast,
  onServerEvent,
  restoreOwnedRuns,
  markDisconnectedActivity,
  reconcileOwnedRuns,
}: UseEngineHealthParams): UseEngineHealthResult {
  // ---- state/refs owned fully here — no outside consumer beyond their own
  //      declaration (checked by grep across the whole file before moving
  //      anything; see task-14-report.md Step 1) --------------------------
  const [slowStart, setSlowStart] = useState(false);
  const [diagRevealed, setDiagRevealed] = useState(false);
  const slowStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // F6 — bounded recovery attempts (mirrors the launcher's own 3-attempt
  // bound, SPEC §2.6/§5). Reset to 0 on any successful recovery.
  const recoveryAttemptsRef = useRef(0);
  const TERMINAL_ATTEMPTS = 3;
  // F5 — consecutive failed 4s health polls while the app is ready. Chip
  // reacts after 1 (subtle); the engine-stopped chrome (band/banner/composer
  // reason) only appears after 2 (AC-U10 — a single blip must not flash it).
  const [healthFailStreak, setHealthFailStreak] = useState(0);
  const healthFailStreakRef = useRef(0);
  const [wsOk, setWsOk] = useState(false);
  // GATE Z round 3 (AC25) — `GET /api/health`'s `version`/`channel`/
  // `channelLabel` (INTERFACE_CONTRACT.md §6, promised for "diagnostics
  // export, AC25/AC26") rendered somewhere a non-developer can find and read
  // aloud, not only inside the diagnostics file.
  const [buildInfo, setBuildInfo] = useState<EngineBuildInfo | null>(null);
  const socketRef = useRef<HostSocket | null>(null);
  // Keep the transport subscription stable while the render callback evolves.
  // Recreating HostSocket on every projection/toast update can create an
  // unbounded reconnect chain during a degraded engine, exhausting the test
  // process (and flashing duplicate sockets in production).
  const onServerEventRef = useRef<(ev: ServerEvent) => void>(() => undefined);

  useEffect(() => {
    onServerEventRef.current = onServerEvent;
  }, [onServerEvent]);

  const clearBootTimers = useCallback(() => {
    if (slowStartTimerRef.current) clearTimeout(slowStartTimerRef.current);
    if (diagTimerRef.current) clearTimeout(diagTimerRef.current);
    slowStartTimerRef.current = null;
    diagTimerRef.current = null;
  }, []);

  useEffect(() => clearBootTimers, [clearBootTimers]);

  /** N-2/N-3 (QA GATE Q pass 1c, AC-S8) — `Details`/diagnostics build
   *  identity must be populated in exactly the states where `GET
   *  /api/health` cannot be trusted: a full-screen failure card means the
   *  engine (by definition) is not answering — or, before the N-3 fix, that
   *  something answering isn't actually this install's engine. Set the
   *  local build identity (no network, sourced from the running executable
   *  and compile-time constants — see `localBuildIdentity()`)
   *  unconditionally first, so `buildInfo` is never null in the one state
   *  the row is about; then refine with the engine's own `/api/health` when
   *  that succeeds (only possible against a port the launcher actually
   *  published, per `hostPort()`'s N-3 note) since that is ground truth
   *  when reachable. */
  const refreshBuildInfo = useCallback(async () => {
    const local = await localBuildIdentity();
    setBuildInfo({
      version: local.version,
      channel: local.channel,
      channelLabel: local.channelLabel,
      installerShaVoucher: { status: "pending" },
    });
    try {
      const h = await api.health();
      setBuildInfo({
        version: h.version ?? local.version,
        channel: h.channel ?? local.channel,
        channelLabel: h.channelLabel ?? local.channelLabel,
        installerShaVoucher: { status: "live", value: h.installerSha256 ?? null },
      });
    } catch {
      setBuildInfo({
        version: local.version,
        channel: local.channel,
        channelLabel: local.channelLabel,
        installerShaVoucher: { status: "unreachable" },
      });
    }
  }, []);

  /** F2 — initial boot only: unconditionally shows the spinner card (there is
   *  nothing to preserve yet) and terminates in "ready" or "error". */
  const bootApp = useCallback(async () => {
    setBoot("booting");
    setBootMsg(INITIAL_PHASE_LINE);
    setSlowStart(false);
    setDiagRevealed(false);
    clearBootTimers();
    slowStartTimerRef.current = setTimeout(() => setSlowStart(true), SLOW_START_MS);
    diagTimerRef.current = setTimeout(() => setDiagRevealed(true), DIAGNOSTICS_REVEAL_MS);

    const status = await ensureDesktopHost();
    setLaunchStatus(status);
    setBootMsg((prev) => phaseLine(status, prev));

    // A launcher-reported failure already carries a named reason (F3); a
    // long shell-side retry loop here would only delay the failure card
    // without changing the outcome (AC4 — never indefinite). A launcher
    // success gets more attempts since the shell's own health probe is the
    // belt-and-suspenders check that the answer is real.
    const ok = await pollHostHealth(status.ok ? 20 : 6, 150);
    clearBootTimers();
    // N-2 — unconditional: a failed boot still gets a shot at the build
    // identity (see refreshBuildInfo above), which is what feeds the
    // LaunchFailureCard `Details` disclosure below.
    if (!ok) {
      await refreshBuildInfo();
      // F6's bound counts RECOVERY attempts (explicit "Try again" clicks via
      // retryHost), not this initial boot — "three failing restart_host
      // calls" (PLAN F6) is the bound, so recoveryAttemptsRef starts at 0
      // here regardless of outcome.
      setBoot("error");
      setHostOk(false);
      return;
    }
    recoveryAttemptsRef.current = 0;
    setHostOk(true);
    setHealthFailStreak(0);
    healthFailStreakRef.current = 0;
    try {
      const s = await api.state();
      applyState(s);
      setModelDraft(s.model);
      if (s.workspace) {
        setPathInput(s.workspace);
        setFirstRun((fr) => patchFirstRun({ ...fr, openedFolder: true }));
      }
      if (s.hasApiKey) {
        setFirstRun((fr) => patchFirstRun({ ...fr, signedIn: true }));
      }
      if (typeof s.shellAllowlist === "boolean") setShellAllowlist(s.shellAllowlist);
    } catch {
      /* optional */
    }
    // Dual-source SHA: become ready with local identity (pending voucher) so
    // Welcome/Settings can paint Loading instead of flashing unavailable
    // while the health refine is in flight.
    setBoot("ready");
    void refreshBuildInfo();
  }, [clearBootTimers, refreshBuildInfo]);

  useEffect(() => {
    void bootApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boot !== "ready") return;
    const sock = new HostSocket({
      onStatus: (c) => {
        setWsOk(c);
      if (c) {
          healthFailStreakRef.current = 0;
          setHealthFailStreak(0);
          setHostOk(true);
          // Transport liveness is not run liveness. Reconcile every cached
          // owned run from the authoritative journal before clearing the
          // reconnect/unknown chrome; failures remain visible and retry on
          // the next transport reopen.
          //
          // Read through restoreOwnedRunsRef rather than closing over
          // restoreOwnedRuns directly: this effect is deliberately built
          // once (see the dependency array below) and must still call
          // whichever restoreOwnedRuns is CURRENT at the moment the socket
          // reconnects, not the one captured when the effect first ran.
          void restoreOwnedRunsRef.current("disconnect_restore").then(({ ok, hasNonterminal }) => {
            if (!ok) return;
            if (!hasNonterminal) {
              endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
              setRunPhase(null);
              setRunPhaseDetail(null);
              setRunFooter(null);
              setAwaitingNextTurn(true);
              cancelInFlightRef.current = false;
            }
          });
          return;
        }
        // The transport status is authoritative for the live activity run:
        // freeze current evidence before reconnect attempts can deliver any
        // late identities or updates.
        markDisconnectedActivity();
        // Win+PrtScn / focus loss can briefly drop WS — don't silent-cancel.
        // Surface interruption clearly if a run was in flight.
        if (busyRef.current) {
          setRunFooter(
            "Reconnecting — Connection lost. Forge is reconnecting. Your prompt and received output are preserved. Run status will be confirmed when the connection returns.",
          );
          setRunPhaseDetail("Reconnecting");
          toast.push(
            "Connection blip while Grok was running — reconnecting",
            "info",
          );
        }
      },
    });
    socketRef.current = sock;
    sock.on((ev) => onServerEventRef.current(ev));
    sock.connect();
    return () => {
      sock.close();
      if (socketRef.current === sock) socketRef.current = null;
    };
    // The socket is deliberately built once per boot and never torn down
    // just because a callback identity changed — adding restoreOwnedRuns
    // (or markDisconnectedActivity's transitive deps) here would rebuild and
    // reconnect the transport on every render that recreates them, which is
    // a real behavior change (reconnect storms), not a cleanup. The latest
    // restoreOwnedRuns is read through restoreOwnedRunsRef above instead.
  }, [boot, markDisconnectedActivity]);

  // Latest-value mirror for the HostSocket connect effect above, which is
  // built once per boot and deliberately does not depend on restoreOwnedRuns
  // (see that effect's dependency-array comment). Kept current in an effect,
  // matching onServerEventRef's pattern above rather than applyRailEvidenceRef's
  // render-time assignment — see the Global Constraints note on ref timing.
  const restoreOwnedRunsRef = useRef(restoreOwnedRuns);
  useEffect(() => {
    restoreOwnedRunsRef.current = restoreOwnedRuns;
  });

  // F5 — liveness is independent from socket lifecycle. Keeping this poll in
  // its own effect prevents a failed probe's state update from tearing down and
  // recreating the WebSocket (which can otherwise amplify reconnect work).
  useEffect(() => {
    if (boot !== "ready") return;
    const healthCadence = 4000;
    const pollHealth = () => { void api.health().then((h) => {
      healthFailStreakRef.current = 0;
      setHealthFailStreak(0);
      setHostOk(true);
      setBuildInfo((prev) => ({
        version: h.version ?? prev?.version,
        channel: h.channel ?? prev?.channel,
        channelLabel: h.channelLabel ?? prev?.channelLabel,
        installerShaVoucher: { status: "live", value: h.installerSha256 ?? null },
      }));
      // A healthy transport does not prove a run outcome. Poll nonterminal
      // runs, and terminal runs that still show a pending plan (Accept is
      // appended after run_terminal; skipping those leaves the dock pending).
      const needsJournalCatchUp = runProjectionRef.current.runOrder.some((id) => {
        const run = runProjectionRef.current.runsById[id];
        if (!run) return false;
        if (run.state !== "terminal") return true;
        return Object.values(run.decisions ?? {}).some((d) => d.kind === "plan" && d.status === "pending");
      });
      if (needsJournalCatchUp) void reconcileOwnedRuns();
    }).catch(() => {
      healthFailStreakRef.current += 1;
      const streak = healthFailStreakRef.current;
      setHealthFailStreak(streak);
      setBuildInfo((prev) =>
        prev
          ? { ...prev, installerShaVoucher: { status: "unreachable" as const } }
          : prev,
      );
      if (streak >= 2) setHostOk(false);
    }); };
    const testCleanup = installHealthPollTestScheduler(pollHealth);
    const healthTimer = testCleanup ? undefined : setInterval(pollHealth, healthCadence);
    return () => { if (healthTimer !== undefined) clearInterval(healthTimer); testCleanup?.(); };
  }, [boot]);

  // AC-U5 — with `owned: false` no restart/reconnect affordance renders
  // anywhere (dev-shell-only state; unreachable in a packaged prod build).
  const engineRetryAllowed = useMemo(
    () => canRetryEngine(launchStatus ?? { owned: true }),
    [launchStatus],
  );

  /**
   * F5/F6 — the single "Try again" recovery path, used by both the boot
   * failure card (F3/F4) and the mid-session engine-death band (F5).
   *
   * - Mid-session (boot === "ready"): NEVER shows the spinner card — that
   *   would hide the transcript, which AC16/AC-U6 forbid. A failed attempt
   *   just leaves the debounced band up, UNLESS this is the terminal
   *   (3rd consecutive) attempt, which forces the full failure card (AC18).
   * - From the failure card (boot === "error"): shows the spinner while
   *   retrying, UNLESS bounded recovery is already exhausted, in which case
   *   it retries silently with no spinner at all (AC18 — "not a repeating or
   *   indefinite spinner").
   */
  const retryHost = useCallback(async () => {
    const attemptNumber = recoveryAttemptsRef.current + 1;
    const terminalAttempt = attemptNumber >= TERMINAL_ATTEMPTS;
    const cameFromFailureCard = boot === "error";
    const showSpinner = cameFromFailureCard && !terminalAttempt;

    if (showSpinner) {
      setBoot("booting");
      setBootMsg(INITIAL_PHASE_LINE);
      setSlowStart(false);
      setDiagRevealed(false);
      clearBootTimers();
      slowStartTimerRef.current = setTimeout(() => setSlowStart(true), SLOW_START_MS);
      diagTimerRef.current = setTimeout(() => setDiagRevealed(true), DIAGNOSTICS_REVEAL_MS);
    }

    const status = await restartDesktopHost();
    setLaunchStatus(status);
    if (showSpinner) setBootMsg((prev) => phaseLine(status, prev));

    const healthy = await pollHostHealth(status.ok ? 20 : 6, 150);
    clearBootTimers();
    // N-2 — same best-effort refresh as bootApp: a retry that ends back on
    // the failure card (terminal AC18 state, or a re-failed retry from the
    // card itself) still updates the build identity Details renders.
    await refreshBuildInfo();

    if (healthy) {
      recoveryAttemptsRef.current = 0;
      setHostOk(true);
      setHealthFailStreak(0);
      healthFailStreakRef.current = 0;
      if (boot !== "ready") {
        try {
          const s = await api.state();
          applyState(s);
          setModelDraft(s.model);
          if (typeof s.shellAllowlist === "boolean") setShellAllowlist(s.shellAllowlist);
        } catch {
          /* optional */
        }
        setBoot("ready");
      } else {
        void restoreOwnedRuns("explicit_reconnect");
      }
      return;
    }

    recoveryAttemptsRef.current = attemptNumber;
    setHostOk(false);
    if (terminalAttempt || cameFromFailureCard) {
      setBoot("error");
    }
  }, [boot, clearBootTimers, refreshBuildInfo, restoreOwnedRuns]);

  return {
    slowStart,
    diagRevealed,
    wsOk,
    healthFailStreak,
    buildInfo,
    engineRetryAllowed,
    retryHost,
    refreshBuildInfo,
    socketRef,
    bootApp,
  };
}
