import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ensureDesktopHost,
  HostSocket,
  isTauri,
  localBuildIdentity,
  mergeState,
  pickFolderNative,
  pollHostHealth,
  restartDesktopHost,
  ApiError,
  type DesktopHostStatus,
  type EffortLevel,
  type ProductMode,
  type PublicState,
  type ServerEvent,
  type TrustedCommandClassesView,
} from "./api";
import {
  DIAGNOSTICS_REVEAL_MS,
  INITIAL_PHASE_LINE,
  SLOW_START_MS,
  phaseLine,
} from "./launchState";
import { LaunchFailureCard, canRetryEngine } from "./LaunchFailureCard";
import { BootScreen } from "./BootScreen";
import { AppTopbar } from "./AppTopbar";
import { EngineStoppedBanner, ErrorBanner } from "./AppBanners";
import { ComposerPane } from "./ComposerPane";
import { recentCrashes } from "./crashSink";

import { EffortControl } from "./EffortControl";
import { PlanArmControl } from "./PlanArmControl";
import {
  PLAN_ARM_BLOCKED_UNVOUCHED,
  PLAN_LIVE_FOOTER,
  PLAN_LIVE_STATUS,
  planArmFailureCopy,
  projectPlanArm,
} from "./planArm";
import { projectProjectInstructionsComposer } from "./projectInstructionsComposer";
import { ProjectInstructionsStatus } from "./ProjectInstructionsStatus";
import { projectChatPackComposer } from "./chatPackComposer";
import { ChatPackStatus } from "./ChatPackStatus";
import { ChatPackInventory } from "./ChatPackInventory";
import { ChatHomeName } from "./ChatHomeName";
import { isLivePlanning } from "./runPlanSection";
import {
  isOnboardingDone,
  loadFirstRun,
  patchFirstRun,
  type FirstRunState,
} from "./firstRun";
import { Onboarding } from "./Onboarding";
import { CommandPalette, type PaletteAction } from "./CommandPalette";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { OverlayDialog } from "./ui/Dialog";
import { Switch } from "./ui/Switch";
import { TextField } from "./ui/TextField";
import { Hint } from "./ui/Tooltip";
import { useChromeStore } from "./state/chromeStore";
import { useSessionFlagsStore } from "./state/sessionFlagsStore";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { tinykeys } from "tinykeys";
import { parseRunEventEnvelope } from "./runEventSchema";
import { checkForAppUpdate, installAppUpdate, type UpdateStatus } from "./desktopUpdate";
import { notifyDesktop, registerSummonShortcut } from "./desktopNotify";
import { planLiveActivityReveal, SETTLE_CARD_BELOW } from "./copyDock";
import { RefreshCw } from "lucide-react";
import { MessageList, type ChatMessage } from "./MessageList";
import { RunStatusBar, type RunPhase } from "./RunStatusBar";
import {
  formatToolInput,
  formatToolOutput,
} from "./toolFormat";
import { type PendingDiff } from "./DiffPanel";
import { type PermissionReq } from "./PermissionCard";
import { ActionDock, PLAN_DECISION_FAILURE } from "./ActionDock";
import { loadPromptHistory, pushPromptHistory } from "./promptHistory";
import {
  clearPackMembers,
  commitHomeName,
  createSession,
  deleteSession,
  ensureActiveSession,
  flushSessions,
  hasAnyStoredHistory,
  isExpanded,
  listPinnedWorkspaces,
  listSessions,
  loadSession,
  onSessionSaveError,
  partitionKey,
  saveSessionMessages,
  setActiveSession,
  setExpanded,
  setSessionBranch,
  toggleExpanded,
  updatePackMembers,
  updateSessionMeta,
  workspaceDisplayName,
  type ChatSession,
} from "./sessions";
import { FrameFlush, StreamBuffer } from "./streamBuffer";
import { computeOverview, OverviewStrip } from "./OverviewStrip";
import { EmptyStates } from "./EmptyStates";
import { Sidebar, type WorkspaceNode } from "./Sidebar";
import {
  buildSessionMarkdown,
  downloadDiagnostics,
  suggestDiagnosticsFilename,
} from "./exportDiagnostics";
import {
  downloadSessionsExport,
  importSessionsJson,
  pickImportFile,
} from "./sessionIO";

import { ConnectorsPanel } from "./ConnectorsPanel";
import {
  appChannel,
  channelBadge,
  hostPort,
  INHERITED_DEFAULT_MODEL,
  MODEL_PRESETS,
} from "./api";
import { installHealthPollTestScheduler } from "./healthPollTestClock";
import { loadPrefs, patchPrefs, themeLabel, type Prefs } from "./prefs";
import { useToast } from "./Toast";
import {
  activityIdentityFor,
  createLiveActivityRun,
  closeFirstSights,
  freezeDisconnected,
  mergeToolDetail,
  reduceToolRun,
  stampFirstSight,
  type ActivityStamp,
  type LiveActivityRun,
} from "./activityRun";
import { readFilesForAttach } from "./contextAttach";
import { scheduleExtractingCue } from "./attachBusy";
import {
  downloadMarkdown,
  suggestChatFilename,
  transcriptToMarkdown,
} from "./exportChat";
import { expandAtMentions } from "./expandMentions";
import { initialRunProjection, isRunStreamDelta, mergeRunSnapshot, persistableRunProjection, reduceRunEvent, reduceRunEvents, restoreRunProjection, type RunProjection, type RunEventEnvelope } from "./runReducer";
import {
  hasDockOwnedPending,
  mergePendingDiffs,
  mergePendingPermissions,
  railEvidenceFromRun,
} from "./runChangeList";
import {
  appliedThroughLastEventSeq,
  catchUpForRun,
  closeCatchUp,
  failCatchUp,
  openCatchUp,
  shouldOpenCatchUp,
  type CatchUpMap,
  type RestoreIntent,
} from "./catchUpWindows";
import { RunSurface } from "./RunSurface";
import { PermissionPolicyControl } from "./PermissionPolicyControl";
import { BypassPermissionsControl } from "./BypassPermissionsControl";
import { TrustedCommandClassesControl } from "./TrustedCommandClassesControl";
import type { TrustedCommandClassesStatus } from "./TrustedCommandClassesControl";

type View = "chat" | "settings";
type BootPhase = "booting" | "ready" | "error";

interface OAuthPending {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function statusChip(state: PublicState | null): {
  text: string;
  className: string;
} {
  if (!state || state.authMode === "signed_out") {
    return { text: "Signed out", className: "chip signed-out" };
  }
  if (state.authMode === "sub_pool") {
    return { text: "Grok · sub-pool", className: "chip sub" };
  }
  return { text: "Grok · API", className: "chip api" };
}

export function App() {
  const tauri = isTauri();
  const [boot, setBoot] = useState<BootPhase>("booting");
  const [bootMsg, setBootMsg] = useState(INITIAL_PHASE_LINE);
  // F2/F3 — the launcher's own value (INTERFACE_CONTRACT.md), driving the
  // failure-card mapping (F3) and the `Details` disclosure (AC-U18).
  const [launchStatus, setLaunchStatus] = useState<DesktopHostStatus | null>(
    null,
  );
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
  const [view, setView] = useState<View>("chat");
  const [state, setState] = useState<PublicState | null>(null);
  // SPEC §2.8 property 4 / INTERFACE_CONTRACT.md (GATE Q N-8) — the ONLY
  // place a state-bearing engine response is allowed to update `state`.
  // Every caller below (GET /api/state, the WS `state` frame, every
  // state-returning POST) must route through this rather than the raw
  // state setter directly, so a response that omits a per-requester field
  // (concretely, `priorConversations`) can never unset a value already
  // held — see `mergeState` in api.ts for the merge rule itself. A new
  // call site that bypasses this and updates state directly is caught by
  // the structural test in App.ac12g.test.tsx, not by convention alone.
  const applyState = useCallback((payload: PublicState) => {
    setState((prev) => mergeState(prev, payload));
  }, []);
  // GATE Z round 3 (AC25) — `GET /api/health`'s `version`/`channel`/
  // `channelLabel` (INTERFACE_CONTRACT.md §6, promised for "diagnostics
  // export, AC25/AC26") rendered somewhere a non-developer can find and read
  // aloud, not only inside the diagnostics file.
  const [buildInfo, setBuildInfo] = useState<{
    version?: string;
    channel?: string;
    channelLabel?: string;
  } | null>(null);
  const [hostOk, setHostOk] = useState(false);
  const [wsOk, setWsOk] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runProjection, setRunProjection] = useState<RunProjection>(() => {
    try { return restoreRunProjection(JSON.parse(localStorage.getItem("grokforge.runProjection.v1") || "null")); } catch { return initialRunProjection(); }
  });
  // Reconnect reconciliation reads the latest durable projection without
  // changing the HostSocket effect's identity (which would create a second
  // transport). Sync from React state unless a coalesced delta paint is
  // ahead of the committed snapshot — otherwise a render would drop tokens.
  const runProjectionRef = useRef(runProjection);
  const pendingProjectionPaintRef = useRef(false);
  const projectionFlushRef = useRef<FrameFlush | null>(null);
  if (!pendingProjectionPaintRef.current) {
    runProjectionRef.current = runProjection;
  }
  const commitRunProjection = useCallback((next: RunProjection) => {
    pendingProjectionPaintRef.current = false;
    projectionFlushRef.current?.cancel();
    runProjectionRef.current = next;
    setRunProjection(next);
  }, []);
  const reconcileRunsInFlightRef = useRef<Promise<{ ok: boolean; hasNonterminal: boolean }> | null>(null);
  const [catchUpByRunId, setCatchUpByRunId] = useState<CatchUpMap>({});
  const socketRef = useRef<HostSocket | null>(null);
  // Keep the transport subscription stable while the render callback evolves.
  // Recreating HostSocket on every projection/toast update can create an
  // unbounded reconnect chain during a degraded engine, exhausting the test
  // process (and flashing duplicate sockets in production).
  const onServerEventRef = useRef<(ev: ServerEvent) => void>(() => undefined);
  const [draft, setDraft] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState<string>(INHERITED_DEFAULT_MODEL);
  const [shellAllowlist, setShellAllowlist] = useState(true);
  const [permissions, setPermissions] = useState<PermissionReq[]>([]);
  const [diffQueue, setDiffQueue] = useState<PendingDiff[]>([]);
  const [planArmError, setPlanArmError] = useState<string | null>(null);
  const [planSettling, setPlanSettling] = useState(false);
  const [planDecisionError, setPlanDecisionError] = useState<string | null>(null);
  const [activeDiffId, setActiveDiffId] = useState<string | null>(null);
  const [oauth, setOauth] = useState<OAuthPending | null>(null);
  const [forceOpenFailedTools, setForceOpenFailedTools] = useState(false);
  const [runFooter, setRunFooter] = useState<string | null>(null);
  const [openingWs, setOpeningWs] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const recentErrorsRef = useRef<string[]>([]);
  const [recovery, setRecovery] = useState<
    "api_key" | "reconnect" | "tools" | "workspace" | null
  >(null);
  const [firstRun, setFirstRun] = useState<FirstRunState>(() => loadFirstRun());
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const paletteOpen = useChromeStore((s) => s.paletteOpen);
  const setPaletteOpen = useChromeStore((s) => s.setPaletteOpen);
  const peek = useChromeStore((s) => s.peek);
  const setPeek = useChromeStore((s) => s.setPeek);
  const dragOver = useChromeStore((s) => s.dragOver);
  const setDragOver = useChromeStore((s) => s.setDragOver);
  const toast = useToast();
  const sessionWrite = useSessionFlagsStore((s) => s.sessionWrite);
  const sessionShell = useSessionFlagsStore((s) => s.sessionShell);
  const setSessionWrite = useSessionFlagsStore((s) => s.setSessionWrite);
  const setSessionShell = useSessionFlagsStore((s) => s.setSessionShell);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => loadPromptHistory());
  const [histIdx, setHistIdx] = useState(-1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [classesView, setClassesView] = useState<TrustedCommandClassesView | null>(null);
  const [classesStatus, setClassesStatus] = useState<TrustedCommandClassesStatus>("no_workspace");
  const [sessionList, setSessionList] = useState<ChatSession[]>([]);
  const [packInventoryOpen, setPackInventoryOpen] = useState(false);
  const [packMutationInFlight, setPackMutationInFlight] = useState(false);
  const [homeNameSaveFailed, setHomeNameSaveFailed] = useState(false);
  const [homeNameDraft, setHomeNameDraft] = useState("");
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(() =>
    listPinnedWorkspaces(),
  );
  const [branchMap, setBranchMap] = useState<Record<string, string | null>>({});
  const [expandTick, setExpandTick] = useState(0);
  const [connTest, setConnTest] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [modeSwitching, setModeSwitching] = useState(false);
  const [runPhase, setRunPhase] = useState<RunPhase>(null);
  const [runPhaseDetail, setRunPhaseDetail] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  /** After a finished answer, show “your turn” delimiter until next send */
  const [awaitingNextTurn, setAwaitingNextTurn] = useState(false);
  const thinkingIdRef = useRef<string | null>(null);
  const cancelInFlightRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const streamIdRef = useRef<string | null>(null);
  const normalizedRunIdRef = useRef<string | null>(null);
  const pendingPromptMessageIdRef = useRef<string | null>(null);
  const pendingPromptSessionIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const openInFlightRef = useRef<string | null>(null);
  const lastOpenAtRef = useRef(0);
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const toolFailCountRef = useRef(0);
  const streamBufRef = useRef<StreamBuffer | null>(null);
  /** Bumped on session/mode switch so late agent events cannot paint the wrong transcript. */
  const eventEpochRef = useRef(0);
  const streamEpochRef = useRef(0);
  const nextActivityRunCounterRef = useRef(0);
  const liveActivityRunRef = useRef<LiveActivityRun | null>(null);
  const activityRevealRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Run identity/cursors outlive a WebView reload. Journal replay below fills
  // any missing owned events; this projection is only a durable UI cache.
  useEffect(() => {
    try { localStorage.setItem("grokforge.runProjection.v1", JSON.stringify(persistableRunProjection(runProjection))); } catch { /* storage is best effort */ }
  }, [runProjection]);

  useEffect(() => {
    return onSessionSaveError((err) => {
      if (err) toast.push(`Session save failed: ${err}`, "error");
    });
  }, [toast]);

  useEffect(() => {
    void registerSummonShortcut();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void checkForAppUpdate().then((status) => {
      if (status.kind === "available") setUpdateStatus(status);
    });
  }, []);

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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshTree = useCallback(() => {
    setPinnedPaths(listPinnedWorkspaces());
    setExpandTick((t) => t + 1);
  }, []);

  const refreshBranches = useCallback(async (paths: string[]) => {
    if (!paths.length || !hostOk) return;
    try {
      const { branches } = await api.workspaceBranches(paths);
      setBranchMap((prev) => ({ ...prev, ...branches }));
    } catch {
      /* optional */
    }
  }, [hostOk]);

  // Smart stick-to-bottom: only auto-scroll when user is near the end
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = gap < 96;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // rAF-throttle scroll-to-bottom so streaming doesn't force layout every token batch
  const scrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, permissions.length, diffQueue.length, oauth]);

  // First-sight of a tool group: stay at the live end if the operator is
  // already there. Only jump the first header into view when they scrolled away.
  useLayoutEffect(() => {
    const key = activityRevealRef.current;
    if (!key) return;
    const header = document.querySelector<HTMLElement>(
      `[data-activity-run="${CSS.escape(key)}"] .tool-activity-head`,
    );
    const plan = planLiveActivityReveal(stickToBottomRef.current, Boolean(header));
    if (plan === "keep-end") {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      activityRevealRef.current = null;
      return;
    }
    if (plan === "show-header" && header) {
      header.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
      const transcript = transcriptRef.current;
      if (transcript) {
        const tr = transcript.getBoundingClientRect();
        const hr = header.getBoundingClientRect();
        if (hr.top < tr.top) transcript.scrollTop -= tr.top - hr.top;
        else if (hr.bottom > tr.bottom) transcript.scrollTop += hr.bottom - tr.bottom;
      }
      activityRevealRef.current = null;
    }
  }, [messages]);


  const classifyRecovery = useCallback(
    (msg: string, meta?: Record<string, unknown>) => {
      const code = String(meta?.code || "").toLowerCase();
      const low = msg.toLowerCase();
      if (
        code === "auth_expired" ||
        code === "auth_forbidden" ||
        low.includes("api key") ||
        low.includes("unauthorized") ||
        low.includes("401") ||
        low.includes("sign in")
      ) {
        return "api_key" as const;
      }
      if (
        low.includes("host") ||
        low.includes("offline") ||
        low.includes("econnrefused") ||
        low.includes("failed to fetch")
      ) {
        return "reconnect" as const;
      }
      if (low.includes("workspace") || low.includes("open a project")) {
        return "workspace" as const;
      }
      if (
        low.includes("tool") ||
        low.includes("blocked") ||
        low.includes("exit ") ||
        code === "tool_error"
      ) {
        return "tools" as const;
      }
      return null;
    },
    [],
  );

  const reportError = useCallback(
    (message: string, meta?: Record<string, unknown>) => {
      const msg = message.trim() || "Unknown error";
      const stamp = new Date().toISOString();
      recentErrorsRef.current = [
        ...recentErrorsRef.current.slice(-19),
        `${stamp} ${msg}`,
      ];
      setErrorBanner(msg);
      setRecovery(classifyRecovery(msg, meta));
      void api.clientLog("error", msg, meta);
    },
    [classifyRecovery],
  );

  // F8 — AC5 (operator ruling 2026-08-14): the single subscription sign-in
  // start path, shared verbatim by the Settings panel's `Sign in with Grok`
  // button and the signed-out gate's primary action. Its pending/device-code
  // surface is the existing ActionDock OAuth pending box (driven by the
  // `oauth_pending` server event) — no new pattern, no second path.
  const startGrokSignIn = useCallback(() => {
    void api.oauthStart().catch((e) => reportError(String(e), { source: "oauth" }));
  }, [reportError]);

  const exportSessionDiagnostics = useCallback(async () => {
    setExportStatus("Exporting…");
    // Chat transcripts live under partitionKey, not FS workspace path
    const mode = state?.mode === "code" ? "code" : "chat";
    const partition =
      mode === "chat"
        ? partitionKey("chat", state?.chatRoot)
        : state?.workspace ?? pathInput ?? "__no_workspace__";
    const session = sessionId ? loadSession(partition, sessionId) : null;
    // F10 (AC-U18) — the launcher's raw fields, verbatim, regardless of
    // whether the export itself succeeds through a healthy engine.
    // N-2/N-3 (QA GATE Q) — start from the local build identity (no
    // network, can't be a foreign engine's answer) so the exported file
    // always carries a `### Build` section; refine with the engine's own
    // `GET /api/health` only when that succeeds against a port the
    // launcher actually published (see `hostPort()`'s N-3 note).
    let health: { version?: string; channel?: string; channelLabel?: string } | null =
      await localBuildIdentity();
    try {
      const h = await api.health();
      health = { version: h.version, channel: h.channel, channelLabel: h.channelLabel };
    } catch {
      /* engine down — diagnostics stays offered anyway (AC-U13); keep the
       * local build identity set above. */
    }
    const clientBundle = buildSessionMarkdown({
      state,
      sessionId,
      sessionTitle: session?.title ?? null,
      messages: messagesRef.current,
      errorBanner,
      recentErrors: [...recentErrorsRef.current, ...recentCrashes()],
      bootMsg: boot === "error" ? bootMsg : null,
      launch: launchStatus,
      health,
    });
    try {
      const result = await api.exportDiagnostics({
        markdown: clientBundle,
        openFolder: true,
      });
      // F10 — report the path the exporter actually returned, never a
      // hard-coded location.
      downloadDiagnostics(suggestDiagnosticsFilename(), result.markdown);
      setExportStatus(`Saved: ${result.path}`);
      setConnTest(`Diagnostics saved · ${result.path}`);
      void api.openLogs().catch(() => undefined);
    } catch (e) {
      // Engine down (AC-U13): diagnostics stays offered. Fall back to a
      // browser/WebView download and report THAT location, not a guess.
      const fallback = [
        "# Forge — session diagnostics (client-only)",
        "",
        `Exported: ${new Date().toISOString()}`,
        "",
        "Forge's engine was unreachable; this file has the UI session only.",
        "",
        clientBundle,
      ].join("\n");
      const filename = suggestDiagnosticsFilename();
      downloadDiagnostics(filename, fallback);
      const detail = e instanceof Error ? e.message : String(e);
      setExportStatus(`Downloaded to your browser's Downloads folder as ${filename}`);
      setConnTest(`Client-only export · ${detail}`);
    }
  }, [sessionId, state, pathInput, errorBanner, boot, bootMsg, launchStatus]);

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
    const evidence = railEvidenceFromRun(nextRun);
    if (evidence.length === 0) return;
    setMessages((prev) => {
      let changed = false;
      const next = prev.slice();
      const identities = new Set(prev.map((m) => m.activityIdentity).filter((id): id is string => Boolean(id)));
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
  applyRailEvidenceRef.current = applyRailEvidence;

  const paintEnvelopeActivity = useCallback((activity: import("./runReducer").ActivityRecord) => {
    const identity = `tool:${activity.activityId}:${activity.invocationId}`;
    const stamp = stampActivity(identity);
    if (!stamp) return;
    const body = activity.output != null ? formatToolOutput(activity.output) : "";
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.role === "tool" && m.activityIdentity === identity);
      const entry: ChatMessage = {
        id: activity.activityId,
        role: "tool",
        content: body || (activity.input != null ? formatToolInput(activity.input) : ""),
        activityIdentity: stamp.activityIdentity,
        activityRunKey: stamp.activityRunKey,
        activityOrder: stamp.activityOrder,
        toolMeta: {
          activityId: activity.activityId,
          toolCallId: activity.invocationId,
          name: activity.name,
          summary: activity.command ?? activity.path ?? undefined,
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
  paintEnvelopeActivityRef.current = paintEnvelopeActivity;

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
      if (
        nextRun &&
        (runEvent.payload.kind === "decision_request" || runEvent.payload.kind === "activity_update")
      ) {
        setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
        setPermissions((prev) => mergePendingPermissions(prev, nextRun));
        applyRailEvidenceRef.current(nextRun);
        if (runEvent.payload.kind === "activity_update") {
          paintEnvelopeActivityRef.current(runEvent.payload.activity);
        }
      }
      if (runEvent.payload.kind === "run_terminal") {
        if (nextRun) {
          setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
          setPermissions((prev) => mergePendingPermissions(prev, nextRun));
        }
        setRunStartedAt(null);
        setRunPhase(null);
        setRunPhaseDetail(null);
        setAwaitingNextTurn(true);
        const kind = runEvent.payload.terminalKind;
        void notifyDesktop(
          "Forge",
          kind === "answered" ? "Answer ready" : kind === "cancelled" ? "Run cancelled" : "Run ended",
        );
      } else if (runEvent.payload.kind === "run_state") {
        setRunPhaseDetail(runEvent.payload.state === "recovering" ? "Recovering run…" : runEvent.payload.state === "cancelling" ? "Ending run…" : null);
      }
      return;
    }
    if (ev.type === "state") {
      applyState(ev.state);
      setModelDraft(ev.state.model);
      if (!ev.state.connected) markDisconnectedActivity();
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
          return [...q, { id: ev.id!, path: ev.path, diff: ev.diff }];
        });
        setActiveDiffId((cur) => cur ?? ev.id!);
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
        setMessages((prev) => {
          const settled = prev.map((m) =>
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
          if (
            last?.role === "system" &&
            last.content.startsWith("Stopped by you")
          ) {
            return cleaned;
          }
          return [
            ...cleaned,
            { id: uid(), role: "system", content: "Stopped by you." },
          ];
        });
        setRunFooter("Stopped by you");
        toast.push("Stopped by you", "info");
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
      setRunStartedAt(null);
      toolFailCountRef.current = 0;
      return;
    }
  }, [applyState, bindNormalizedRun, commitRunProjection, markDisconnectedActivity, reportError, stampActivity, toast]);

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
    setBuildInfo(await localBuildIdentity());
    try {
      const h = await api.health();
      setBuildInfo({ version: h.version, channel: h.channel, channelLabel: h.channelLabel });
    } catch {
      /* engine unreachable — keep the local build identity set above */
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
    await refreshBuildInfo();
    if (!ok) {
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
    setBoot("ready");
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
          void restoreOwnedRuns("disconnect_restore").then(({ ok, hasNonterminal }) => {
            if (!ok) return;
            if (!hasNonterminal) {
              setRunStartedAt(null);
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
  }, [boot, markDisconnectedActivity]);

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
          paintEnvelopeActivityRef.current(activity);
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
            paintEnvelopeActivityRef.current(activity);
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

  // Normalized terminal truth owns the legacy run chrome regardless of which
  // transport delivered it (live WS, resume, admission replay, or health
  // reconciliation). This effect runs only after React has committed the
  // terminal projection, so it cannot observe the stale pre-reducer snapshot.
  useEffect(() => {
    const ownedRuns = runProjection.runOrder
      .map((id) => runProjection.runsById[id])
      .filter((run): run is NonNullable<typeof run> => Boolean(run && run.sessionId === sessionId));
    if (!ownedRuns.length || ownedRuns.some((run) => run.state !== "terminal")) return;
    setRunStartedAt(null);
    setRunPhase(null);
    setRunPhaseDetail(null);
    setRunFooter(null);
    setAwaitingNextTurn(true);
    cancelInFlightRef.current = false;
  }, [runProjection, sessionId]);

  // F5 — liveness is independent from socket lifecycle. Keeping this poll in
  // its own effect prevents a failed probe's state update from tearing down and
  // recreating the WebSocket (which can otherwise amplify reconnect work).
  useEffect(() => {
    if (boot !== "ready") return;
    const healthCadence = 4000;
    const pollHealth = () => { void api.health().then(() => {
      healthFailStreakRef.current = 0;
      setHealthFailStreak(0);
      setHostOk(true);
      // A healthy transport does not prove a run outcome. Poll only runs that
      // remain nonterminal in the owned projection, and merge journal truth
      // idempotently. Hours-long live runs remain live; missed terminals are
      // recovered without requiring a reload or a second prompt.
      const hasOwnedNonterminal = runProjectionRef.current.runOrder.some((id) => {
        const run = runProjectionRef.current.runsById[id];
        return Boolean(run && run.state !== "terminal");
      });
      if (hasOwnedNonterminal) void reconcileOwnedRuns();
    }).catch(() => { healthFailStreakRef.current += 1; const streak = healthFailStreakRef.current; setHealthFailStreak(streak); if (streak >= 2) setHostOk(false); }); };
    const testCleanup = installHealthPollTestScheduler(pollHealth);
    const healthTimer = testCleanup ? undefined : setInterval(pollHealth, healthCadence);
    return () => { if (healthTimer !== undefined) clearInterval(healthTimer); testCleanup?.(); };
  }, [boot]);

  // Reconnect/replay is driven by the reducer's durable per-session cursors.
  // The socket never guesses a cursor and never replays another session.
  useEffect(() => {
    const cursors = runProjection.runOrder
      .map((runId) => runProjection.runsById[runId])
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .map((run) => ({ sessionId: run.sessionId, runId: run.runId, afterEventSeq: run.lastEventSeq }));
    socketRef.current?.resume(cursors);
  }, [runProjection]);

  // Hydrated runs are reconciled from the host journal as soon as the shell is
  // ready. This closes the reload gap where localStorage has identity/cursor
  // but the WebSocket subscription was not yet attached.
  useEffect(() => {
    if (boot !== "ready") return;
    void restoreOwnedRuns("boot_hydrate");
  }, [boot, restoreOwnedRuns]);

  const refreshFiles = useCallback(async () => {
    try {
      const { files } = await api.workspaceFiles();
      setFileIndex(files);
    } catch {
      setFileIndex([]);
    }
  }, []);

  useEffect(() => {
    if (hostOk && (state?.workspace || state?.mode !== "code")) void refreshFiles();
  }, [state?.workspace, state?.mode, hostOk, refreshFiles]);

  useEffect(() => {
    if (!state?.workspace) {
      setClassesView(null);
      setClassesStatus("no_workspace");
      return;
    }
    if (!hostOk) {
      setClassesStatus("offline");
      return;
    }
    let cancelled = false;
    setClassesStatus("loading");
    void api.trustedCommandClasses(state.workspace).then(
      (res) => {
        if (cancelled) return;
        setClassesView(res.classes);
        setClassesStatus("confirmed");
      },
      () => {
        if (cancelled) return;
        setClassesStatus("unconfirmed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [state?.workspace, hostOk]);

  // AC-U5 — with `owned: false` no restart/reconnect affordance renders
  // anywhere (dev-shell-only state; unreachable in a packaged prod build).
  const engineRetryAllowed = useMemo(
    () => canRetryEngine(launchStatus ?? { owned: true }),
    [launchStatus],
  );
  const chip = useMemo(() => statusChip(state), [state]);
  const activeRun = useMemo(() => runProjection.runOrder
    .map((id) => runProjection.runsById[id])
    .find((run) => run?.sessionId === sessionId && run.state !== "terminal") ?? null,
    [runProjection, sessionId]);
  const projectedRunIds = useMemo(() => new Set(
    runProjection.runOrder.filter((id) => runProjection.runsById[id]?.sessionId === sessionId),
  ), [runProjection, sessionId]);
  const visibleMessages = useMemo(
    () => messages.filter((message) =>
      !message.projectedRunId || !projectedRunIds.has(message.projectedRunId),
    ),
    [messages, projectedRunIds],
  );
  const normalizedRunVisible = projectedRunIds.size > 0;
  // Run ownership is local to the active client session. The host's legacy
  // global `busy` bit is intentionally not a send/cancel authority: another
  // session may be running while this one remains usable.
  const busy = Boolean(activeRun) || Boolean(runStartedAt);
  busyRef.current = busy;
  const connected = hostOk;
  const productMode: ProductMode = state?.mode === "code" ? "code" : "chat";
  const livePlanning = Boolean(activeRun && isLivePlanning(activeRun));
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
        empty: (run.plan?.proposedMembers.length ?? 0) === 0,
      };
    }
    return null;
  }, [runProjection, sessionId]);
  const planArm = projectPlanArm({
    mode: productMode,
    workspace: state?.workspace ?? null,
    connected,
    planEngagement: state?.planEngagement,
    busyOther: Boolean(activeRun && !isLivePlanning(activeRun)),
    armError: planArmError,
  });
  const projectInstructionsComposer = projectProjectInstructionsComposer({
    mode: productMode,
    workspace: state?.workspace ?? null,
    connected,
    projectInstructions: state?.projectInstructions,
  });
  const effortLevel: EffortLevel =
    state?.effort === "fast" ||
    state?.effort === "expert" ||
    state?.effort === "heavy" ||
    state?.effort === "auto"
      ? state.effort
      : prefs.effort || "auto";
  const sessionPartition = useMemo(
    () =>
      partitionKey(
        productMode,
        productMode === "chat" ? state?.chatRoot : state?.workspace,
      ),
    [productMode, state?.chatRoot, state?.workspace],
  );
  // Chat sandbox path stays hidden until the user explicitly binds a folder
  // (SPEC §4); null here means "default sandbox, nothing to show".
  const chatRootLabel = useMemo(
    () =>
      state?.chatRoot?.includes("chat-sandbox")
        ? null
        : state?.workspaceName || state?.chatRoot?.split(/[/\\]/).pop() || null,
    [state?.chatRoot, state?.workspaceName],
  );
  const activeHome = sessionId ? loadSession(sessionPartition, sessionId) : null;
  const chatPackComposer = projectChatPackComposer({
    mode: productMode,
    connected,
    conversationId: productMode === "chat" ? sessionId : null,
    chatPack: state?.chatPack,
    durableMembers: activeHome?.packMembers,
  });
  const packInventoryVisible =
    productMode === "chat" &&
    chatPackComposer.state !== "absent_code" &&
    (packInventoryOpen ||
      chatPackComposer.state === "pin_failed" ||
      chatPackComposer.state === "note_failed" ||
      chatPackComposer.state === "hydrate_failed" ||
      chatPackComposer.state === "confirm_error");
  const vouchedPack = state?.chatPack;
  const armedPackMembers =
    vouchedPack &&
    vouchedPack.conversationId === sessionId &&
    vouchedPack.vouched &&
    !vouchedPack.confirmFailed
      ? vouchedPack.members
      : { files: [], note: null };

  const switchMode = useCallback(
    async (mode: ProductMode) => {
      // Always available (SPEC §4): not blocked by busy/streaming or a pending
      // permission — only guard true reentrancy (a switch already in flight)
      // and a no-op click on the already-active mode.
      if (modeSwitching) return;
      if (mode === productMode) return;
      setModeSwitching(true);
      try {
        // The authoritative path is the session-owned run. During the legacy
        // boot/migration window a host may report busy before the first
        // run_started envelope reaches the shell; cancel that local host run
        // only as a compatibility fallback for a mode transition. This does
        // not participate in Send/cancel admission and must never be used for
        // switching between independent sessions.
        if (activeRun && sessionId) {
          await api.cancelRun(sessionId, activeRun.runId).catch(() => undefined);
        } else if (state?.busy) {
          await api.cancel().catch(() => undefined);
        }
        // Persist current transcript into current partition before host mode flip
        if (sessionId) {
          const msgs = messagesRef.current
            .filter((m) => m.role !== "tool" || m.content)
            .map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              projectedRunId: m.projectedRunId,
              toolMeta: m.toolMeta,
            }));
          saveSessionMessages(sessionPartition, sessionId, msgs);
          flushSessions();
        }
        const s = await api.setMode(mode);
        applyState(s);
        setPrefs((p) =>
          patchPrefs({
            lastMode: mode,
            usedCode: p.usedCode || mode === "code",
          }),
        );
        const key = partitionKey(
          mode,
          mode === "chat" ? s.chatRoot : s.workspace,
        );
        const active = ensureActiveSession(key, null);
        setSessionId(active.id);
        setSessionList(listSessions(key));
        setMessages(
          active.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            projectedRunId: m.projectedRunId,
            toolMeta: m.toolMeta,
          })),
        );
        setPermissions([]);
        setDiffQueue([]);
        discardTranscriptStream();
      } catch (e) {
        reportError(e instanceof Error ? e.message : String(e));
      } finally {
        setModeSwitching(false);
      }
    },
    [
      productMode,
      modeSwitching,
      busy,
      state?.busy,
      reportError,
      sessionId,
      activeRun,
      sessionPartition,
      discardTranscriptStream,
    ],
  );

  // Chat needs no "New chat" ceremony to be safe (AC2/AC3): a session must
  // back the transcript as soon as Chat's root is known, the same guarantee
  // Code already gets from openWorkspace. Without this, a virgin profile's
  // first turn is never backed by a session record — sessionId stays null,
  // switchMode's persist-before-flip guard (`if (sessionId)`) is a no-op,
  // and the conversation is silently dropped on a mid-stream mode switch or
  // lost on reload. `ensureActiveSession` is idempotent (reuses the
  // partition's existing active session when one exists), so this only
  // creates a fresh session the first time a given partition has none —
  // it never overwrites an in-progress transcript that already has a
  // sessionId. Code is untouched: it stays gated behind an explicit
  // workspace open (SPEC §4 "open workspace" empty state), so it never
  // reaches a state where a turn can be sent without a session.
  useEffect(() => {
    if (boot !== "ready") return;
    if (productMode !== "chat") return;
    if (!state) return;
    if (sessionId) return;
    const active = ensureActiveSession(sessionPartition, null);
    setSessionId(active.id);
    setSessionList(listSessions(sessionPartition));
    setMessages(
      active.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        projectedRunId: m.projectedRunId,
        toolMeta: m.toolMeta,
      })),
    );
  }, [boot, productMode, sessionId, sessionPartition, state]);

  useEffect(() => {
    if (boot !== "ready") return;
    // Host mode only — do not hydrate during the pre-state window where
    // productMode defaults to chat, or a Code remount would race restore.
    if (state?.mode !== "chat" || !sessionId || !hostOk) return;
    const conversationId = sessionId;
    const durable = loadSession(sessionPartition, conversationId)?.packMembers ?? {
      files: [],
      note: null,
    };
    let cancelled = false;
    void api
      .chatPack({
        sessionId: stateRef.current?.sessionId || conversationId,
        conversationId,
        action: "hydrate",
        members: {
          files: (durable.files ?? []).map((f) => ({ path: f.path })),
          note: durable.note ?? null,
        },
      })
      .then((s) => {
        if (cancelled) return;
        applyState(s);
      })
      .catch(() => {
        // 400 is not PublicState — wait for WS lastAttempt. Do not invent refuse.
      });
    return () => {
      cancelled = true;
    };
  }, [boot, state?.mode, sessionId, hostOk, sessionPartition, applyState]);

  // Code sessions must be initialized when the host restores an existing
  // workspace too; otherwise the Send button can appear enabled while
  // sendText correctly refuses to dispatch without an owned session.
  useEffect(() => {
    if (boot !== "ready" || productMode !== "code" || sessionId || !state?.workspace) return;
    const active = ensureActiveSession(sessionPartition, null);
    setSessionId(active.id);
    setSessionList(listSessions(sessionPartition));
    setMessages(active.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, projectedRunId: m.projectedRunId, toolMeta: m.toolMeta })));
  }, [boot, productMode, sessionId, state?.workspace, sessionPartition]);

  const setEffortUi = useCallback(
    async (effort: EffortLevel) => {
      try {
        const s = await api.setEffort(effort);
        applyState(s);
        setPrefs((p) => patchPrefs({ ...p, effort }));
      } catch (e) {
        reportError(e instanceof Error ? e.message : String(e));
      }
    },
    [reportError],
  );

  const setPlanEngagementUi = useCallback(
    async (engaged: boolean) => {
      const previous = stateRef.current?.planEngagement?.engaged ? "Plan" : "Execute";
      try {
        const s = await api.setPlanEngagement(engaged);
        applyState(s);
        setPlanArmError(null);
      } catch (e) {
        if (e instanceof ApiError && e.code === "plan_engagement_unvouched") {
          setPlanArmError(null);
          reportError(PLAN_ARM_BLOCKED_UNVOUCHED);
          return;
        }
        setPlanArmError(planArmFailureCopy(previous));
      }
    },
    [reportError],
  );

  const sessionHasNonTerminalRun = activeRun != null;
  const sessionHasDockOwnedPending = useMemo(() => {
    return runProjection.runOrder.some((id) => {
      const run = runProjection.runsById[id];
      return Boolean(run && run.sessionId === sessionId && hasDockOwnedPending(run));
    });
  }, [runProjection, sessionId]);
  const turnReady =
    !sessionHasNonTerminalRun &&
    !sessionHasDockOwnedPending &&
    awaitingNextTurn &&
    visibleMessages.length > 0;

  const sendDisabledReason = useMemo(() => {
    if (!connected) return "Engine offline — try again to send";
    if (productMode === "code" && !state?.workspace)
      return "Open a project folder first";
    if (!state?.hasApiKey) return "Sign in or add an API key in Settings";
    if (productMode === "code" && (!state?.planEngagement || state.planEngagement.vouched === false)) {
      return PLAN_ARM_BLOCKED_UNVOUCHED;
    }
    if (
      oauth ||
      permissions.length > 0 ||
      diffQueue.length > 0 ||
      pendingPlanDecision ||
      sessionHasDockOwnedPending
    ) {
      return SETTLE_CARD_BELOW;
    }
    if (sessionHasNonTerminalRun) return "A run is in progress";
    if (!state?.permissionPolicy || state.permissionPolicy.status !== "confirmed") return "Permission policy is not confirmed";
    if (!draft.trim()) return "Type a message to send";
    return null;
  }, [connected, productMode, state?.workspace, state?.hasApiKey, state?.permissionPolicy, state?.planEngagement, sessionHasNonTerminalRun, sessionHasDockOwnedPending, draft, oauth, permissions.length, diffQueue.length, pendingPlanDecision]);
  const overview = useMemo(
    () =>
      computeOverview(
        messages,
        diffQueue.map((d) => d.path),
      ),
    [messages, diffQueue],
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

  const openPath = useCallback(async (p: string) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    // Guard: session partition keys must never hit the filesystem API (silent)
    if (trimmed.startsWith("chat:") || trimmed === "__no_workspace__") {
      return;
    }

    const current = stateRef.current?.workspace;
    // Already on this workspace and not thrashing — just focus UI.
    if (current === trimmed) {
      setPathInput(trimmed);
      setExpanded(trimmed, true);
      refreshTree();
      return;
    }

    const now = Date.now();
    if (
      openInFlightRef.current === trimmed &&
      now - lastOpenAtRef.current < 900
    ) {
      return;
    }

    if (busyRef.current) {
      const ok = window.confirm(
        "Agent is still running. Switch workspace? This cancels the current run.",
      );
      if (!ok) return;
      try {
        await api.cancel();
      } catch {
        /* continue */
      }
    }

    openInFlightRef.current = trimmed;
    lastOpenAtRef.current = now;
    setErrorBanner(null);
    setOpeningWs(true);
    toast.push(`Opening ${trimmed.split(/[/\\]/).pop()}…`, "info");
    try {
      const s = await api.openWorkspace(trimmed);
      applyState(s);
      const ws = s.workspace || trimmed;
      setPathInput(ws);
      let branch: string | null = null;
      try {
        const b = await api.workspaceBranch(ws);
        branch = b.branch;
        setBranchMap((m) => ({ ...m, [ws]: branch }));
      } catch {
        /* no git */
      }
      const active = ensureActiveSession(ws, branch);
      if (branch) setSessionBranch(ws, active.id, branch);
      setSessionId(active.id);
      setSessionList(listSessions(ws));
      setMessages(
        active.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          projectedRunId: m.projectedRunId,
          toolMeta: m.toolMeta,
        })),
      );
      setDiffQueue([]);
      setActiveDiffId(null);
      setPermissions([]);
      setSessionWrite(false);
      setSessionShell(false);
      setView("chat");
      setOpeningWs(false);
      setFirstRun((fr) => patchFirstRun({ ...fr, openedFolder: true }));
      setExpanded(ws, true);
      refreshTree();
      void refreshFiles();
      void refreshBranches(listPinnedWorkspaces());
      toast.push(`Workspace ready · ${ws.split(/[/\\]/).pop()}`, "success");
    } catch (err) {
      setOpeningWs(false);
      reportError(err instanceof Error ? err.message : String(err));
    } finally {
      if (openInFlightRef.current === trimmed) openInFlightRef.current = null;
    }
  }, [refreshFiles, refreshTree, refreshBranches, reportError, toast]);

  const persistMessages = useCallback(
    (ws: string, sid: string, msgs: ChatMessage[]) => {
      const stored = msgs
        .filter((m) => m.role !== "tool" || m.content)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          projectedRunId: m.projectedRunId,
          toolMeta: m.toolMeta,
        }));
      const firstUser = msgs.find((m) => m.role === "user")?.content.slice(0, 48);
      saveSessionMessages(ws, sid, stored, firstUser);
      setSessionList(listSessions(ws));
    },
    [],
  );

  // Autosave active session (mode-partitioned key)
  useEffect(() => {
    if (!sessionId) return;
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      persistMessages(sessionPartition, sessionId, messages);
    }, 400);
    return () => clearTimeout(t);
  }, [messages, sessionPartition, sessionId, persistMessages]);

  const switchSession = useCallback(
    async (partition: string, id: string) => {
      if (sessionId === id && partition === sessionPartition) return;
      if (sessionId) {
        persistMessages(sessionPartition, sessionId, messagesRef.current);
        updateSessionMeta(sessionPartition, sessionId, { status: "idle" });
        flushSessions();
      }
      if (busyRef.current) {
        await api.cancel().catch(() => undefined);
      }
      discardTranscriptStream();
      setAwaitingNextTurn(false);
      setRunFooter(null);
      // Code partitions only: open real FS path. Never open "chat:..." keys.
      const isChatKey = partition.startsWith("chat:");
      if (
        !isChatKey &&
        partition !== "__no_workspace__" &&
        partition !== state?.workspace
      ) {
        await openPath(partition);
      }
      const s = loadSession(partition, id);
      if (!s) return;
      setActiveSession(partition, id);
      setSessionId(id);
      setHomeNameSaveFailed(false);
      setPackInventoryOpen(false);
      setSessionList(listSessions(partition));
      setMessages(
        s.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          projectedRunId: m.projectedRunId,
          toolMeta: m.toolMeta,
        })),
      );
      setDiffQueue([]);
      setPermissions([]);
      setView("chat");
      refreshTree();
    },
    [
      sessionPartition,
      sessionId,
      persistMessages,
      openPath,
      refreshTree,
      state?.workspace,
      discardTranscriptStream,
    ],
  );

  const newSession = useCallback(
    (workspace?: string) => {
      const ws = workspace || sessionPartition;
      if (!ws || ws === "__no_workspace__") {
        if (productMode === "code") {
          reportError("Open a project folder first — use Open folder…");
        }
        return;
      }
      if (sessionId) {
        persistMessages(sessionPartition, sessionId, messagesRef.current);
        updateSessionMeta(sessionPartition, sessionId, { status: "idle" });
      }
      if (busyRef.current) {
        void api.cancel().catch(() => undefined);
      }
      discardTranscriptStream();
      const isChatKey = ws.startsWith("chat:");
      const branch =
        !isChatKey && ws === state?.workspace
          ? (branchMap[ws] ?? null)
          : null;
      const s = createSession(ws, "New chat", branch);
      if (
        !isChatKey &&
        ws !== state?.workspace &&
        ws !== "__no_workspace__"
      ) {
        void openPath(ws).then(() => {
          setSessionId(s.id);
          setSessionList(listSessions(ws));
          setMessages([]);
        });
      } else {
        setSessionId(s.id);
        setSessionList(listSessions(ws));
        setMessages([]);
      }
      setDiffQueue([]);
      setPermissions([]);
      setView("chat");
      refreshTree();
    },
    [
      sessionPartition,
      sessionId,
      persistMessages,
      branchMap,
      openPath,
      refreshTree,
      state?.workspace,
      productMode,
      reportError,
      discardTranscriptStream,
    ],
  );

  // Reflect agent busy on active session — avoid full tree thrash every flip
  useEffect(() => {
    if (!sessionId) return;
    updateSessionMeta(sessionPartition, sessionId, {
      status: busy ? "busy" : "live",
    });
    setSessionList(listSessions(sessionPartition));
    // Code pins only need branch refresh when not busy (settle)
    if (!busy && productMode === "code") {
      setExpandTick((t) => t + 1);
    }
  }, [busy, sessionPartition, sessionId, productMode]);

  useEffect(() => {
    if (productMode === "chat") return;
    const paths = listPinnedWorkspaces();
    setPinnedPaths(paths);
    void refreshBranches(paths);
  }, [refreshBranches, expandTick, productMode]);

  const treeWorkspaces: WorkspaceNode[] = useMemo(() => {
    if (productMode === "chat") return [];
    const paths = pinnedPaths.length
      ? pinnedPaths
      : state?.workspace
        ? [state.workspace]
        : [];
    return paths.map((path) => ({
      path,
      name: workspaceDisplayName(path),
      branch: branchMap[path] ?? null,
      sessions: listSessions(path),
      expanded: isExpanded(path),
      active: path === state?.workspace,
    }));
  }, [
    productMode,
    pinnedPaths,
    branchMap,
    state?.workspace,
    expandTick,
    sessionList,
  ]);

  const chatSessions = useMemo(
    () => (productMode === "chat" ? listSessions(sessionPartition) : []),
    [productMode, sessionPartition, sessionList, expandTick],
  );

  const browseFolder = useCallback(async () => {
    const native = await pickFolderNative();
    if (native) {
      setPathInput(native);
      await openPath(native);
      return;
    }
    document.getElementById("workspace-path")?.focus();
  }, [openPath]);

  const bindChatFolder = useCallback(async () => {
    const native = await pickFolderNative();
    if (!native) return;
    try {
      const s = await api.setChatRoot(native);
      applyState(s);
      const key = partitionKey("chat", s.chatRoot);
      const active = ensureActiveSession(key, null);
      setSessionId(active.id);
      setSessionList(listSessions(key));
      setMessages(
        active.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          projectedRunId: m.projectedRunId,
          toolMeta: m.toolMeta,
        })),
      );
      toast.push(`Chat files · ${s.workspaceName || "folder"}`, "success");
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e));
    }
  }, [reportError, toast]);

  const clearChatFolder = useCallback(async () => {
    try {
      const s = await api.setChatRoot(null);
      applyState(s);
      const key = partitionKey("chat", s.chatRoot);
      const active = ensureActiveSession(key, null);
      setSessionId(active.id);
      setSessionList(listSessions(key));
      setMessages(
        active.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          projectedRunId: m.projectedRunId,
          toolMeta: m.toolMeta,
        })),
      );
      toast.push("Using personal sandbox", "info");
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e));
    }
  }, [reportError, toast]);

  const decidePermission = useCallback(
    async (decision: "allow_once" | "allow_session" | "deny") => {
      const p = permissions[0];
      if (!p) return;
      try {
        await api.runPermission({
          sessionId: p.sessionId,
          runId: p.runId,
          requestId: p.id,
          invocationId: p.invocationId,
          decision,
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
          if (stillPending) return prev;
          return prev.filter((x) => x.id !== p.id);
        });
        toast.push(
          decision === "deny"
            ? `Denied ${p.kind}`
            : `Allowed ${p.kind}${decision === "allow_session" ? " (session)" : ""}`,
          decision === "deny" ? "info" : "success",
        );
      } catch (err) {
        reportError(err instanceof Error ? err.message : String(err));
      }
    },
    [permissions, reportError, toast],
  );

  const trustFolder = useCallback(async () => {
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
      toast.push("Diff accepted", "success");
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    }
  }, [reportError, settleOwnedDiff, toast]);

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
      toast.push("Diff rejected", "info");
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    }
  }, [reportError, settleOwnedDiff, toast]);

  const acceptAllDiffs = useCallback(async () => {
    const ids = diffQueue.map((d) => d.id);
    let ok = 0;
    let fail = 0;
    const failed = new Set<string>();
    const keepEnvelope = new Set<string>();
    for (const id of ids) {
      try {
        const envelopePending = await settleOwnedDiff(id, "accept");
        ok += 1;
        if (envelopePending) keepEnvelope.add(id);
      } catch {
        fail += 1;
        failed.add(id);
      }
    }
    setDiffQueue((q) => q.filter((d) => failed.has(d.id) || keepEnvelope.has(d.id)));
    toast.push(
      fail
        ? `Accepted ${ok}, failed ${fail}`
        : `Accepted ${ok} file${ok === 1 ? "" : "s"}`,
      fail ? "error" : "success",
    );
  }, [diffQueue, settleOwnedDiff, toast]);

  const rejectAllDiffs = useCallback(async () => {
    const ids = diffQueue.map((d) => d.id);
    let ok = 0;
    let fail = 0;
    const failed = new Set<string>();
    const keepEnvelope = new Set<string>();
    for (const id of ids) {
      try {
        const envelopePending = await settleOwnedDiff(id, "reject");
        ok += 1;
        if (envelopePending) keepEnvelope.add(id);
      } catch {
        fail += 1;
        failed.add(id);
      }
    }
    setDiffQueue((q) => q.filter((d) => failed.has(d.id) || keepEnvelope.has(d.id)));
    toast.push(
      fail
        ? `Rejected ${ok}, failed ${fail}`
        : `Rejected ${ok} file${ok === 1 ? "" : "s"}`,
      fail ? "error" : "info",
    );
  }, [diffQueue, settleOwnedDiff, toast]);

  const openToolPath = useCallback(async (path: string) => {
    setPeek({ path, content: "Loading…" });
    try {
      const file = await api.workspaceRead(path);
      setPeek({
        path: file.path,
        content:
          file.content +
          (file.truncated ? "\n\n… (truncated for display)" : ""),
      });
    } catch {
      const tools = messagesRef.current.filter(
        (m) =>
          m.role === "tool" &&
          (m.toolMeta?.summary === path || m.content.includes(path)),
      );
      const last = tools[tools.length - 1];
      setPeek({
        path,
        content:
          last?.content ||
          "(Could not read file from workspace; no cached tool output.)",
      });
    }
  }, []);

  const renameSession = useCallback(
    (workspace: string, id: string, title: string) => {
      if (workspace.startsWith("chat:")) {
        const ok = commitHomeName(workspace, id, title);
        setHomeNameSaveFailed(!ok);
        setHomeNameDraft(title);
        setSessionList(listSessions(workspace));
        refreshTree();
        if (ok) toast.push("Session renamed", "success");
        return;
      }
      updateSessionMeta(workspace, id, { title });
      // Compare partition key (chat:… or code path), not host FS workspace alone
      setSessionList(listSessions(workspace));
      refreshTree();
      toast.push("Session renamed", "success");
    },
    [refreshTree, toast],
  );

  const persistAcceptedPack = useCallback(
    (
      conversationId: string,
      action: "pin_file" | "unpin_file" | "set_note" | "clear_note" | "clear_pack",
      body: { path?: string; note?: string },
    ) => {
      const prev = loadSession(sessionPartition, conversationId)?.packMembers ?? {
        files: [],
        note: null,
      };
      if (action === "pin_file" && body.path) {
        if (!prev.files.some((f) => f.path === body.path)) {
          updatePackMembers(sessionPartition, conversationId, {
            files: [...prev.files, { path: body.path }],
            note: prev.note,
          });
        }
      } else if (action === "unpin_file" && body.path) {
        updatePackMembers(sessionPartition, conversationId, {
          files: prev.files.filter((f) => f.path !== body.path),
          note: prev.note,
        });
      } else if (action === "set_note") {
        const note = body.note === "" || body.note == null ? null : body.note;
        updatePackMembers(sessionPartition, conversationId, {
          files: prev.files,
          note,
        });
      } else if (action === "clear_note") {
        updatePackMembers(sessionPartition, conversationId, {
          files: prev.files,
          note: null,
        });
      } else if (action === "clear_pack") {
        clearPackMembers(sessionPartition, conversationId);
      }
      setSessionList(listSessions(sessionPartition));
    },
    [sessionPartition],
  );

  const mutateChatPack = useCallback(
    async (
      action:
        | { action: "pin_file"; path: string }
        | { action: "unpin_file"; path: string }
        | { action: "set_note"; note: string }
        | { action: "clear_note" }
        | { action: "clear_pack" },
    ) => {
      if (productMode !== "chat" || !sessionId) return;
      const conversationId = sessionId;
      setPackMutationInFlight(true);
      try {
        const s = await api.chatPack({
          sessionId: stateRef.current?.sessionId || conversationId,
          conversationId,
          ...action,
        });
        applyState(s);
        if (s.mode === "code" || s.chatPack?.conversationId !== conversationId) return;
        persistAcceptedPack(conversationId, action.action, {
          path: "path" in action ? action.path : undefined,
          note: "note" in action ? action.note : undefined,
        });
      } catch {
        // Refuse body is not PublicState. Wait for WS chatPack; do not invent lastAttempt.
      } finally {
        setPackMutationInFlight(false);
      }
    },
    [productMode, sessionId, persistAcceptedPack, applyState],
  );

  const removeSession = useCallback(
    (workspace: string, id: string) => {
      const next = deleteSession(workspace, id);
      if (sessionId === id) {
        discardTranscriptStream();
        if (next) {
          setSessionId(next.id);
          setMessages(
            next.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              projectedRunId: m.projectedRunId,
              toolMeta: m.toolMeta,
            })),
          );
        } else {
          setSessionId(null);
          setMessages([]);
        }
      }
      setSessionList(listSessions(workspace));
      refreshTree();
      toast.push("Session deleted", "info");
    },
    [sessionId, refreshTree, toast, discardTranscriptStream],
  );

  const requestCancel = useCallback(() => {
    if (cancelInFlightRef.current && !busyRef.current) return;
    cancelInFlightRef.current = true;
    setRunPhaseDetail("Cancelling…");
    setRunFooter("Cancelling…");
    toast.push("Cancel requested", "info");
    const active = runProjection.runOrder
      .map((id) => runProjection.runsById[id])
      .find((run) => run?.sessionId === sessionId && run.state !== "terminal");
    const cancelRequest = active && sessionId
      ? api.cancelRun(sessionId, active.runId)
      : api.cancel();
    void cancelRequest
      .then(async (result) => {
        if (active && sessionId && "run" in result && result.run) {
          commitRunProjection(mergeRunSnapshot(runProjectionRef.current, result.run));
          try {
            const replay = await api.runState(active.runId, sessionId, 0);
            commitRunProjection(reduceRunEvents(mergeRunSnapshot(runProjectionRef.current, replay.run), replay.events));
            if (replay.run.state === "terminal") { setRunStartedAt(null); setRunPhase(null); setRunPhaseDetail(null); setRunFooter(null); setAwaitingNextTurn(true); cancelInFlightRef.current = false; }
          } catch { /* socket replay remains available */ }
        }
      })
      .catch((e) => {
        cancelInFlightRef.current = false;
        // A fast run can terminalize between discovering it and POST /cancel.
        // 409 run_terminal is a reconciliation signal, never a stale
        // cancelling state. Fetch the owned journal and project its terminal.
        if (active && sessionId && e?.status === 409 && e?.code === "run_terminal") {
          void api.runState(active.runId, sessionId, 0)
            .then((replay) => {
              commitRunProjection(reduceRunEvents(mergeRunSnapshot(runProjectionRef.current, replay.run), replay.events));
              if (replay.run.state === "terminal") {
                setRunStartedAt(null);
                setRunPhase(null);
                setRunPhaseDetail(null);
                setRunFooter(null);
                setAwaitingNextTurn(true);
                cancelInFlightRef.current = false;
              }
            })
            .catch((reconcileError) => reportError(reconcileError instanceof Error ? reconcileError.message : String(reconcileError)));
          return;
        }
        reportError(e instanceof Error ? e.message : String(e));
      });
  }, [toast, reportError, runProjection, sessionId]);

  const sendText = useCallback(
    async (
      raw: string,
      opts?: { skipUserBubble?: boolean; stripTrailingAssistant?: boolean },
    ) => {
      const text = raw.trim();
      const ownedRunActive = runProjection.runOrder.some((id) => {
        const run = runProjection.runsById[id];
        return run?.sessionId === sessionId && run.state !== "terminal";
      });
      if (!text || ownedRunActive || !connected || !sessionId) return;
      if (
        oauth ||
        permissions.length > 0 ||
        diffQueue.length > 0 ||
        pendingPlanDecision
      ) {
        return;
      }
      // F8 / AC6 — before any credential is stored, no message is sent and
      // no unlabeled provider error appears; the composer's disabled-reason
      // chip is the only signal, so a bypass via Enter (which does not read
      // the disabled attribute) must be refused here too.
      if (!state?.hasApiKey) return;
      if (!state.permissionPolicy || state.permissionPolicy.status !== "confirmed") return;
      const mode = state?.mode === "code" ? "code" : "chat";
      if (mode === "code" && !state?.workspace) {
        reportError("Open a project folder first — use Open folder…", {
          source: "prompt",
        });
        return;
      }
      if (mode === "code" && (!state?.planEngagement || state.planEngagement.vouched === false)) {
        reportError(PLAN_ARM_BLOCKED_UNVOUCHED, { source: "prompt" });
        return;
      }
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
      setRunPhaseDetail(
        effortLevel === "auto"
          ? "Waiting for Grok…"
          : `Waiting for Grok (${effortLevel} effort)…`,
      );
      setRunStartedAt(Date.now());
      setRunFooter(null);

      // Build transcript base for history + UI (sync, before setState lag)
      let base = messagesRef.current.slice();
      if (opts?.stripTrailingAssistant) {
        while (base.length) {
          const last = base[base.length - 1]!;
          if (
            last.role === "assistant" ||
            (last.role === "system" &&
              (last.content.startsWith("Stopped by you") ||
                last.content.startsWith("Run ended")))
          ) {
            base.pop();
            continue;
          }
          break;
        }
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

      // Prior turns only — last bubble is the user prompt we're about to send
      const history = base
        .slice(0, -1)
        .filter(
          (m) =>
            (m.role === "user" ||
              m.role === "assistant" ||
              m.role === "system") &&
            m.content?.trim() &&
            !m.content.startsWith("Stopped by you"),
        )
        .slice(-30)
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content.slice(0, 12_000),
        }));

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
        // Contract path: admission returns the authoritative RunSnapshot (202).
        // A successful response without it is invalid and is never retried via
        // the legacy endpoint, which could dispatch the prompt twice.
        const admitted = await api.promptRun({ sessionId, conversationId: sessionId, text: outbound, effort: effortLevel, history });
        if (!admitted.run) throw new Error("Host returned no run snapshot; prompt was not admitted");
        {
          const run = admitted.run;
          bindNormalizedRun(run.runId, run.sessionId);
          if (run.state === "terminal") {
            setRunStartedAt(null);
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
                paintEnvelopeActivityRef.current(activity);
              }
              setDiffQueue((prev) => mergePendingDiffs(prev, nextRun));
              setPermissions((prev) => mergePendingPermissions(prev, nextRun));
              applyRailEvidenceRef.current(nextRun);
            }
            if (replay.run.state === "terminal") {
              setRunStartedAt(null);
              setRunPhase(null);
              setRunPhaseDetail(null);
              setAwaitingNextTurn(true);
            }
          } catch {
            // WS resume remains authoritative and will retry on reconnect.
          }
        }
      } catch (err) {
        if (!normalizedRunIdRef.current) {
          pendingPromptMessageIdRef.current = null;
          pendingPromptSessionIdRef.current = null;
        }
        setRunPhase(null);
        setRunStartedAt(null);
        setAwaitingNextTurn(true);
        if (err instanceof ApiError && err.code === "plan_engagement_unvouched") {
          reportError(PLAN_ARM_BLOCKED_UNVOUCHED, { source: "prompt" });
          return;
        }
        if (err instanceof ApiError && err.code === "plan_decision_pending") {
          reportError(err.message || "plan_decision_pending", { source: "prompt" });
          return;
        }
        reportError(err instanceof Error ? err.message : String(err));
      }
    },
    [
      connected,
      sessionId,
      state?.workspace,
      state?.mode,
      state?.planEngagement,
      state?.permissionPolicy,
      effortLevel,
      reportError,
      beginStreamRun,
      bindNormalizedRun,
      runProjection,
      oauth,
      permissions.length,
      diffQueue.length,
      pendingPlanDecision,
    ],
  );

  const send = useCallback(async () => {
    await sendText(draft);
  }, [draft, sendText]);

  const settlePlan = useCallback(
    async (action: "accept" | "keep_planning") => {
      if (!pendingPlanDecision) return;
      setPlanSettling(true);
      setPlanDecisionError(null);
      try {
        await api.runPlan({
          sessionId: pendingPlanDecision.run.sessionId,
          runId: pendingPlanDecision.run.runId,
          requestId: pendingPlanDecision.decision.requestId,
          invocationId: pendingPlanDecision.decision.invocationId,
          connectionGeneration: pendingPlanDecision.run.connectionGeneration,
          action,
        });
      } catch (e) {
        setPlanDecisionError(PLAN_DECISION_FAILURE);
      } finally {
        setPlanSettling(false);
      }
    },
    [pendingPlanDecision],
  );

  const retryLastUser = useCallback(
    (_id: string, content: string) => {
      // Drop trailing assistant / stop chips; keep the last user bubble
      void sendText(content, {
        stripTrailingAssistant: true,
        skipUserBubble: true,
      });
    },
    [sendText],
  );

  const regenerateLast = useCallback(
    (userContent: string) => {
      void sendText(userContent, {
        skipUserBubble: true,
        stripTrailingAssistant: true,
      });
    },
    [sendText],
  );

  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && (m.content?.trim() || m.thinking?.trim())) {
        return m.id;
      }
    }
    return null;
  }, [messages]);

  const attachFilesToComposer = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const isPdfBatch = list.some((f) => /\.pdf$/i.test(f.name || ""));
      const cue = scheduleExtractingCue(isPdfBatch, () => {
        toast.push("Extracting PDF…", "info");
      });
      try {
        const { blocks, toasts } = await readFilesForAttach(list);
        cue.settle();
        if (blocks.length) {
          setDraft((d) => d + blocks.join(""));
          toast.push(
            `Attached ${blocks.length} file${blocks.length === 1 ? "" : "s"} as text`,
            "success",
          );
        }
        for (const t of toasts.slice(0, 3)) {
          toast.push(t, "error");
        }
      } catch (e) {
        cue.settle();
        throw e;
      }
      composerRef.current?.focus();
    },
    [toast],
  );

  const exportCurrentChat = useCallback(() => {
    const title =
      sessionId != null
        ? listSessions(sessionPartition).find((s) => s.id === sessionId)
            ?.title
        : undefined;
    const md = transcriptToMarkdown({
      title: title || "Chat",
      mode: productMode,
      messages: messagesRef.current,
    });
    downloadMarkdown(suggestChatFilename(title), md);
    toast.push("Downloaded chat as Markdown", "success");
  }, [sessionId, sessionPartition, productMode, toast]);

  const onComposerChange = (value: string) => {
    setDraft(value);
    const m = value.match(/@([^\s@]*)$/);
    if (m && fileIndex.length) {
      const q = m[1]!.toLowerCase();
      setAtSuggestions(
        fileIndex.filter((f) => f.toLowerCase().includes(q)).slice(0, 8),
      );
    } else {
      setAtSuggestions([]);
    }
  };

  const insertAtFile = (file: string) => {
    setDraft((d) => d.replace(/@([^\s@]*)$/, `@${file} `));
    setAtSuggestions([]);
    composerRef.current?.focus();
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (atSuggestions.length && (e.key === "ArrowDown" || e.key === "Tab")) {
      e.preventDefault();
      insertAtFile(atSuggestions[0]!);
      return;
    }
    if (e.key === "ArrowUp" && !e.shiftKey && draft === "" && history.length) {
      e.preventDefault();
      const next = histIdx < 0 ? 0 : Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setDraft(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown" && histIdx >= 0) {
      e.preventDefault();
      const next = histIdx - 1;
      if (next < 0) {
        setHistIdx(-1);
        setDraft("");
      } else {
        setHistIdx(next);
        setDraft(history[next] ?? "");
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // Global keys: palette, composer, sessions, permissions, diffs
  useEffect(() => {
    const inEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return Boolean(
        el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable),
      );
    };
    const unbind = tinykeys(window, {
      "$mod+KeyK": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
      },
      "$mod+KeyL": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setView("chat");
        setTimeout(() => composerRef.current?.focus(), 0);
      },
      "$mod+KeyN": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        newSession();
      },
      Escape: (e) => {
        if (peek) {
          e.preventDefault();
          setPeek(null);
          return;
        }
        if (paletteOpen) {
          e.preventDefault();
          setPaletteOpen(false);
        }
      },
      KeyY: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (permissions.length === 0) return;
        if (inEditable(e.target)) return;
        e.preventDefault();
        void decidePermission("allow_once");
      },
      KeyN: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (permissions.length === 0) return;
        if (inEditable(e.target)) return;
        e.preventDefault();
        void decidePermission("deny");
      },
      KeyS: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (permissions.length === 0) return;
        if (inEditable(e.target)) return;
        e.preventDefault();
        void decidePermission("allow_session");
      },
      KeyA: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (diffQueue.length === 0) return;
        if (inEditable(e.target)) return;
        const active = diffQueue.find((d) => d.id === activeDiffId) ?? diffQueue[0]!;
        e.preventDefault();
        void acceptDiff(active.id);
      },
      KeyR: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (diffQueue.length === 0) return;
        if (inEditable(e.target)) return;
        const active = diffQueue.find((d) => d.id === activeDiffId) ?? diffQueue[0]!;
        e.preventDefault();
        void rejectDiff(active.id);
      },
    });
    return () => unbind();
  }, [
    permissions,
    decidePermission,
    newSession,
    peek,
    paletteOpen,
    diffQueue,
    activeDiffId,
    oauth,
    acceptDiff,
    rejectDiff,
  ]);

  const saveSettings = async () => {
    try {
      const s = await api.settings({
        apiKey: apiKeyDraft || undefined,
        model: modelDraft,
        shellAllowlist,
      });
      applyState(s);
      setApiKeyDraft("");
      setErrorBanner(null);
      setRecovery(null);
      if (s.hasApiKey) {
        setFirstRun((fr) => patchFirstRun({ ...fr, signedIn: true }));
      }
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (state?.hasApiKey) {
      setFirstRun((fr) =>
        fr.signedIn ? fr : patchFirstRun({ ...fr, signedIn: true }),
      );
    }
  }, [state?.hasApiKey]);

  const paletteActions: PaletteAction[] = useMemo(() => {
    const acts: PaletteAction[] = [
      {
        id: "open-folder",
        label: "Open folder…",
        hint: "Native picker",
        run: () => void browseFolder(),
      },
      {
        id: "mode-chat",
        label: "Switch to Chat mode",
        run: () => void switchMode("chat"),
      },
      {
        id: "mode-code",
        label: "Switch to Code mode",
        run: () => void switchMode("code"),
      },
      {
        id: "chat",
        label: "Go to Chat view",
        run: () => setView("chat"),
      },
      {
        id: "settings",
        label: "Go to Settings",
        run: () => setView("settings"),
      },
      {
        id: "cancel",
        label: "Cancel run",
        hint: "Stop agent",
        run: () => requestCancel(),
      },
      {
        id: "retry-last",
        label: "Retry last message",
        hint: "Send the last user message again",
        run: () => {
          if (!lastUserId) return;
          const u = messages.find((m) => m.id === lastUserId);
          if (u) retryLastUser(u.id, u.content);
        },
      },
      {
        id: "regenerate",
        label: "Regenerate last reply",
        hint: "New answer for the last question",
        run: () => {
          if (!lastUserId) return;
          const u = messages.find((m) => m.id === lastUserId);
          if (u) regenerateLast(u.content);
        },
      },
      {
        id: "reconnect",
        label: "Reconnect engine",
        run: () => void retryHost(),
      },
      {
        id: "toggle-allowlist",
        label: shellAllowlist
          ? "Disable shell allowlist"
          : "Enable shell allowlist",
        run: () => {
          const next = !shellAllowlist;
          setShellAllowlist(next);
          void api.settings({ shellAllowlist: next }).then(applyState);
        },
      },
      {
        id: "new-session",
        label: "New chat session",
        run: () => newSession(),
      },
      {
        id: "focus-composer",
        label: "Focus composer",
        run: () => {
          setView("chat");
          setTimeout(() => composerRef.current?.focus(), 0);
        },
      },
      {
        id: "test-connection",
        label: "Test connection",
        run: () => {
          setView("settings");
          void api
            .testConnection()
            .then((r) =>
              setConnTest(
                r.probe.ok
                  ? `OK · ${r.authSource} · ${r.model}`
                  : `Fail · ${r.probe.detail || r.authSource}`,
              ),
            )
            .catch((e) => setConnTest(String(e)));
        },
      },
      {
        id: "export-diagnostics",
        label: "Export session diagnostics",
        hint: "Logs + transcript",
        run: () => void exportSessionDiagnostics(),
      },
      {
        id: "export-chat-md",
        label: "Export this chat as Markdown",
        hint: "Download current transcript",
        run: () => exportCurrentChat(),
      },
      {
        id: "export-sessions",
        label: "Export all sessions (JSON)",
        hint: "Backup chats + code history",
        run: () => {
          try {
            const name = downloadSessionsExport();
            toast.push(`Exported ${name}`, "success");
          } catch (e) {
            reportError(e instanceof Error ? e.message : String(e));
          }
        },
      },
      {
        id: "import-sessions",
        label: "Import sessions (JSON)",
        hint: "Merge backup into this device",
        run: () => {
          void pickImportFile().then((raw) => {
            if (!raw) return;
            const result = importSessionsJson(raw, "merge");
            if (!result.ok) {
              reportError(result.error);
              return;
            }
            refreshTree();
            setSessionList(listSessions(sessionPartition));
            toast.push(
              `Imported ${result.sessions} sessions (${result.partitions} groups)`,
              "success",
            );
          });
        },
      },
      {
        id: "open-logs",
        label: "Open logs folder",
        run: () =>
          void api
            .openLogs()
            .then((r) => setConnTest(r.path ? `Logs: ${r.path}` : "Opened logs"))
            .catch((e) => setConnTest(String(e))),
      },
      {
        id: "density",
        label:
          prefs.density === "compact"
            ? "Density: Comfortable"
            : "Density: Compact",
        run: () => {
          const next = patchPrefs({
            density: prefs.density === "compact" ? "comfortable" : "compact",
          });
          setPrefs(next);
          toast.push(`Density · ${next.density}`, "info");
        },
      },
      {
        id: "theme",
        label:
          prefs.theme === "light" ? "Theme: Voidglass (dark)" : "Theme: Light",
        run: () => {
          const next = patchPrefs({
            theme: prefs.theme === "light" ? "voidglass" : "light",
          });
          setPrefs(next);
          toast.push(
            `Theme · ${themeLabel(next.theme)}`,
            "info",
          );
        },
      },
      {
        id: "motion",
        label:
          prefs.motion === "calm" ? "Motion: Full" : "Motion: Calm",
        run: () => {
          const next = patchPrefs({
            motion: prefs.motion === "calm" ? "full" : "calm",
          });
          setPrefs(next);
          toast.push(
            `Motion · ${next.motion === "calm" ? "Calm" : "Full"}`,
            "info",
          );
        },
      },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        hint: "Ctrl+K L N · Y/N/S · A/R",
        run: () =>
          toast.push(
            "Ctrl+K palette · Ctrl+L composer · Ctrl+N new · Y/N/S perms · A/R diffs · Esc close",
            "info",
          ),
      },
      {
        id: "jump-diff",
        label: "Jump to diffs",
        hint: diffQueue.length ? `${diffQueue.length} pending` : "none",
        run: () =>
          document.getElementById("diff-panel")?.scrollIntoView({ behavior: "smooth" }),
      },
      {
        id: "jump-perm",
        label: "Jump to permission",
        run: () =>
          document.getElementById("perm-card")?.scrollIntoView({ behavior: "smooth" }),
      },
    ];
    for (const r of state?.recent ?? []) {
      acts.push({
        id: `recent-${r.path}`,
        label: `Open recent: ${r.name}`,
        hint: r.path,
        run: () => void openPath(r.path),
      });
    }
    // AC-U5 — with `owned: false` no restart/reconnect affordance renders
    // anywhere, including the command palette's own "Reconnect engine" entry.
    return engineRetryAllowed ? acts : acts.filter((a) => a.id !== "reconnect");
  }, [
    browseFolder,
    shellAllowlist,
    diffQueue.length,
    state?.recent,
    openPath,
    retryHost,
    engineRetryAllowed,
    newSession,
    exportSessionDiagnostics,
    exportCurrentChat,
    prefs.density,
    prefs.theme,
    prefs.motion,
    toast,
    switchMode,
    reportError,
    refreshTree,
    sessionPartition,
    requestCancel,
    retryLastUser,
    regenerateLast,
    lastUserId,
    messages,
  ]);

  // F7 (AC12b, AC12f; SPEC §4 flow 5, §2.8 property 3, GATE Q finding N-6) —
  // priorConversations is scoped to this shell's WHOLE conversation store
  // (the single `grokforge.sessions.v2` key, every mode and every folder
  // together), never to one mode's or one folder's slice, so the guard here
  // must be weighed at that same whole-store granularity. Checking only the
  // active partition (as before) satisfies the not-found conditions on the
  // very first open of *any* mode or folder that hasn't been used yet, even
  // while real history survives elsewhere — the false alarm behind N-6.
  // hasAnyStoredHistory() already scans every partition for this reason
  // (also used at boot === "error" / F4 time) and is reused here so both
  // directions of AC12f hold: nothing lost ⇒ no alarm, and an emptied whole
  // store ⇒ the alarm still renders in whichever mode the app opens.
  const showConversationsNotFound =
    boot === "ready" &&
    hostOk &&
    messages.length === 0 &&
    !normalizedRunVisible &&
    !hasAnyStoredHistory() &&
    state?.priorConversations === true;

  // The first-run welcome inherits the same correction: it must not welcome
  // a shell that already holds conversations elsewhere in its store just
  // because the mode/folder on screen happens to be new (AC12f — "renders
  // that surface's ordinary empty state", not the not-found copy and not
  // the welcome). Without this, fixing showConversationsNotFound above would
  // simply swap the false "not found" alarm for a false "Welcome to Forge".
  const showOnboarding =
    !showConversationsNotFound &&
    !hasAnyStoredHistory() &&
    !isOnboardingDone(firstRun, productMode) &&
    view === "chat" &&
    messages.length === 0 &&
    !normalizedRunVisible;

  if (boot === "booting") {
    // F2 — AC-U1: brand + one phase line + spinner. Never a transcript, an
    // empty state, or a blank surface. AC-U2: only the ~8s slow-start line
    // and the ~20s diagnostics reveal are time-driven; every other line
    // comes straight from the launcher's own phase (`phaseLine`).
    return (
      <BootScreen
        bootMsg={bootMsg}
        slowStart={slowStart}
        diagRevealed={diagRevealed}
        channel={channelBadge()}
        onSaveDiagnostics={() => void exportSessionDiagnostics()}
      />
    );
  }

  if (boot === "error") {
    // F3/F4 — one of the six failure cards (SPEC §5), plus the
    // conversations-are-saved line when any partition holds stored history
    // (AC-U6/AC-U7 — never a last-known value rendered as current).
    return (
      <LaunchFailureCard
        status={
          launchStatus ?? {
            ok: false,
            phase: "failed",
            owned: true,
            port: null,
            pid: null,
            reason: "unknown",
            osError: null,
            message: bootMsg,
          }
        }
        hasStoredHistory={hasAnyStoredHistory()}
        onRetry={() => void retryHost()}
        onSaveDiagnostics={() => void exportSessionDiagnostics()}
        diagnosticsStatus={exportStatus}
        buildInfo={buildInfo}
      />
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#composer-input">
        Skip to composer
      </a>
      <CommandPalette
        open={paletteOpen}
        actions={paletteActions}
        onClose={() => setPaletteOpen(false)}
      />

      {channelBadge() && (
        <div
          className={`channel-banner channel-banner-${channelBadge()?.toLowerCase()}`}
          role="status"
        >
          <strong>{channelBadge()}</strong>
          <span>
            Non-production build · host :{hostPort() ?? "?"} · data{" "}
            <code>
              ~/.grokforge{appChannel() === "dev" ? "-dev" : ""}
            </code>
            · safe beside Prod
          </span>
        </div>
      )}
      <AppTopbar
        productMode={productMode}
        modeSwitching={modeSwitching}
        onSwitchMode={(m) => void switchMode(m)}
        state={state}
        branchMap={branchMap}
        chip={chip}
        sessionWrite={sessionWrite}
        sessionShell={sessionShell}
        hostOk={hostOk}
        healthFailStreak={healthFailStreak}
        wsOk={wsOk}
        engineRetryAllowed={engineRetryAllowed}
        onRetryHost={() => void retryHost()}
        view={view}
        onToggleSettings={() => setView(view === "settings" ? "chat" : "settings")}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {!hostOk ? (
        <EngineStoppedBanner
          engineRetryAllowed={engineRetryAllowed}
          onRetry={() => void retryHost()}
        />
      ) : null}

      {errorBanner ? (
        <ErrorBanner
          message={errorBanner}
          recovery={recovery}
          engineRetryAllowed={engineRetryAllowed}
          onSignIn={() => {
            setView("settings");
            setErrorBanner(null);
          }}
          onReconnect={() => void retryHost()}
          onOpenFolder={() => void browseFolder()}
          onShowFailedTools={() => {
            setForceOpenFailedTools(true);
            setView("chat");
            setErrorBanner(null);
            setTimeout(() => setForceOpenFailedTools(false), 2500);
          }}
          onExportDiagnostics={() => void exportSessionDiagnostics()}
          onDismiss={() => {
            setErrorBanner(null);
            setRecovery(null);
          }}
        />
      ) : null}

      <div className="layout">
        <PanelGroup orientation="horizontal" className="layout-panels" defaultLayout={{ sidebar: 22, main: 78 }}>
        <Panel id="sidebar" minSize="14%" maxSize="42%" className="sidebar-panel">
        <div className="sidebar-stack" data-mode={productMode}>
          <Sidebar
            mode={productMode}
            chatSessions={chatSessions}
            chatRootLabel={chatRootLabel}
            showChatFiles={prefs.showChatFiles}
            showSubagents={prefs.showSubagents}
            onNewChat={() => newSession(sessionPartition)}
            onSelectChat={(id) => void switchSession(sessionPartition, id)}
            onRenameChat={(id, title) =>
              renameSession(sessionPartition, id, title)
            }
            onDeleteChat={(id) => removeSession(sessionPartition, id)}
            onBindChatFolder={() => void bindChatFolder()}
            onClearChatFolder={() => void clearChatFolder()}
            workspaces={treeWorkspaces}
            activeWorkspace={state?.workspace ?? null}
            activeSessionId={sessionId}
            onOpenFolder={() => void browseFolder()}
            onToggleFolder={(path) => {
              toggleExpanded(path);
              refreshTree();
            }}
            onSelectWorkspace={(path) => void openPath(path)}
            onSelectCodeSession={(ws, sid) => void switchSession(ws, sid)}
            onNewCodeSession={(ws) => newSession(ws)}
            onRenameCodeSession={renameSession}
            onDeleteCodeSession={removeSession}
            pathInput={pathInput}
            onPathInputChange={setPathInput}
            onPathOpen={() => void openPath(pathInput)}
            viewTab={view === "settings" ? "settings" : "messages"}
            onViewTab={(t) => setView(t === "settings" ? "settings" : "chat")}
          />
        </div>
        </Panel>
        <PanelResizeHandle className="layout-resize" aria-label="Resize sidebar" />
        <Panel id="main" minSize="40%" className="main-panel">

        <main className="main">
          {view === "settings" ? (
            <div className="panel-settings">
              <div className="settings">
                <h1>Settings</h1>
                <p className="lead">
                  Forge · sign in with Grok (flagship agent) or API key backup.
                  Ctrl+K for commands.
                </p>
                <div className="callout">
                  {tauri
                    ? "Desktop Forge — the engine starts automatically."
                    : "Browser UI — prefer npm run desktop for the native window."}
                  <br />
                  Version: <code>{buildInfo?.version || "—"}</code>
                  {buildInfo?.channelLabel ? ` (${buildInfo.channelLabel})` : ""}
                  <br />
                  Logs:{" "}
                  <code>{state?.logHint || "%USERPROFILE%\\.grokforge\\logs"}</code>
                </div>
                {(() => {
                  const policy = (state as PublicState & { permissionPolicy?: { effectiveMode?: string; fallbackReason?: string | null; status?: string } })?.permissionPolicy;
                  const bypass = (state as PublicState & { bypassPermissions?: { unlocked?: boolean; available?: boolean; activeForSession?: boolean; blockedReason?: string | null } })?.bypassPermissions;
                  return <>
                    <PermissionPolicyControl
                      status={!state ? "loading" : !state.workspace ? "no_workspace" : policy?.status === "confirmed" ? "confirmed" : hostOk ? "unconfirmed" : "offline"}
                      confirmedMode={policy?.effectiveMode === "trusted_workspace" ? "trusted_workspace" : policy?.effectiveMode === "review" ? "review" : null}
                      fallbackReason={policy?.fallbackReason}
                      disabled={Boolean(runStartedAt)}
                      onSave={async (mode) => {
                        const latest = stateRef.current;
                        if (!sessionId || !latest?.workspace) throw new Error("No session or workspace");
                        const result = await api.saveWorkspacePolicy({ sessionId, workspace: latest.workspace, mode });
                        applyState({ ...latest, permissionPolicy: result.policy as PublicState["permissionPolicy"] });
                      }}
                    />
                    <TrustedCommandClassesControl
                      key={state?.workspace ?? "no-workspace"}
                      status={
                        !state?.workspace
                          ? "no_workspace"
                          : !hostOk
                            ? "offline"
                            : classesStatus
                      }
                      policyMode={
                        policy?.effectiveMode === "trusted_workspace"
                          ? "trusted_workspace"
                          : policy?.effectiveMode === "review"
                            ? "review"
                            : null
                      }
                      confirmed={classesView ?? {
                        classes: [],
                        revision: "fallback",
                        source: "fallback",
                        fallbackReason: "missing",
                        savedForWorkspace: false,
                        catalog: [],
                      }}
                      onSave={async (classes, expectedRevision) => {
                        if (!sessionId || !state?.workspace) throw new Error("No session or workspace");
                        try {
                          const result = await api.saveTrustedCommandClasses({
                            sessionId,
                            workspace: state.workspace,
                            classes,
                            expectedRevision,
                          });
                          setClassesView(result.classes);
                          toast.push("Trusted command classes saved.", "success");
                        } catch (e) {
                          if (e instanceof ApiError && e.code === "class_revision_conflict") {
                            try {
                              const fresh = await api.trustedCommandClasses(state.workspace);
                              setClassesView(fresh.classes);
                            } catch {
                              /* keep last confirmed */
                            }
                          }
                          const code = e instanceof ApiError ? e.code : "class_save_failed";
                          throw Object.assign(e instanceof Error ? e : new Error("save failed"), { code });
                        }
                      }}
                    />
                    {sessionId && <BypassPermissionsControl
                      sessionId={sessionId}
                      unlocked={Boolean(bypass?.unlocked)}
                      available={Boolean(bypass?.available)}
                      active={Boolean(bypass?.activeForSession)}
                      blockedReason={bypass?.blockedReason}
                      onActiveChange={(active) => {
                        if (!state || !bypass) return;
                        applyState({ ...state, bypassPermissions: { ...bypass, activeForSession: active } });
                      }}
                    />}
                  </>;
                })()}
                <div className="row" style={{ marginBottom: 16 }}>
                  <Button variant="primary" onClick={startGrokSignIn}>
                    Sign in with Grok
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api
                        .oauthLogout()
                        .then(applyState)
                        .catch((e) => reportError(String(e), { source: "oauth" }))
                    }
                  >
                    Sign out
                  </Button>
                  {engineRetryAllowed && (
                    <Button onClick={() => void restartDesktopHost().then(() => bootApp())}>
                      Restart engine
                    </Button>
                  )}
                </div>
                {oauth && (
                  <div className="oauth-box">
                    <h3>Complete sign-in</h3>
                    <p>
                      Open{" "}
                      <a
                        href={oauth.verification_uri_complete || oauth.verification_uri}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {oauth.verification_uri}
                      </a>
                    </p>
                    <p className="user-code">{oauth.user_code}</p>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void api.oauthCancel();
                        setOauth(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                <div className="field">
                  <label>Auth priority</label>
                  <p className="hint" style={{ marginTop: 4 }}>
                    1) SuperGrok / subscription pool · 2) API key backup ·{" "}
                    Active:{" "}
                    <strong>
                      {state?.authSource || "none"}
                      {state?.authMode ? ` (${state.authMode})` : ""}
                    </strong>
                  </p>
                </div>

                <ConnectorsPanel
                  onOpenChat={() => setView("chat")}
                  onUseSample={(text) => {
                    setDraft(text);
                    setView("chat");
                    setTimeout(() => composerRef.current?.focus(), 0);
                  }}
                />
                <div className="field">
                  <label htmlFor="apiKey">xAI API key (backup only)</label>
                  <input
                    id="apiKey"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      state?.authSource === "config"
                        ? "•••• saved — paste to replace"
                        : "Optional if signed in with Grok"
                    }
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="agentId">ACP agent backend</label>
                  <select
                    id="agentId"
                    value={state?.agentId || "grok-acp"}
                    onChange={(e) => {
                      void api
                        .settings({ agentId: e.target.value })
                        .then(applyState)
                        .catch((err) =>
                          reportError(
                            err instanceof Error ? err.message : String(err),
                          ),
                        );
                    }}
                  >
                    <option value="grok-acp">
                      Grok (xAI) — ready
                    </option>
                    <option value="codex-acp" disabled>
                      Codex (OpenAI) — planned
                    </option>
                    <option value="claude-acp" disabled>
                      Claude (Anthropic) — planned
                    </option>
                  </select>
                  <p className="hint" style={{ marginTop: 4 }}>
                    Provider-agnostic shell · only Grok ships today.{" "}
                    {state?.agentName
                      ? `Active: ${state.agentName}.`
                      : null}
                  </p>
                </div>
                <TextField
                  id="model"
                  label="Model"
                  value={modelDraft}
                  onChange={setModelDraft}
                  list="model-presets"
                />
                <datalist id="model-presets">
                  {MODEL_PRESETS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <div className="model-presets row">
                  {MODEL_PRESETS.map((m) => (
                    <Button
                      key={m}
                      variant="ghost"
                      className={modelDraft === m ? "active-toggle" : ""}
                      onClick={() => setModelDraft(m)}
                    >
                      {m}
                    </Button>
                  ))}
                </div>
                <Switch
                  isSelected={shellAllowlist}
                  onChange={setShellAllowlist}
                >
                  Enforce shell allowlist (npm, git, node, …)
                </Switch>
                {connTest && (
                  <div className="conn-test" role="status">
                    Connection: {connTest}
                  </div>
                )}
                {exportStatus && (
                  <div className="conn-test" role="status">
                    Export: {exportStatus}
                  </div>
                )}
                <div className="field">
                  <span>Appearance</span>
                  <div className="row">
                    <Button
                      onClick={() => {
                        const next = patchPrefs({
                          theme: prefs.theme === "light" ? "voidglass" : "light",
                        });
                        setPrefs(next);
                      }}
                    >
                      Theme: {themeLabel(prefs.theme)}
                    </Button>
                    <Button
                      onClick={() => {
                        const next = patchPrefs({
                          density:
                            prefs.density === "compact"
                              ? "comfortable"
                              : "compact",
                        });
                        setPrefs(next);
                      }}
                    >
                      Density: {prefs.density}
                    </Button>
                    <Hint label="Reduce field motion and brand animations">
                      <Button
                        onClick={() => {
                          const next = patchPrefs({
                            motion: prefs.motion === "calm" ? "full" : "calm",
                          });
                          setPrefs(next);
                        }}
                      >
                        Motion: {prefs.motion === "calm" ? "Calm" : "Full"}
                      </Button>
                    </Hint>
                  </div>
                  <label className="check-row" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={prefs.showChatFiles}
                      onChange={(e) =>
                        setPrefs(
                          patchPrefs({ showChatFiles: e.target.checked }),
                        )
                      }
                    />
                    Chat sidebar: show local files panel
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={prefs.showSubagents}
                      onChange={(e) =>
                        setPrefs(
                          patchPrefs({ showSubagents: e.target.checked }),
                        )
                      }
                    />
                    Code sidebar: show nested subagents
                  </label>
                </div>
                <div className="field">
                  <span>Shortcuts</span>
                  <p className="settings-hint">
                    <kbd>Ctrl+K</kbd> palette · <kbd>Ctrl+L</kbd> composer ·{" "}
                    <kbd>Ctrl+N</kbd> new chat · <kbd>Y/N/S</kbd> permissions ·{" "}
                    <kbd>A/R</kbd> diffs · <kbd>Enter</kbd> send ·{" "}
                    <kbd>Shift+Enter</kbd> newline
                  </p>
                </div>
                <div className="field">
                  <span>App updates</span>
                  <p className="settings-hint">
                    Ctrl+Alt+F summons Forge. Updates check GitHub releases.
                  </p>
                  <div className="row">
                    <Button
                      variant="ghost"
                      disabled={updateStatus.kind === "checking"}
                      onClick={() => {
                        setUpdateStatus({ kind: "checking" });
                        void checkForAppUpdate().then(setUpdateStatus);
                      }}
                    >
                      <Icon icon={RefreshCw} size={15} />
                      Check for updates
                    </Button>
                    {updateStatus.kind === "available" ? (
                      <Button
                        variant="primary"
                        onClick={() => void installAppUpdate().then(setUpdateStatus)}
                      >
                        Install {updateStatus.version}
                      </Button>
                    ) : null}
                  </div>
                  {updateStatus.kind === "checking" ? (
                    <p className="settings-hint">Checking…</p>
                  ) : null}
                  {updateStatus.kind === "none" ? (
                    <p className="settings-hint">No update available.</p>
                  ) : null}
                  {updateStatus.kind === "error" ? (
                    <p className="settings-hint" role="status">{updateStatus.message}</p>
                  ) : null}
                </div>
                <div className="row">
                  <Button variant="primary" onClick={() => void saveSettings()}>
                    Save
                  </Button>
                  <Button
                    onClick={() =>
                      void api
                        .testConnection()
                        .then((r) =>
                          setConnTest(
                            r.probe.ok
                              ? `OK · ${r.authSource} · model ${r.model}`
                              : `Fail · ${r.probe.detail || "no credential"}`,
                          ),
                        )
                        .catch((e) => setConnTest(String(e)))
                    }
                  >
                    Test connection
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api
                        .openLogs()
                        .then((r) =>
                          setConnTest(r.path ? `Logs: ${r.path}` : "Opened logs"),
                        )
                        .catch((e) => setConnTest(String(e)))
                    }
                  >
                    Open logs folder
                  </Button>
                  <Button variant="primary" onClick={() => void exportSessionDiagnostics()}>
                    Export diagnostics
                  </Button>
                  <Button
                    onClick={() => {
                      try {
                        toast.push(
                          `Exported ${downloadSessionsExport()}`,
                          "success",
                        );
                      } catch (e) {
                        reportError(
                          e instanceof Error ? e.message : String(e),
                        );
                      }
                    }}
                  >
                    Export sessions
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void pickImportFile().then((raw) => {
                        if (!raw) return;
                        const result = importSessionsJson(raw, "merge");
                        if (!result.ok) {
                          reportError(result.error);
                          return;
                        }
                        refreshTree();
                        setSessionList(listSessions(sessionPartition));
                        toast.push(
                          `Imported ${result.sessions} sessions`,
                          "success",
                        );
                      });
                    }}
                  >
                    Import sessions
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api.settings({ clearKey: true }).then(applyState)
                    }
                  >
                    Clear saved key
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel-chat">
              {prefs.density !== "compact" && (
                <OverviewStrip
                  overview={overview}
                  workspaceName={
                    productMode === "chat" ? chatRootLabel : (state?.workspaceName ?? null)
                  }
                  mode={productMode}
                  shellCapability={state?.shellCapability}
                />
              )}
              <RunStatusBar
                busy={busy || Boolean(runStartedAt)}
                phase={runPhase}
                phaseDetail={livePlanning ? PLAN_LIVE_STATUS : runPhaseDetail}
                runStartedAt={runStartedAt}
                effortLabel={
                  effortLevel !== "auto" ? `Effort: ${effortLevel}` : null
                }
                modelLabel={state?.appliedModel || state?.model || null}
                permissionPending={permissions.length > 0}
                diffCount={diffQueue.length}
                planning={livePlanning}
                onJumpPermission={() =>
                  document
                    .getElementById("perm-card")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                onJumpDiff={() =>
                  document
                    .getElementById("diff-panel")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                onCancel={requestCancel}
              />
              {productMode === "chat" ? (
                <ChatHomeName
                  mode={productMode}
                  committedName={activeHome?.committedName === true}
                  title={activeHome?.title ?? ""}
                  saveFailed={homeNameSaveFailed}
                  onCommit={(title) => {
                    if (!sessionId) return;
                    setHomeNameDraft(title);
                    renameSession(sessionPartition, sessionId, title);
                  }}
                  onRetry={() => {
                    if (!sessionId) return;
                    renameSession(
                      sessionPartition,
                      sessionId,
                      homeNameDraft || activeHome?.title || "",
                    );
                  }}
                />
              ) : null}
              {(openingWs || runFooter || livePlanning) && (
                <div className="run-footer" role="status">
                  {openingWs ? "Opening workspace…" : livePlanning ? PLAN_LIVE_FOOTER : runFooter}
                </div>
              )}

              <div className="transcript" tabIndex={-1} ref={transcriptRef}>
                {showConversationsNotFound ? (
                  <EmptyStates
                    kind="conversations-not-found"
                    onSaveDiagnostics={() => void exportSessionDiagnostics()}
                    onStartNewConversation={() => newSession()}
                  />
                ) : showOnboarding ? (
                  <Onboarding
                    firstRun={firstRun}
                    hasWorkspace={Boolean(state?.workspace)}
                    signedIn={Boolean(state?.hasApiKey)}
                    mode={productMode}
                    onOpenFolder={() => void browseFolder()}
                    onOpenSettings={() => setView("settings")}
                    onSetMode={(m) => {
                      setFirstRun((fr) =>
                        patchFirstRun({ ...fr, pickedMode: true }),
                      );
                      void switchMode(m);
                    }}
                    onDismiss={() =>
                      setFirstRun((fr) => patchFirstRun({ ...fr, dismissed: true }))
                    }
                  />
                ) : messages.length === 0 && !normalizedRunVisible && hostOk ? (
                  <EmptyStates
                    kind={
                      !state?.hasApiKey
                        ? "signed-out"
                        : productMode === "code" && !state?.workspace
                          ? "no-workspace"
                          : "ready"
                    }
                    productMode={productMode}
                    onOpenFolder={() => void browseFolder()}
                    onSettings={() => setView("settings")}
                    onSignIn={startGrokSignIn}
                    onSamplePrompt={(text) => {
                      setDraft(text);
                      setTimeout(() => composerRef.current?.focus(), 0);
                    }}
                  />
                ) : messages.length === 0 && !normalizedRunVisible && !hostOk ? (
                  <EmptyStates
                    kind="host-offline"
                    onReconnect={
                      engineRetryAllowed ? () => void retryHost() : undefined
                    }
                  />
                ) : (
                  <>
                    {runProjection.runOrder.map((id) => {
                      const run = runProjection.runsById[id];
                      return run && run.sessionId === sessionId ? <RunSurface key={id} run={run} catchUp={catchUpForRun(catchUpByRunId, run.runId)} offline={!hostOk} productMode={productMode} onRetryPrompt={(prompt) => void sendText(prompt)} onReconnect={() => void retryHost()} onOpenSettings={() => setView("settings")} onExportDiagnostics={() => void exportSessionDiagnostics()} onFocusDiffRequest={setActiveDiffId} onChoose={(label, meta) => {
                        const line = meta
                          ? `I choose: ${label}\n\n${meta}`
                          : `I choose: ${label}`;
                        setDraft((d) =>
                          d.trim() ? `${d.trim()}\n\n${line}` : line,
                        );
                        toast.push(`Added “${label}” to composer`, "info");
                        setTimeout(() => composerRef.current?.focus(), 0);
                      }} /> : null;
                    })}
                    {!hostOk && (
                      <div className="transcript-offline" role="status">
                        <strong>{activeRun ? "Offline" : "Forge's engine stopped."}</strong> {activeRun ? "Forge is offline. Your prompt and received output are preserved. Reconnect to confirm this run’s outcome." : "Your conversation is saved."}
                        {engineRetryAllowed ? " Forge is trying to reconnect." : ""}
                        {engineRetryAllowed && (
                          <Button variant="primary" onClick={() => void retryHost()}>
                            Try again
                          </Button>
                        )}
                      </div>
                    )}
                    <MessageList
                      messages={visibleMessages}
                      scrollRef={transcriptRef}
                      busy={normalizedRunVisible ? false : busy || Boolean(runStartedAt)}
                      thinkingDetail={runPhaseDetail}
                      showTurnDelimiter={turnReady}
                      lastUserId={lastUserId}
                      lastAssistantId={lastAssistantId}
                      onRetryUser={retryLastUser}
                      onRegenerate={regenerateLast}
                      onChoose={(label, meta) => {
                        const line = meta
                          ? `I choose: ${label}\n\n${meta}`
                          : `I choose: ${label}`;
                        setDraft((d) =>
                          d.trim() ? `${d.trim()}\n\n${line}` : line,
                        );
                        toast.push(`Added “${label}” to composer`, "info");
                        setTimeout(() => composerRef.current?.focus(), 0);
                      }}
                      onOpenPath={(p) => void openToolPath(p)}
                      forceOpenFailedTools={forceOpenFailedTools}
                    />
                  </>
                )}
                <div ref={bottomRef} />
              </div>

              <ActionDock
                permissions={permissions}
                diffQueue={diffQueue}
                activeDiffId={activeDiffId}
                onActiveDiffId={setActiveDiffId}
                oauth={oauth}
                onPermission={(d) => void decidePermission(d)}
                onTrustFolder={
                  permissions[0]?.kind === "write" && state?.workspace
                    ? () => void trustFolder()
                    : undefined
                }
                onAccept={(id) => void acceptDiff(id)}
                onReject={(id) => void rejectDiff(id)}
                onAcceptAll={() => void acceptAllDiffs()}
                onRejectAll={() => void rejectAllDiffs()}
                onOauthCancel={() => {
                  void api.oauthCancel();
                  setOauth(null);
                }}
                planDecision={
                  pendingPlanDecision
                    ? {
                        empty: pendingPlanDecision.empty,
                        settling: planSettling,
                        error: planDecisionError,
                      }
                    : null
                }
                onPlanAccept={() => void settlePlan("accept")}
                onPlanKeepPlanning={() => void settlePlan("keep_planning")}
              />

              <ComposerPane
                dragOver={dragOver}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length) {
                    void attachFilesToComposer(files);
                    return;
                  }
                  const text = e.dataTransfer.getData("text/plain")?.trim();
                  if (text) {
                    setDraft((d) =>
                      `${d}${d && !d.endsWith("\n") ? "\n\n" : ""}${text}`,
                    );
                  }
                  composerRef.current?.focus();
                }}
                atSuggestions={atSuggestions}
                onInsertAt={insertAtFile}
                onPinToPack={(file) => void mutateChatPack({ action: "pin_file", path: file })}
                composerRef={composerRef}
                draft={draft}
                onDraftChange={onComposerChange}
                onComposerKeyDown={onComposerKeyDown}
                sendDisabledReason={sendDisabledReason}
                lockedReason={
                  oauth ||
                  permissions.length > 0 ||
                  diffQueue.length > 0 ||
                  pendingPlanDecision ||
                  sessionHasDockOwnedPending
                    ? SETTLE_CARD_BELOW
                    : null
                }
                productMode={productMode}
                connected={connected}
                densityCompact={prefs.density === "compact"}
                onAttachFiles={(files) => void attachFilesToComposer(files)}
                busy={busy}
                hasMessages={messages.length > 0}
                onExportChat={exportCurrentChat}
                onCancel={requestCancel}
                onSend={() => void send()}
                footer={
                  <>
                {packInventoryVisible ? (
                  <ChatPackInventory
                    projection={chatPackComposer}
                    members={armedPackMembers}
                    mutationInFlight={packMutationInFlight}
                    workspaceFiles={fileIndex}
                    onPin={(path) => void mutateChatPack({ action: "pin_file", path })}
                    onUnpin={(path) => void mutateChatPack({ action: "unpin_file", path })}
                    onSaveNote={(note) => void mutateChatPack({ action: "set_note", note })}
                    onClearNote={() => void mutateChatPack({ action: "clear_note" })}
                    onClearPack={() => void mutateChatPack({ action: "clear_pack" })}
                  />
                ) : null}
                <div className="composer-footer">
                  <EffortControl
                    value={effortLevel}
                    applied={state?.appliedEffort}
                    onChange={(e) => void setEffortUi(e)}
                    disabled={!connected}
                  />
                  {productMode === "code" ? (
                    <PlanArmControl
                      projection={planArm}
                      onToggle={(engaged) => void setPlanEngagementUi(engaged)}
                      onRetry={() => void setPlanEngagementUi(true)}
                    />
                  ) : null}
                  {chatPackComposer.state !== "absent_code" ? (
                    <ChatPackStatus
                      projection={chatPackComposer}
                      inventoryOpen={packInventoryOpen}
                      onToggleInventory={() => setPackInventoryOpen((open) => !open)}
                    />
                  ) : null}
                  {projectInstructionsComposer.state !== "absent_chat" ? (
                    <ProjectInstructionsStatus projection={projectInstructionsComposer} />
                  ) : null}
                  <span className="composer-meta">
                    {productMode === "chat"
                      ? "Chat"
                      : state?.workspaceName || "no project"}
                    {" · "}
                    {state?.appliedModel || state?.model || modelDraft}
                    {state?.authSource ? ` · ${state.authSource}` : ""}
                  </span>
                  {state?.permissionPolicy?.status === "confirmed" && (
                    <span className="composer-policy" aria-label="Effective permission policy">
                      Policy: {state.permissionPolicy.effectiveMode === "trusted_workspace" ? "Trusted workspace" : "Review"}
                    </span>
                  )}
                  <span className="composer-hint">
                    Attach text · Export .md · Enter send · Ctrl+K
                  </span>
                </div>
                {state?.permissionPolicy?.fallbackReason && (
                  <div className="composer-policy-notice" role="status">
                    Forge couldn’t use the saved permission policy. Review is active.
                  </div>
                )}
                {sendDisabledReason && draft.trim() ? (
                  <div className="composer-block-reason" role="status">
                    {sendDisabledReason}
                  </div>
                ) : null}
                {(busy || runStartedAt || livePlanning) && (
                  <div className="composer-thinking" role="status">
                    <span className="run-dot" />
                    {livePlanning
                      ? `${PLAN_LIVE_STATUS} · ${PLAN_LIVE_FOOTER}`
                      : runPhaseDetail ||
                        (runPhase === "reasoning"
                          ? "Thinking aloud…"
                          : runPhase === "tools"
                            ? "Using tools…"
                            : runPhase === "writing"
                              ? "Writing answer…"
                              : "Grok is working — see status bar above. Cancel if stuck.")}
                  </div>
                )}
                  </>
                }
              />
            </div>
          )}
        </main>
        </Panel>
        </PanelGroup>
      </div>

      <OverlayDialog
        isOpen={Boolean(peek)}
        onClose={() => setPeek(null)}
        title="Path peek"
        overlayClassName="modal-overlay"
        modalClassName="modal peek-modal"
      >
        {peek ? (
          <>
            <div className="peek-head">
              <strong title={peek.path}>{peek.path}</strong>
              <Button variant="ghost" onClick={() => setPeek(null)}>
                Close
              </Button>
            </div>
            <pre className="peek-body">{peek.content}</pre>
          </>
        ) : null}
      </OverlayDialog>
    </div>
  );
}
