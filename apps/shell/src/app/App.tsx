import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  isTauri,
  localBuildIdentity,
  mergeState,
  pickFolderNative,
  ApiError,
  type DesktopHostStatus,
  type EffortLevel,
  type ProductMode,
  type PublicState,
  type TrustedCommandClassesView,
} from "../lib/api";
import { INITIAL_PHASE_LINE } from "../projections/launchState";
import { LaunchFailureCard } from "../surfaces/LaunchFailureCard";
import { BootScreen } from "../surfaces/BootScreen";
import { AppTopbar } from "../chrome/AppTopbar";
import { EngineStoppedBanner, ErrorBanner } from "../chrome/AppBanners";
import {
  EMPTY_DRAFT_SEND,
  draftIsSendReady,
} from "../composer/ComposerPane";
import { composerChromeBusy, endPageSend, queueAdmitted } from "../composer/composerSend";
import { activityIsVendorSessionPlan, activityLooksLikeWrite } from "../projections/activityWriteLike";
import { atFileSuggestions } from "../composer/atFileQuery";
import { recentCrashes } from "../lib/crashSink";

import { EffortControl } from "../composer/EffortControl";
import { ContextRing } from "../composer/ContextRing";
import { PlanArmControl } from "../composer/PlanArmControl";
import {
  PLAN_ARM_BLOCKED_UNVOUCHED,
  planArmFailureCopy,
} from "../projections/planArm";
import { projectProjectInstructionsComposer } from "../projections/projectInstructionsComposer";
import { ProjectInstructionsStatus } from "../sections/ProjectInstructionsStatus";
import { projectChatPackComposer } from "../projections/chatPackComposer";
import { ChatPackStatus } from "../sections/ChatPackStatus";
import { CODE_AGENT_HARD_FAIL, projectCodeAgentComposer } from "../projections/codeAgentComposer";
import { CodeAgentStatus } from "../sections/CodeAgentStatus";
import { slashTokenFilter } from "../projections/skillsCatalogComposer";
import {
  isOnboardingDone,
  loadFirstRun,
  patchFirstRun,
  type FirstRunState,
} from "../lib/firstRun";
import { CommandPalette, type PaletteAction, type PaletteSessionRow } from "../composer/CommandPalette";
import { Button } from "../ui/Button";
import { OverlayDialog } from "../ui/Dialog";
import { useChromeStore } from "../state/chromeStore";
import { useSessionFlagsStore } from "../state/sessionFlagsStore";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { tinykeys } from "tinykeys";
import { checkForAppUpdate, type UpdateStatus } from "../lib/desktopUpdate";
import { registerSummonShortcut } from "../lib/desktopNotify";
import { planLiveActivityReveal, SETTLE_CARD_BELOW } from "../lib/copyDock";
import type { ChatMessage } from "../surfaces/MessageList";
import { ChangesDock } from "../dock/ChangesDock";
import { ReviewSurface } from "../surfaces/ReviewSurface";
import { SettingsView } from "../surfaces/SettingsView";
import { ChatView } from "../surfaces/ChatView";
import { inEditable, dockOwnsFocus } from "../lib/inEditable";

/** Legacy per-run phase label — superseded by derivedLivePhase's phaseCopy for
 *  display, but still threaded through several socket-event handlers below. */
type RunPhase = "waiting_model" | "reasoning" | "tools" | "writing" | "done" | null;
import { loadPromptHistory } from "../composer/promptHistory";
import {
  RETRY_PROMPT_SEND_OPTS,
  stopChipBelongsOnTranscript,
} from "../composer/promptSendHistory";
import {
  chatListTitle,
  clearPackMembers,
  clearSessionNeedsYouEverywhere,
  commitHomeName,
  createSession,
  defaultSessionTitle,
  deleteSession,
  ensureActiveSession,
  flushSessions,
  hasAnyStoredHistory,
  isChatPartition,
  listPinnedWorkspaces,
  listSessions,
  loadSession,
  onSessionSaveError,
  partitionKey,
  saveSessionMessages,
  setActiveSession,
  setExpanded,
  setSessionBranch,
  setSessionNeedsYou,
  toggleExpanded,
  updatePackMembers,
  updateSessionMeta,
  type ChatSession,
} from "../lib/sessions";
import { FrameFlush } from "../thread/streamBuffer";
import { computeOverview } from "../surfaces/OverviewStrip";
import { Sidebar } from "../chrome/Sidebar";
import {
  buildSessionMarkdown,
  downloadDiagnostics,
  suggestDiagnosticsFilename,
} from "../lib/exportDiagnostics";
import {
  downloadSessionsExport,
  importSessionsJson,
  pickImportFile,
} from "../lib/sessionIO";

import {
  appChannel,
  channelBadge,
  hostPort,
  INHERITED_DEFAULT_MODEL,
} from "../lib/api";
import { loadPrefs, patchPrefs, themeLabel, type Prefs } from "../lib/prefs";
import { useToast } from "../thread/Toast";
import { readFilesForAttach } from "../composer/contextAttach";
import { scheduleExtractingCue } from "../composer/attachBusy";
import {
  downloadMarkdown,
  mergeLiveRunsForExport,
  suggestChatFilename,
  transcriptToMarkdown,
} from "../lib/exportChat";
import { initialRunProjection, mergeRunSnapshot, persistableRunProjection, reduceRunEvents, restoreRunProjection, type RunProjection } from "../projections/runReducer";
import {
  observeRosterFingerprint,
  ownedRunKeysFromProjection,
} from "../projections/activityMembership";
import { deriveLivePhase, deriveLivePhaseFromRun, phaseCopy } from "../projections/derivedLivePhase";
import {
  hasDockOwnedPending,
  railEvidenceFromRun,
  type PendingDiff,
  type PermissionReq,
} from "../projections/runChangeList";
import { useArtifactBinding } from "./useArtifactBinding";
// retryLastUser/regenerateLast (below, outside useArtifactBinding) clear the
// binding inline the same way closeArtifact does internally — kept as a
// direct import since those two call sites are not part of Task 7's move.
import { clearArtifactBinding } from "../projections/artifactOpenBinding";
import { useSkillsPalette } from "./useSkillsPalette";
import { useHomeScreenData } from "./useHomeScreenData";
import { useChangesProjections } from "./useChangesProjections";
import { useDecisions } from "./useDecisions";
import { useComposerSend } from "./useComposerSend";
import { useRunEventStream } from "./useRunEventStream";
import { useEngineHealth } from "./useEngineHealth";
import { PolicyControls } from "../composer/PolicyControls";
import { PolicyChip, POLICY_SENTENCE, effectivePolicyKind } from "../composer/PolicyChip";
import type { TrustedCommandClassesStatus } from "../composer/TrustedCommandClassesControl";

type View = "chat" | "settings" | "review";
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
  // slowStart/diagRevealed/the two boot timers/recoveryAttemptsRef/
  // TERMINAL_ATTEMPTS/healthFailStreak(+ref) all moved fully into
  // useEngineHealth (Task 14) — no consumer outside bootApp/retryHost/the
  // socket-connect effect/the health-poll effect, all moved with them.
  // boot/bootMsg/launchStatus (above) stay here regardless: this hook's own
  // back-references (below) need onServerEvent/restoreOwnedRuns/
  // markDisconnectedActivity/reconcileOwnedRuns from useRunEventStream's
  // return, so its earliest legal call site is well after
  // exportSessionDiagnostics's own, earlier, already-declared read of all
  // three — see task-14-report.md Step 1.
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
  // buildInfo moved fully into useEngineHealth (Task 14) — no consumer
  // outside refreshBuildInfo/the health-poll effect, both moved with it.
  const [hostOk, setHostOk] = useState(false);
  // wsOk moved fully into useEngineHealth (Task 14) — its only consumer,
  // the socket-connect effect, moved with it. hostOk stays: refreshBranches
  // (below) reads it in its own dependency array at a position well before
  // useEngineHealth's earliest legal call site — see task-14-report.md
  // Step 1.
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
  // reconcileRunsInFlightRef and catchUpByRunId's own useState moved fully
  // into useRunEventStream (Task 13) — neither has any consumer outside
  // reconcileOwnedRuns/restoreOwnedRunJournal, both moved with them.
  // catchUpByRunId is still read here (a ChatView JSX prop and
  // useChangesProjections's own input) via the hook's return, below.
  // socketRef/onServerEventRef moved fully into useEngineHealth (Task 14).
  // socketRef is returned from there (the "reconnect/replay" effect below
  // reads socketRef.current directly); onServerEventRef's only reader is
  // the socket-connect effect, moved with it.
  const [draft, setDraft] = useState("");
  // queuedDraft/setQueuedDraft (Queue ⇧⏎) moved fully into useComposerSend
  // (Task 12) — its own useState now lives there; App.tsx only threads
  // `draft`/`setDraft` through (useSkillsPalette, called earlier, already
  // needs the real setDraft — see the comment on that call below — and
  // useComposerSend's own call site is later still, so draft's useState
  // cannot move without breaking useSkillsPalette). See task-12-report.md
  // Step 1.
  const [pathInput, setPathInput] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState<string>(INHERITED_DEFAULT_MODEL);
  const [shellAllowlist, setShellAllowlist] = useState(true);
  // permissions/diffQueue/oauth stay here (not moved into useDecisions,
  // despite Task 11's brief) — the "rAF-throttle scroll-to-bottom" effect
  // below reads all three in its own dependency array at this early
  // position, well before any legal call site for that hook. See
  // task-11-report.md Step 1. permissionInFlightRef/recoveryInFlightRef/
  // planSettling moved fully into useDecisions — nothing outside
  // decidePermission/recoverFromDock/settlePlan ever touched them.
  const [permissions, setPermissions] = useState<PermissionReq[]>([]);
  const [diffQueue, setDiffQueue] = useState<PendingDiff[]>([]);
  const [planArmError, setPlanArmError] = useState<string | null>(null);
  const [planDecisionError, setPlanDecisionError] = useState<string | null>(null);
  // changeRecoveryFlash/changeRevertPendingEditId moved into useChangesProjections
  // (Task 10) — nothing outside recoverChangeMember ever wrote to them; the
  // hook now owns and returns both.
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
  const [notFoundDismissed, setNotFoundDismissed] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const paletteOpen = useChromeStore((s) => s.paletteOpen);
  const setPaletteOpen = useChromeStore((s) => s.setPaletteOpen);
  const paletteMode = useChromeStore((s) => s.paletteMode);
  const paletteQuery = useChromeStore((s) => s.paletteQuery);
  const openPalette = useChromeStore((s) => s.openPalette);
  const peek = useChromeStore((s) => s.peek);
  const setPeek = useChromeStore((s) => s.setPeek);
  const dragOver = useChromeStore((s) => s.dragOver);
  const setDragOver = useChromeStore((s) => s.setDragOver);
  const changesOpen = useChromeStore((s) => s.changesOpen);
  const setChangesOpen = useChromeStore((s) => s.setChangesOpen);
  const toast = useToast();
  const setSessionWrite = useSessionFlagsStore((s) => s.setSessionWrite);
  const setSessionShell = useSessionFlagsStore((s) => s.setSessionShell);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [history, setHistory] = useState<string[]>(() => loadPromptHistory());
  const [histIdx, setHistIdx] = useState(-1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Mirror in an effect, not during render: a render can be discarded under
  // concurrent rendering, which would leave this ref set from work that
  // never committed. Matches stateRef/messagesRef below (Task 2).
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const observeRosterKeyRef = useRef("");
  const [observeHostOwnerSessionId, setObserveHostOwnerSessionId] = useState<string | null>(null);
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
  // Legacy per-run phase — still written by socket-event handlers below, but no
  // longer read anywhere: RunStatusBar (its one reader) is gone, and
  // ThreadHeader's live status uses derivedLivePhase's phaseCopy instead.
  const [, setRunPhase] = useState<RunPhase>(null);
  const [runPhaseDetail, setRunPhaseDetail] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  // ThreadHeader's elapsed minutes/seconds — ticks only while a run is
  // actually timed (mirrors RunStatusBar's old local clock).
  const [liveNow, setLiveNow] = useState(() => Date.now());
  useEffect(() => {
    if (!runStartedAt) return;
    const t = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runStartedAt]);
  /** After a finished answer, show “your turn” delimiter until next send */
  const [awaitingNextTurn, setAwaitingNextTurn] = useState(false);
  // thinkingIdRef/streamIdRef moved fully into useRunEventStream (Task 13)
  // — no consumer outside the streaming engine/onServerEvent, both moved
  // with them.
  const cancelInFlightRef = useRef(false);
  const cancelGenerationRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const normalizedRunIdRef = useRef<string | null>(null);
  const pendingPromptMessageIdRef = useRef<string | null>(null);
  const pendingPromptSessionIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  // Task 7: useArtifactBinding needs messagesRef, so it cannot sit at the
  // exact original state-declaration position (~line 410, before
  // messagesRef exists) — this is the earliest point every input
  // (sessionId, runProjection, messages, runProjectionRef, messagesRef) is
  // already in scope. Its two internal effects only read committed state
  // (never a ref) and only ever call setArtifactOpenBinding(null), so
  // running earlier relative to App()'s other effects cannot change any
  // outcome — see task-7-report.md.
  const {
    artifactOpenBinding,
    setArtifactOpenBinding,
    boundArtifact,
    artifactAnnounce,
    closeArtifact,
    openRunArtifact,
    openMessageArtifact,
  } = useArtifactBinding({ sessionId, runProjection, messages, runProjectionRef, messagesRef });
  const openInFlightRef = useRef<string | null>(null);
  const lastOpenAtRef = useRef(0);
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const sendInFlightRef = useRef(false);
  // toolFailCountRef/streamBufRef/eventEpochRef/nextActivityRunCounterRef/
  // liveActivityRunRef moved fully into useRunEventStream (Task 13) — no
  // consumer outside the streaming engine/onServerEvent, both moved with
  // them. streamEpochRef/activityRevealRef stay: useComposerSend's sendText
  // (streamEpochRef) and the unmoved "First-sight of a tool group"
  // useLayoutEffect below (activityRevealRef) both need them.
  const streamEpochRef = useRef(0);
  const activityRevealRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const key = observeRosterFingerprint({
      childIds: state.childAgents?.members?.map((m) => m.childId),
      mcpIds: state.mcpServers?.members?.map((m) => m.serverId),
      hookIds: state.hooks?.members?.map((m) => m.hookId),
      browserIds: state.browserWork?.members?.map((m) => m.toolCallId),
    });
    const changed = key !== observeRosterKeyRef.current;
    if (changed) observeRosterKeyRef.current = key;
    if (!sessionId) return;
    if (observeHostOwnerSessionId == null || changed) {
      if (observeHostOwnerSessionId !== sessionId) setObserveHostOwnerSessionId(sessionId);
    }
  }, [state, sessionId, observeHostOwnerSessionId]);

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
      const el = transcriptRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, permissions.length, diffQueue.length, oauth, runProjection]);

  // First-sight of a tool group: stay at the live end if the operator is
  // already there. Only jump the first header into view when they scrolled away.
  useLayoutEffect(() => {
    const key = activityRevealRef.current;
    if (!key) return;
    const header = document.querySelector<HTMLElement>(
      `[data-activity-run="${CSS.escape(key)}"] .rhead`,
    );
    const plan = planLiveActivityReveal(stickToBottomRef.current, Boolean(header));
    if (plan === "keep-end") {
      const el = transcriptRef.current;
      if (el) el.scrollTop = el.scrollHeight;
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

  // Streaming engine, activity/rail identity helpers, onServerEvent, and the
  // journal restore/reconcile trio all live in useRunEventStream now (Task
  // 13) — this hook owns messages'/runProjection's *write* paths, which
  // nearly every other region of App.tsx reads. Called here, right after
  // exportSessionDiagnostics (the position stampActivity itself used to
  // occupy), the earliest point every input (reportError chief among them —
  // declared just above) is already in scope. runProjection/messages/
  // runProjectionRef/commitRunProjection stay declared above, unmoved — see
  // useRunEventStream.ts's own doc comment for why (useArtifactBinding's
  // earlier call already depends on them).
  const {
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
  } = useRunEventStream({
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
  });

  // clearBootTimers/refreshBuildInfo/bootApp, the mount-boot effect, the
  // socket connect/reconnect effect (plus its restoreOwnedRunsRef mirror),
  // the health-poll effect, engineRetryAllowed, and retryHost all live in
  // useEngineHealth now (Task 14) — called here, right after
  // useRunEventStream's own closing brace (the position onServerEventRef's
  // mirror effect itself used to occupy), the earliest point every input is
  // legally in scope: onServerEvent/restoreOwnedRuns/markDisconnectedActivity/
  // reconcileOwnedRuns (a fourth, brief-unnamed back-reference the
  // health-poll effect actually needs — see useEngineHealth.ts's own doc
  // comment) all come from useRunEventStream's return just above.
  // boot/bootMsg/launchStatus/hostOk stay declared above, byte-for-byte
  // untouched — see useEngineHealth.ts's params doc for why (an earlier,
  // unmoved reader of each pins its declaration ahead of this hook's
  // earliest legal call site) — and are threaded through as parameters
  // instead; nothing here re-destructures any of the four, since App.tsx
  // already owns all four locally under those exact names.
  // refreshBuildInfo is part of the hook's return type (matching the
  // brief's literal Returns list) but is not destructured here: grep
  // confirms it has zero external callers even in the pre-move source
  // (only bootApp/retryHost ever called it, both moved into this same
  // hook) — the same shape as Task 9's needsYouReasonsKey/Task 10's
  // recoverChangeMember, and noUnusedLocals would fail on an unused
  // destructured binding.
  const {
    slowStart,
    diagRevealed,
    wsOk,
    healthFailStreak,
    buildInfo,
    engineRetryAllowed,
    retryHost,
    socketRef,
    bootApp,
  } = useEngineHealth({
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
  });

  // Normalized terminal truth owns the legacy run chrome regardless of which
  // transport delivered it (live WS, resume, admission replay, or health
  // reconciliation). This effect runs only after React has committed the
  // terminal projection, so it cannot observe the stale pre-reducer snapshot.
  const ownedAllTerminal = runProjection.runOrder
    .map((id) => runProjection.runsById[id])
    .filter((run): run is NonNullable<typeof run> => Boolean(run && run.sessionId === sessionId))
    .every((run) => run.state === "terminal")
    && runProjection.runOrder.some((id) => runProjection.runsById[id]?.sessionId === sessionId);
  useEffect(() => {
    if (!ownedAllTerminal) return;
    endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
    setRunPhase(null);
    setRunPhaseDetail(null);
    setRunFooter(null);
    setAwaitingNextTurn(true);
    cancelInFlightRef.current = false;
  }, [ownedAllTerminal, sessionId]);

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

  // engineRetryAllowed moved fully into useEngineHealth (Task 14) — see
  // that hook's own call site above.
  const chip = useMemo(() => statusChip(state), [state]);
  // Sidebar footer (Code): same auth source the topbar's Settings line
  // shows, in the two words the rail's footer copy is allowed.
  const railAuthLabel =
    state?.authMode === "sub_pool" ? "Grok · subscription" : "Grok · API key";
  const activeRun = useMemo(() => runProjection.runOrder
    .map((id) => runProjection.runsById[id])
    .find((run) => run?.sessionId === sessionId && run.state !== "terminal") ?? null,
    [runProjection, sessionId]);
  // The ring reflects the session's last known context usage, not just the
  // live run — a just-finished turn's reading stays valid until the next
  // one, rather than the ring vanishing the instant a run goes terminal.
  const latestSessionRunUsage = useMemo(() => {
    const ids = runProjection.runOrder.filter((id) => runProjection.runsById[id]?.sessionId === sessionId);
    const lastId = ids[ids.length - 1];
    return (lastId ? runProjection.runsById[lastId]?.usage : undefined) ?? null;
  }, [runProjection, sessionId]);
  const projectedRunIds = useMemo(() => new Set(
    runProjection.runOrder.filter((id) => runProjection.runsById[id]?.sessionId === sessionId),
  ), [runProjection, sessionId]);
  const activeOwnedRunKeys = useMemo(
    () => ownedRunKeysFromProjection(
      runProjection.runOrder.map((id) => runProjection.runsById[id]),
      sessionId,
    ),
    [runProjection, sessionId],
  );
  const journalActivityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of projectedRunIds) {
      const run = runProjection.runsById[id];
      if (!run) continue;
      for (const activity of Object.values(run.activities)) ids.add(activity.activityId);
    }
    return ids;
  }, [projectedRunIds, runProjection]);
  const visibleMessages = useMemo(
    () => {
      const liveRailIds = new Set<string>();
      const liveRailCopy = new Set<string>();
      for (const id of projectedRunIds) {
        const run = runProjection.runsById[id];
        if (!run || run.state === "terminal") continue;
        for (const item of railEvidenceFromRun(run)) {
          liveRailIds.add(item.identity);
          liveRailCopy.add(item.content);
        }
      }
      return messages.filter((message) => {
      if (message.projectedRunId && projectedRunIds.has(message.projectedRunId)) return false;
      if (
        (message.role === "tool" || Boolean(message.toolMeta?.activityId)) &&
        message.projectedRunId &&
        !projectedRunIds.has(message.projectedRunId)
      ) {
        return false;
      }
      const activityId = message.toolMeta?.activityId;
      if (message.role === "tool" && activityId && journalActivityIds.has(activityId)) return false;
      if (
        message.role === "system" &&
        message.content.startsWith("Stopped by you") &&
        !stopChipBelongsOnTranscript(
          runProjection.runOrder
            .map((id) => runProjection.runsById[id])
            .filter((run): run is NonNullable<typeof run> => Boolean(run) && run.sessionId === sessionId),
        )
      ) {
        return false;
      }
      if (
        message.role === "system" &&
        (message.content.startsWith("Permission requested:") ||
          message.content.startsWith("Diff proposed:"))
      ) {
        const identity = message.activityIdentity;
        if (identity && (identity.startsWith("permission:") || identity.startsWith("diff:"))) {
          return liveRailIds.has(identity);
        }
        return liveRailCopy.has(message.content);
      }
      return true;
    });
    },
    [messages, projectedRunIds, journalActivityIds, runProjection, sessionId],
  );
  const normalizedRunVisible = projectedRunIds.size > 0;
  // Run ownership is local to the active client session. The host's legacy
  // global `busy` bit is intentionally not a send/cancel authority: another
  // session may be running while this one remains usable.
  const busy = composerChromeBusy({
    activeNonTerminalRun: Boolean(activeRun),
    runStartedAt,
    ownedAllTerminal,
  });
  // Mirror in an effect, not during render (Task 2 — same reasoning as
  // sessionIdRef above). sendText additionally sets this ref eagerly and
  // synchronously the instant it admits a send (see its own busyRef.current
  // = true), independent of this mirror, so the double-send guard does not
  // rely on this effect's timing either.
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const connected = hostOk;
  const productMode: ProductMode = state?.mode === "code" ? "code" : "chat";
  // Changes dock projections, activity maps, diff-settlement callbacks, and
  // recovery UI state all live in useChangesProjections now (Task 10) — one
  // object so ChangesDock and ReviewSurface (both consume it below) cannot
  // drift from each other. Called here, right after productMode, the
  // earliest point every input (runProjection/runProjectionRef/
  // catchUpByRunId/productMode/sessionId/diffQueue+setter/changesOpen/view/
  // reportError/toast) is already in scope.
  const {
    changesDockFiles,
    changesDockVerify,
    changesDockGit,
    changesActivityStatusById,
    changesActivityLifecycleById,
    changesActivityOutputById,
    changesAvailable,
    changesDockVisible,
    reviewCommitDraft,
    changeRecoveryFlash,
    changeRevertPendingEditId,
    acceptDiff,
    rejectDiff,
    acceptAllDiffs,
    rejectAllDiffs,
    onChangesDockAccept,
    onChangesDockReject,
    onChangesDockRevert,
  } = useChangesProjections({
    runProjection,
    runProjectionRef,
    catchUpByRunId,
    productMode,
    sessionId,
    diffQueue,
    setDiffQueue,
    changesOpen,
    view,
    onError: reportError,
    toast,
  });
  // permissions/diffQueue/pendingPlanDecision/pendingRecoveryDecision/
  // planArm/decidePermission/trustFolder/settlePlan/recoverFromDock/
  // chooseAskOption/anyDecisionPending all live in useDecisions now (Task
  // 11). Called here, right after useChangesProjections, the earliest point
  // every input (productMode/connected just above; activeRun/reportError
  // declared earlier still) is already in scope — planArm specifically
  // needs productMode/connected, which are not ready any earlier than this
  // (see task-11-report.md Step 1 for why permissions/diffQueue/oauth's own
  // state could not move here too, unlike the brief's literal "Moves" line).
  const {
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
  } = useDecisions({
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
    workspace: state?.workspace ?? null,
    planEngagement: state?.planEngagement,
    planArmError,
    setPlanDecisionError,
  });
  const livePhase = useMemo(() => {
    if (activeRun) return deriveLivePhaseFromRun(activeRun);
    if (runStartedAt) {
      return deriveLivePhase({
        terminal: false,
        ownedBusy: true,
        liveness: "provider",
        planOwned: false,
        pendingTool: null,
        lastContentKind: null,
        decisionPending: false,
      });
    }
    return deriveLivePhase({
      terminal: true,
      ownedBusy: false,
      liveness: null,
      planOwned: false,
      pendingTool: null,
      lastContentKind: null,
      decisionPending: false,
    });
  }, [activeRun, runStartedAt]);
  const liveCopy = useMemo(() => {
    const copy = phaseCopy(livePhase);
    if (activeRun?.state === "recovering" && livePhase.kind !== "tool" && livePhase.kind !== "decision") {
      return { status: "Recovering run…", footer: "Recovering run…" };
    }
    if (activeRun?.state === "cancelling" && livePhase.kind !== "tool" && livePhase.kind !== "decision") {
      return { status: "Ending run…", footer: "Ending run…" };
    }
    return copy;
  }, [livePhase, activeRun?.state]);
  const livePlanning = livePhase.kind === "plan";
  const projectInstructionsComposer = useMemo(
    () =>
      projectProjectInstructionsComposer({
        mode: productMode,
        workspace: state?.workspace ?? null,
        connected,
        projectInstructions: state?.projectInstructions,
      }),
    [
      productMode,
      state?.workspace,
      connected,
      state?.projectInstructions?.status,
      state?.projectInstructions?.path,
      state?.projectInstructions?.vouched,
    ],
  );
  const codeAgent = state?.codeAgent ?? null;
  const vendorCode = productMode === "code" && codeAgent?.identity === "vendor";
  const codeHardFail =
    productMode === "code" &&
    (codeAgent?.identity === "hard_fail" || codeAgent?.resolveStatus === "hard_fail");
  const codePreAcquireOk =
    productMode === "code" &&
    codeAgent != null &&
    codeAgent.resolveStatus !== "hard_fail";
  const transportOk = hostOk && wsOk;
  const codeAgentComposer = useMemo(
    () =>
      projectCodeAgentComposer({
        mode: productMode,
        codeAgent,
        transportOk,
      }),
    [
      productMode,
      transportOk,
      codeAgent?.identity,
      codeAgent?.resolveStatus,
      codeAgent?.fallbackReason,
    ],
  );
  const {
    skillsPalette,
    skillsOpen,
    setSkillsOpen,
    skillsRows,
    skillsIndex,
    effectiveArmedName,
    armedSkillName,
    setArmedSkillName,
    armSkill,
    setSkillsActiveIndex,
  } = useSkillsPalette({
    productMode,
    codeAgent,
    skillsCatalog: state?.skillsCatalog,
    draft,
    composerRef,
    sessionId,
    setDraft,
  });
  const skillsFilter = slashTokenFilter(
    draft,
    composerRef.current?.selectionStart ?? draft.length,
  );
  const effortLevel: EffortLevel =
    state?.effort === "fast" ||
    state?.effort === "expert" ||
    state?.effort === "heavy" ||
    state?.effort === "auto"
      ? state.effort
      : prefs.effort || "auto";
  // sendText/send/queueCurrentDraft/cancelQueuedDraft/the queue-flush effect/
  // onReviewSendToGrok all live in useComposerSend now (Task 12). Called
  // here, right after effortLevel, the earliest point every input is
  // already in scope — armedSkillName/skillsPalette come from
  // useSkillsPalette just above; pendingPlanDecision from useDecisions
  // further above still; effortLevel itself (this hook's own last
  // dependency) is declared immediately above this call.
  const {
    queuedDraft,
    setQueuedDraft,
    sendText,
    send,
    queueCurrentDraft,
    cancelQueuedDraft,
    onReviewSendToGrok,
  } = useComposerSend({
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
  });
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
  const activeHome = useMemo(
    () => (sessionId ? loadSession(sessionPartition, sessionId) : null),
    [sessionPartition, sessionId, sessionList],
  );
  // Composer placeholder's "<home>" — the same real, never-fabricated title
  // ThreadHeader/ChatHomeName already show for this session.
  const chatHomeLabel = activeHome?.title?.trim() || null;
  // A question-style decision (recovery_confirmation) does not lock the
  // composer — the field is a valid way to answer it, so the placeholder
  // says so instead of the plain idle copy.
  const decisionPending = Boolean(pendingRecoveryDecision);

  // Review ⌄ composer popover — backed by the same PermissionPolicyControl
  // / BypassPermissionsControl logic (save flow, Bypass's own confirmation
  // gate) the Settings page uses, just reachable from the composer too.
  // Task 4: both call sites now share that wiring via PolicyControls; what
  // stays here is composer-only (the chip's kind/sentence), computed
  // separately from Settings' own so neither can regress the other's
  // already-tested wiring.
  const policyPublicView = (
    state as PublicState & {
      permissionPolicy?: { effectiveMode?: string; fallbackReason?: string | null; status?: string };
    }
  )?.permissionPolicy;
  const bypassPublicView = (
    state as PublicState & {
      bypassPermissions?: { unlocked?: boolean; available?: boolean; activeForSession?: boolean; blockedReason?: string | null };
    }
  )?.bypassPermissions;
  const policyKind = effectivePolicyKind({
    effectiveMode:
      policyPublicView?.effectiveMode === "trusted_workspace"
        ? "trusted_workspace"
        : policyPublicView?.effectiveMode === "review"
          ? "review"
          : null,
    bypassActive: Boolean(bypassPublicView?.activeForSession),
  });
  const policySentence = policyPublicView?.status === "confirmed" ? POLICY_SENTENCE[policyKind] : null;
  const policyChipContent = (
    <PolicyControls
      state={state}
      sessionId={sessionId}
      hostOk={hostOk}
      runStartedAt={runStartedAt}
      onApplyState={applyState}
    />
  );

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
        const s = await api.setPlanEngagement(engaged, sessionIdRef.current);
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
  // Code RunSurface filters projected-run messages out of visibleMessages, so
  // after a clean Answered turn the list can be empty while an owned terminal
  // still needs the idle Your turn cue. Chat without a projected run keeps the
  // visibleMessages gate so empty transcripts do not invent the delimiter.
  const turnReady =
    !sessionHasNonTerminalRun &&
    !sessionHasDockOwnedPending &&
    awaitingNextTurn &&
    (visibleMessages.length > 0 || normalizedRunVisible);

  useEffect(() => {
    if (!stickToBottomRef.current || !turnReady) return;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnReady]);

  const sendDisabledReason = useMemo(() => {
    if (!connected && !codePreAcquireOk) return "Engine offline — try again to send";
    if (codeHardFail) return CODE_AGENT_HARD_FAIL;
    if (productMode === "code" && !state?.workspace)
      return "Open a project folder first";
    if (!state?.hasApiKey && !vendorCode) return "Sign in or add an API key in Settings";
    if (productMode === "code" && (!state?.planEngagement || state.planEngagement.vouched === false)) {
      return PLAN_ARM_BLOCKED_UNVOUCHED;
    }
    // = the old `oauth || permissions.length > 0 || diffQueue.length > 0 ||
    // pendingPlanDecision || sessionHasDockOwnedPending`, algebraically
    // unchanged: anyDecisionPending (useDecisions, Task 11) is exactly the
    // first four terms; sessionHasDockOwnedPending (unmoved, App.tsx-local)
    // is OR'd back in here. Deps array below deliberately left untouched —
    // every raw value it names still fully determines anyDecisionPending's
    // own value, so no entry needed adding, and the Global Constraints
    // forbid "cleaning up" a dependency array as a side effect of a move.
    if (anyDecisionPending || sessionHasDockOwnedPending) {
      return SETTLE_CARD_BELOW;
    }
    if (sessionHasNonTerminalRun || busy) return "A run is in progress";
    if (!state?.permissionPolicy || state.permissionPolicy.status !== "confirmed") return "Permission policy is not confirmed";
    const skillNames =
      skillsPalette.state === "ready" ? skillsPalette.commands.map((c) => c.name) : [];
    if (!draftIsSendReady(draft, skillNames) && !effectiveArmedName) return EMPTY_DRAFT_SEND;
    return null;
  }, [connected, codePreAcquireOk, codeHardFail, vendorCode, productMode, state?.workspace, state?.hasApiKey, state?.permissionPolicy, state?.planEngagement, sessionHasNonTerminalRun, busy, sessionHasDockOwnedPending, draft, effectiveArmedName, skillsPalette, oauth, permissions.length, diffQueue.length, pendingPlanDecision]);
  const overview = useMemo(
    () => {
      const runPaths: string[] = [];
      let runToolCount = 0;
      let runToolFails = 0;
      for (const id of projectedRunIds) {
        const run = runProjection.runsById[id];
        if (!run) continue;
        for (const a of Object.values(run.activities)) {
          runToolCount += 1;
          if (a.status === "failed") runToolFails += 1;
          if (
            activityLooksLikeWrite(a) &&
            !activityIsVendorSessionPlan(a) &&
            typeof a.path === "string" &&
            a.path
          ) {
            runPaths.push(a.path);
          }
        }
      }
      return computeOverview(
        messages,
        [
          ...diffQueue.map((d) => d.path),
          ...runPaths,
        ],
        runToolCount > 0 ? { count: runToolCount, fails: runToolFails } : undefined,
      );
    },
    [messages, diffQueue, projectedRunIds, runProjection],
  );

  // retryHost moved fully into useEngineHealth (Task 14) — see that hook's
  // own call site above.

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
      setArtifactOpenBinding(null);
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
      setArtifactOpenBinding(null);
      discardTranscriptStream();
      const isChatKey = ws.startsWith("chat:");
      const branch =
        !isChatKey && ws === state?.workspace
          ? (branchMap[ws] ?? null)
          : null;
      const s = createSession(ws, defaultSessionTitle(ws), branch);
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
      setPlanDecisionError(null);
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
      setPlanEngagementUi,
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

  // Sidebar "Needs you" — live-derived from the run projection's own pending
  // decisions (runReducer.ts DecisionRequest), not a second source of truth.
  // permission/diff decisions read "approve"; recovery_confirmation/plan
  // read "question". Keyed by sessionId across every run the projection
  // currently holds, so a decision settling or its run reaching terminal
  // clears the flag even if the operator has since switched sessions.
  const needsYouReasons = useMemo(() => {
    const map: Record<string, "approve" | "question"> = {};
    for (const id of runProjection.runOrder) {
      const run = runProjection.runsById[id];
      if (!run || run.state === "terminal") continue;
      const pending = Object.values(run.decisions).find(
        (d) => d.status === "pending",
      );
      if (!pending) continue;
      map[run.sessionId] =
        pending.kind === "permission" || pending.kind === "diff"
          ? "approve"
          : "question";
    }
    return map;
  }, [runProjection]);
  const needsYouIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextIds = new Set(Object.keys(needsYouReasons));
    const prevIds = needsYouIdsRef.current;
    let changed = false;
    for (const id of nextIds) {
      if (!prevIds.has(id)) {
        setSessionNeedsYou(sessionPartition, id, true);
        changed = true;
        // Task 14 — the needs-you toast: real title only, never a fabricated
        // one. sessionList is this partition's own current list, so today's
        // architecture (needsYou only ever lands on the active session —
        // see Task 5's report) means it's always found; skip rather than
        // guess a name on the off chance it isn't.
        const flagged = sessionList.find((s) => s.id === id);
        if (flagged) {
          toast.push(`${chatListTitle(flagged)} needs you`, "needs", {
            label: "Jump",
            onClick: () => openHomeSession(sessionPartition, id),
          });
        }
      }
    }
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        // Decision settled / run reached terminal / run cancelled — clear in
        // whichever workspace the session lives in, not necessarily the one
        // active right now (the operator may have already switched away).
        clearSessionNeedsYouEverywhere(id);
        changed = true;
      }
    }
    needsYouIdsRef.current = nextIds;
    if (changed) setSessionList(listSessions(sessionPartition));
  }, [needsYouReasons, sessionPartition]);

  const browseFolder = useCallback(async () => {
    const native = await pickFolderNative();
    if (native) {
      setPathInput(native);
      await openPath(native);
      return;
    }
    const pathField = document.getElementById("workspace-path");
    pathField?.closest("details")?.setAttribute("open", "");
    pathField?.focus();
  }, [openPath]);

  // Task 13 — Home's cross-mode "open"/"start" actions. switchSession's own
  // chat branch never flips productMode (it never calls the engine — see
  // its isChatKey guard), and its code branch only flips mode via openPath
  // when the target isn't already state.workspace. Home is the first
  // reachable UI that can open a session from a *different* mode than the
  // one currently selected, so wrap it: flip mode first (awaited) when
  // needed, then delegate to the exact same switchSession/newSession every
  // other entry point already uses.
  const openHomeSession = useCallback(
    (workspace: string, id: string) => {
      const targetMode: ProductMode = isChatPartition(workspace) ? "chat" : "code";
      if (productMode !== targetMode) {
        void switchMode(targetMode).then(() => void switchSession(workspace, id));
      } else {
        void switchSession(workspace, id);
      }
    },
    [productMode, switchMode, switchSession],
  );

  // useHomeScreenData's inputs are only now all in legal scope: browseFolder
  // and openHomeSession (both required by its homeOn* wrappers) are
  // declared just above, later than every other input. Task 7/8 hit the
  // same constraint (see task-7-report.md/task-8-report.md) — call at the
  // earliest point everything it needs already exists, not at the state's
  // original position.
  const {
    treeWorkspaces,
    chatSessions,
    homeChatPartition,
    homeNeedsYou,
    homeRecentWorkspaces,
    paletteSessions,
    homeChatHomes,
    homeFooter,
    homeOnOpenFolder,
    homeOnFieldQuery,
    homeOnAllSessions,
    homeOnOpenChatHome,
  } = useHomeScreenData({
    sessionList,
    expandTick,
    productMode,
    pinnedPaths,
    setPinnedPaths,
    branchMap,
    sessionPartition,
    workspace: state?.workspace,
    chatRoot: state?.chatRoot,
    needsYouReasons,
    buildInfo,
    authLabel: railAuthLabel,
    refreshBranches,
    openPalette,
    browseFolder,
    openHomeSession,
  });

  const startNewCodeSession = useCallback(() => {
    const target = state?.workspace ?? listPinnedWorkspaces()[0] ?? null;
    if (!target) {
      void browseFolder();
      return;
    }
    if (productMode !== "code") {
      void switchMode("code").then(() => newSession(target));
    } else {
      newSession(target);
    }
  }, [productMode, state?.workspace, switchMode, newSession, browseFolder]);

  const startNewChatHome = useCallback(() => {
    if (productMode !== "chat") {
      void switchMode("chat").then(() => newSession(homeChatPartition));
    } else {
      newSession(homeChatPartition);
    }
  }, [productMode, switchMode, newSession, homeChatPartition]);

  const onSelectPaletteSession = useCallback(
    (row: PaletteSessionRow) => openHomeSession(row.workspacePath, row.id),
    [openHomeSession],
  );

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

  // The way back from a bound folder (review finding, Task 15): binding
  // repoints the GLOBAL chat root (api.setChatRoot), so every private-
  // sandbox home would be unreachable without this. Mirrors bindChatFolder
  // exactly but with a null path — the backend already treats
  // setChatRoot(null) as "clear", this only restores the frontend's way to
  // reach it. Never deletes anything: sessions under the bound folder's own
  // partition key (chat:<path>) stay on disk and reappear if that folder is
  // bound again later.
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

  // decidePermission/trustFolder moved into useDecisions (Task 11, called
  // earlier in App() — see the comment above that call).
  // settleOwnedDiff/acceptDiff/rejectDiff/onChangesDockAccept/
  // onChangesDockReject/onChangesDockRevert/acceptAllDiffs/rejectAllDiffs all
  // moved into useChangesProjections (Task 10, called earlier in App() —
  // see the comment above that call). onChangesDockCollapse/onOpenReview
  // stay here: they toggle the dock panel/view, not diff settlement.
  const onChangesDockCollapse = useCallback(() => setChangesOpen(false), [setChangesOpen]);
  const onOpenReview = useCallback(() => setView("review"), []);

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
      // A draft held for the session being deleted has nowhere left to
      // flush into — drop it rather than leave it inert forever.
      setQueuedDraft((prev) => (prev && prev.sessionId === id ? null : prev));
      if (sessionId === id) {
        setArtifactOpenBinding(null);
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
    // A manual Stop means the queued follow-up should not fire once this
    // cancelled run reaches terminal — that would surprise-send a message
    // right after the user asked to stop. Only this session's own queued
    // draft is at risk of that (Stop cancels this session's run alone), so
    // a draft held for a different session must survive untouched.
    setQueuedDraft((prev) => (prev && prev.sessionId === sessionId ? null : prev));
    cancelInFlightRef.current = true;
    cancelGenerationRef.current = streamEpochRef.current;
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
            if (replay.run.state === "terminal") { endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null); setRunPhase(null); setRunPhaseDetail(null); setRunFooter(null); setAwaitingNextTurn(true); cancelInFlightRef.current = false; }
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
                endPageSend(); sendInFlightRef.current = false; setRunStartedAt(null);
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

  // sendText/send/queueCurrentDraft/cancelQueuedDraft/the queue-flush effect/
  // onReviewSendToGrok all live in useComposerSend now (Task 12), called
  // right after effortLevel above — the earliest point every input (state/
  // oauth/permissions/diffQueue/armedSkillName/skillsPalette/
  // pendingPlanDecision/effortLevel) is already in scope. draft/setDraft
  // stay declared above (useSkillsPalette, called earlier, already needs
  // the real setDraft — see the comment there); queuedDraft/setQueuedDraft
  // moved fully into the hook (nothing between its old declaration and the
  // hook's own call position ever referenced it).

  // settlePlan/recoverFromDock/chooseAskOption moved into useDecisions
  // (Task 11, called earlier in App() — see the comment above that call).

  const retryLastUser = useCallback(
    (_id: string, content: string) => {
      setArtifactOpenBinding((b) => (b ? clearArtifactBinding(b) : null));
      // Drop trailing assistant / stop chips; keep the last user bubble
      void sendText(content, {
        ...RETRY_PROMPT_SEND_OPTS,
        skipUserBubble: true,
      });
    },
    [sendText],
  );

  const regenerateLast = useCallback(
    (userContent: string) => {
      setArtifactOpenBinding((b) => (b ? clearArtifactBinding(b) : null));
      void sendText(userContent, {
        ...RETRY_PROMPT_SEND_OPTS,
        skipUserBubble: true,
      });
    },
    [sendText],
  );

  const fillComposerFromChoice = useCallback(
    (label: string, meta?: string) => {
      const line = meta ? `I choose: ${label}\n\n${meta}` : `I choose: ${label}`;
      setDraft((d) => (d.trim() ? `${d.trim()}\n\n${line}` : line));
      toast.push(`Added “${label}” to composer`, "info");
      setTimeout(() => composerRef.current?.focus(), 0);
    },
    [toast],
  );

  /** Gate's "Edit command" — prefills the composer with the pending command, unchanged. */
  const editGateCommand = useCallback((command: string) => {
    setDraft(command);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

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
    const sessionRuns = runProjection.runOrder
      .map((id) => runProjection.runsById[id])
      .filter((run) => run && run.sessionId === sessionId);
    const md = transcriptToMarkdown({
      title: title || "Chat",
      mode: productMode,
      messages: mergeLiveRunsForExport(messagesRef.current, sessionRuns),
    });
    downloadMarkdown(suggestChatFilename(title), md);
    toast.push("Downloaded chat as Markdown", "success");
  }, [sessionId, sessionPartition, productMode, toast, runProjection]);

  const onComposerChange = (value: string) => {
    setDraft(value);
    const m = value.match(/@([^\s@]*)$/);
    if (m && fileIndex.length) {
      const q = m[1]!.toLowerCase();
      setAtSuggestions(atFileSuggestions(fileIndex, q, 8));
      setAtActiveIndex(0);
    } else {
      setAtSuggestions([]);
      setAtActiveIndex(0);
    }
  };

  const insertAtFile = (file: string) => {
    setDraft((d) => d.replace(/@([^\s@]*)$/, `@${file} `));
    setAtSuggestions([]);
    composerRef.current?.focus();
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (skillsOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSkillsOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (skillsRows.length) {
          setSkillsActiveIndex((i) => (i + 1) % skillsRows.length);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (skillsRows.length) {
          setSkillsActiveIndex((i) => (i - 1 + skillsRows.length) % skillsRows.length);
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && skillsRows[skillsIndex]) {
        e.preventDefault();
        armSkill(skillsRows[skillsIndex]!.name);
        return;
      }
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
    if (e.key === "Enter" && e.shiftKey && busy) {
      // Steer isn't offered (the host has no capability signal for it yet —
      // see PublicState); while busy, Shift+Enter's role becomes Queue
      // instead of a plain newline.
      if (queueAdmitted({ text: draft, busy })) {
        e.preventDefault();
        queueCurrentDraft();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // Global keys: palette, composer, sessions, permissions, diffs
  //
  // Task 15 (.superpowers/sdd/structure/task-15-report.md) considered
  // extracting this effect into apps/shell/src/useShortcuts.ts and decided
  // not to. Every one of its real inputs — the 25 entries in the dependency
  // array below, plus five referentially-stable setters/refs the array
  // omits (setPaletteOpen, setView, setPeek, setSkillsOpen, composerRef) —
  // is state owned elsewhere in App(), and the effect itself returns
  // nothing any other code consumes: it is a dispatch table, not a domain
  // with state of its own. Wrapping it in a hook would not shrink this
  // list, only relocate an equally long one into a same-shaped parameter
  // object in a different file. One entry, `oauth`, is not read anywhere
  // in the body below any more (superseded by `anyDecisionPending`, Task
  // 11) and would still have to be threaded through just to keep this
  // array unchanged, per the standing rule against touching dependency
  // arrays as a side effect of a move — extraction would freeze that dead
  // parameter permanently into a new file instead of leaving it as a
  // same-file loose end. See the report for the full evidence, including
  // confirmation that the dockOwnsFocus/inEditable trust guard exercised
  // by gate-keyboard-trust.integration.test.tsx is unchanged.
  useEffect(() => {
    const unbind = tinykeys(window, {
      "$mod+KeyK": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        if (paletteOpen && paletteMode === "commands") setPaletteOpen(false);
        else openPalette("commands");
      },
      "$mod+KeyP": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        if (paletteOpen && paletteMode === "sessions") setPaletteOpen(false);
        else openPalette("sessions");
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
      "$mod+KeyO": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        void browseFolder();
      },
      // Home's "New chat in a home" Start row advertises this hint (Task
      // 13) — wire the matching global shortcut so the hint isn't a dead
      // promise. Not previously bound (verified: no other $mod+Shift+KeyN
      // registration exists anywhere in this file or CommandPalette.tsx).
      "$mod+Shift+KeyN": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        startNewChatHome();
      },
      "$mod+Shift+KeyR": (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        if (!changesAvailable) return;
        e.preventDefault();
        setView((v) => (v === "review" ? "chat" : "review"));
      },
      Escape: (e) => {
        if (peek) {
          e.preventDefault();
          setPeek(null);
          return;
        }
        if (skillsOpen) {
          e.preventDefault();
          setSkillsOpen(false);
          return;
        }
        if (paletteOpen) {
          e.preventDefault();
          setPaletteOpen(false);
          return;
        }
        // Gate key: esc denies the pending permission — the dock owns
        // Escape here rather than ceding it to close an open artifact.
        if (permissions.length > 0) {
          e.preventDefault();
          void decidePermission("deny");
          return;
        }
        if (artifactOpenBinding) {
          // = the old `permissions.length > 0 || diffQueue.length > 0 ||
          // pendingPlanDecision != null || oauth != null`, verbatim —
          // anyDecisionPending (useDecisions, Task 11) is exactly this
          // formula, already used unchanged by sendText's own early-return
          // check elsewhere in this file.
          const dockOwns = anyDecisionPending;
          if (dockOwns) return;
          e.preventDefault();
          closeArtifact();
          return;
        }
        // A11Y-3: the review view had no Escape path at all — this falls
        // through to "cancel the run" below otherwise. Leaving review is far
        // less destructive than a cancel, so it goes before that fallback
        // (same tier as closing the artifact panel above).
        if (view === "review") {
          e.preventDefault();
          setView("chat");
          return;
        }
        // Composer's "Stop esc" hint, lowest priority — only once no gate,
        // palette, peek, open artifact, or review view wants Escape first.
        if (busy) {
          e.preventDefault();
          requestCancel();
        }
      },
      Enter: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (inEditable(e.target)) return;
        // Gate key: ⏎ allows the pending permission, or accepts a ready
        // plan when no permission is showing. The composer's own Enter
        // (send) is unaffected — it fires while focus is in the textarea,
        // which inEditable already excludes here.
        if (permissions.length > 0) {
          e.preventDefault();
          void decidePermission("allow_once");
          return;
        }
        if (pendingPlanDecision && planSettling !== true) {
          e.preventDefault();
          void settlePlan("accept");
        }
      },
      KeyY: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (permissions.length === 0) return;
        if (inEditable(e.target)) return;
        // F1: inEditable alone is not enough — it only rules out text
        // fields, not "focus is somewhere that is not this gate". Require
        // the dock to actually own focus before a bare letter can settle a
        // permission the operator was not looking at.
        if (!dockOwnsFocus(e.target)) return;
        e.preventDefault();
        void decidePermission("allow_once");
      },
      KeyN: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (permissions.length === 0) return;
        if (inEditable(e.target)) return;
        if (!dockOwnsFocus(e.target)) return;
        e.preventDefault();
        void decidePermission("deny");
      },
      KeyS: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (permissions.length === 0) return;
        if (inEditable(e.target)) return;
        if (!dockOwnsFocus(e.target)) return;
        e.preventDefault();
        void decidePermission("allow_session");
      },
      Digit1: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!pendingRecoveryDecision) return;
        if (inEditable(e.target)) return;
        if (!dockOwnsFocus(e.target)) return;
        e.preventDefault();
        chooseAskOption(0);
      },
      Digit2: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!pendingRecoveryDecision) return;
        if (inEditable(e.target)) return;
        if (!dockOwnsFocus(e.target)) return;
        e.preventDefault();
        chooseAskOption(1);
      },
      Digit3: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!pendingRecoveryDecision) return;
        if (inEditable(e.target)) return;
        if (!dockOwnsFocus(e.target)) return;
        e.preventDefault();
        chooseAskOption(2);
      },
      KeyA: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // The Review surface owns A/R itself (accept/reject the selected
        // file) while it's open — see ReviewSurface.tsx's own keydown
        // handler — so this legacy inline-queue shortcut steps aside here.
        if (view === "review") return;
        if (diffQueue.length === 0) return;
        if (inEditable(e.target)) return;
        e.preventDefault();
        void acceptDiff(diffQueue[0]!.id);
      },
      KeyR: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (view === "review") return;
        if (diffQueue.length === 0) return;
        if (inEditable(e.target)) return;
        e.preventDefault();
        void rejectDiff(diffQueue[0]!.id);
      },
    });
    return () => unbind();
  }, [
    permissions,
    decidePermission,
    newSession,
    browseFolder,
    startNewChatHome,
    peek,
    paletteOpen,
    paletteMode,
    openPalette,
    skillsOpen,
    diffQueue,
    oauth,
    acceptDiff,
    rejectDiff,
    artifactOpenBinding,
    closeArtifact,
    pendingPlanDecision,
    planSettling,
    settlePlan,
    pendingRecoveryDecision,
    chooseAskOption,
    view,
    changesAvailable,
    busy,
    requestCancel,
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

  // Task 15 (.superpowers/sdd/structure/task-15-report.md) considered
  // extracting this memo into apps/shell/src/useCommandPalette.ts and
  // decided not to, for the same reason as the tinykeys effect above:
  // every one of its ~27 real inputs (the dependency array below, plus
  // referentially-stable setters/refs it omits) is state owned elsewhere
  // in App(), none of it is owned here, and its one real conditional rule
  // (`engineRetryAllowed` hiding "Reconnect engine") is already exercised
  // end to end by App.failure.test.tsx's AC-U5 test. One dependency,
  // `diffQueue.length`, is a leftover from the "Jump to diffs" command
  // removed below (see that comment) — nothing in this body reads it any
  // more, but the standing rule against touching dependency arrays as a
  // side effect of a move means extraction would carry it forward as a
  // permanently-required, permanently-unused parameter. See the report for
  // the full evidence.
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
        hint: "Ctrl+K L N · Y/N/S",
        run: () =>
          toast.push(
            "Ctrl+K palette · Ctrl+L composer · Ctrl+N new · Y/N/S perms · esc close",
            "info",
          ),
      },
      // W3-7: "Jump to diffs" (#diff-panel) and "Jump to permission"
      // (#perm-card) used to live here. DiffPanel was deleted as dead code
      // (Wave 2 DEAD-2) and PermissionCard was retired for Gate (25150d9) —
      // neither id exists in the DOM any more, so both commands silently did
      // nothing while still showing a live-looking pending count. Removed
      // rather than retargeted: Changes/Review already have their own real
      // entry points (the Review chip, Ctrl+Shift+R).
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
    state?.priorConversations === true &&
    !notFoundDismissed;

  // The first-run welcome inherits the same correction: it must not welcome
  // a shell that already holds conversations elsewhere in its store just
  // because the mode/folder on screen happens to be new (AC12f — "renders
  // that surface's ordinary empty state", not the not-found copy and not
  // the welcome). Without this, fixing showConversationsNotFound above would
  // simply swap the false "not found" alarm for a false "Welcome to Forge".
  const showOnboarding =
    !showConversationsNotFound &&
    !notFoundDismissed &&
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

  // Task 12's mount point (see ComposerPane.tsx). Renders nothing until the
  // engine has actually reported usage for a real, catalog-known model.
  const contextRing = <ContextRing usage={latestSessionRunUsage} />;

  // Composer chips beside the field — Code: Plan, Expert, Review; Chat:
  // Pack, Expert (matches docs/design/forge-next/Main.dc.html and
  // Chat.dc.html's own composer `.bar` order).
  const composerChips =
    productMode === "code" ? (
      <>
        <PlanArmControl
          projection={planArm}
          onToggle={(engaged) => void setPlanEngagementUi(engaged)}
          onRetry={() => void setPlanEngagementUi(true)}
        />
        <EffortControl
          value={effortLevel}
          applied={state?.appliedEffort}
          onChange={(e) => void setEffortUi(e)}
          disabled={!connected}
        />
        <PolicyChip kind={policyKind} disabled={!connected} content={policyChipContent} />
      </>
    ) : (
      <>
        {chatPackComposer.state !== "absent_code" ? (
          <ChatPackStatus
            projection={chatPackComposer}
            inventoryOpen={packInventoryOpen}
            onToggleInventory={() => setPackInventoryOpen((open) => !open)}
          />
        ) : null}
        <EffortControl
          value={effortLevel}
          applied={state?.appliedEffort}
          onChange={(e) => void setEffortUi(e)}
          disabled={!connected}
        />
      </>
    );

  // Composer meta line's left side — Code: policy sentence · CodeAgentStatus
  // + model · ProjectInstructionsStatus (each real fact only, never
  // fabricated — an absent one is simply omitted, the CSS separator only
  // appears between facts that actually rendered). Chat has no permission
  // policy or AGENTS.md; its own home + model take the same slot.
  const composerMetaFacts =
    productMode === "code" ? (
      <>
        {policySentence ? <span>{policySentence}</span> : null}
        <span className="composer-identity">
          <CodeAgentStatus projection={codeAgentComposer} />
          <span className="composer-meta">
            {state?.appliedModel || state?.model || modelDraft}
          </span>
        </span>
        <ProjectInstructionsStatus projection={projectInstructionsComposer} />
      </>
    ) : (
      <>
        <span>{chatHomeLabel || "Chat"}</span>
        <span className="composer-meta">
          {state?.appliedModel || state?.model || modelDraft}
        </span>
      </>
    );

  return (
    <div className="app">
      <a className="skip-link" href="#composer-input">
        Skip to composer
      </a>
      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        actions={paletteActions}
        sessions={paletteSessions}
        initialQuery={paletteQuery}
        onClose={() => setPaletteOpen(false)}
        onSelectSession={onSelectPaletteSession}
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
            {" · safe beside Prod"}
          </span>
        </div>
      )}
      <AppTopbar
        productMode={productMode}
        modeSwitching={modeSwitching}
        onSwitchMode={(m) => void switchMode(m)}
        state={state}
        branchMap={branchMap}
        hostOk={hostOk}
        healthFailStreak={healthFailStreak}
        wsOk={wsOk}
        engineRetryAllowed={engineRetryAllowed}
        onRetryHost={() => void retryHost()}
        view={view}
        onToggleSettings={() => setView(view === "settings" ? "chat" : "settings")}
        onOpenPalette={() => openPalette("commands")}
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
            chatPackFiles={vouchedPack?.members.files ?? []}
            chatRootLabel={chatRootLabel}
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
            needsYouReasons={needsYouReasons}
            authLabel={railAuthLabel}
            version={buildInfo?.version ?? null}
          />
        </div>
        </Panel>
        <PanelResizeHandle className="layout-resize" aria-label="Resize sidebar" />
        <Panel id="main" minSize="40%" className="main-panel">

        <main className="main">
          {view === "settings" ? (
            <SettingsView
              tauri={tauri}
              buildInfo={buildInfo}
              state={state}
              chip={chip}
              sessionId={sessionId}
              hostOk={hostOk}
              runStartedAt={runStartedAt}
              applyState={applyState}
              classesStatus={classesStatus}
              classesView={classesView}
              setClassesView={setClassesView}
              toast={toast}
              startGrokSignIn={startGrokSignIn}
              reportError={reportError}
              engineRetryAllowed={engineRetryAllowed}
              bootApp={bootApp}
              oauth={oauth}
              setOauth={setOauth}
              setView={setView}
              setDraft={setDraft}
              composerRef={composerRef}
              apiKeyDraft={apiKeyDraft}
              setApiKeyDraft={setApiKeyDraft}
              modelDraft={modelDraft}
              setModelDraft={setModelDraft}
              shellAllowlist={shellAllowlist}
              setShellAllowlist={setShellAllowlist}
              connTest={connTest}
              setConnTest={setConnTest}
              exportStatus={exportStatus}
              prefs={prefs}
              setPrefs={setPrefs}
              updateStatus={updateStatus}
              setUpdateStatus={setUpdateStatus}
              saveSettings={saveSettings}
              exportSessionDiagnostics={exportSessionDiagnostics}
              refreshTree={refreshTree}
              setSessionList={setSessionList}
              sessionPartition={sessionPartition}
            />
          ) : view === "review" ? (
            <ReviewSurface
              threadTitle={activeHome?.title ?? ""}
              files={changesDockFiles}
              verify={changesDockVerify}
              git={changesDockGit}
              diffQueue={diffQueue}
              verifyOutputByActivityId={changesActivityOutputById}
              commitMessageDraft={reviewCommitDraft}
              onAccept={onChangesDockAccept}
              onReject={onChangesDockReject}
              onAcceptAll={acceptAllDiffs}
              onRejectAll={rejectAllDiffs}
              onRevert={onChangesDockRevert}
              revertPendingEditId={changeRevertPendingEditId}
              recoveryFlash={changeRecoveryFlash}
              onBack={() => setView("chat")}
              onSendToGrok={onReviewSendToGrok}
            />
          ) : (
            <ChatView
              activeHome={activeHome}
              state={state}
              effortLevel={effortLevel}
              runStartedAt={runStartedAt}
              liveNow={liveNow}
              liveCopy={liveCopy}
              permissions={permissions}
              diffQueue={diffQueue}
              pendingPlanDecision={pendingPlanDecision}
              sessionHasDockOwnedPending={sessionHasDockOwnedPending}
              busy={busy}
              requestCancel={requestCancel}
              overview={overview}
              productMode={productMode}
              chatRootLabel={chatRootLabel}
              setChangesOpen={setChangesOpen}
              exportCurrentChat={exportCurrentChat}
              messages={messages}
              changesDockFiles={changesDockFiles}
              changesOpen={changesOpen}
              changesAvailable={changesAvailable}
              artifactOpenBinding={artifactOpenBinding}
              closeArtifact={closeArtifact}
              homeNameSaveFailed={homeNameSaveFailed}
              sessionId={sessionId}
              setHomeNameDraft={setHomeNameDraft}
              renameSession={renameSession}
              sessionPartition={sessionPartition}
              homeNameDraft={homeNameDraft}
              openingWs={openingWs}
              runFooter={runFooter}
              livePlanning={livePlanning}
              artifactAnnounce={artifactAnnounce}
              transcriptRef={transcriptRef}
              bottomRef={bottomRef}
              showConversationsNotFound={showConversationsNotFound}
              skillsOpen={skillsOpen}
              atSuggestions={atSuggestions}
              exportSessionDiagnostics={exportSessionDiagnostics}
              setNotFoundDismissed={setNotFoundDismissed}
              showOnboarding={showOnboarding}
              firstRun={firstRun}
              browseFolder={browseFolder}
              setView={setView}
              setFirstRun={setFirstRun}
              switchMode={switchMode}
              buildInfo={buildInfo}
              normalizedRunVisible={normalizedRunVisible}
              hostOk={hostOk}
              vendorCode={vendorCode}
              startGrokSignIn={startGrokSignIn}
              homeNeedsYou={homeNeedsYou}
              homeRecentWorkspaces={homeRecentWorkspaces}
              homeChatHomes={homeChatHomes}
              homeFooter={homeFooter}
              homeOnFieldQuery={homeOnFieldQuery}
              openHomeSession={openHomeSession}
              homeOnOpenChatHome={homeOnOpenChatHome}
              homeOnAllSessions={homeOnAllSessions}
              startNewChatHome={startNewChatHome}
              homeOnOpenFolder={homeOnOpenFolder}
              startNewCodeSession={startNewCodeSession}
              engineRetryAllowed={engineRetryAllowed}
              retryHost={retryHost}
              runProjection={runProjection}
              catchUpByRunId={catchUpByRunId}
              activeOwnedRunKeys={activeOwnedRunKeys}
              observeHostOwnerSessionId={observeHostOwnerSessionId}
              sendText={sendText}
              fillComposerFromChoice={fillComposerFromChoice}
              openRunArtifact={openRunArtifact}
              activeRun={activeRun}
              visibleMessages={visibleMessages}
              runPhaseDetail={runPhaseDetail}
              lastUserId={lastUserId}
              lastAssistantId={lastAssistantId}
              retryLastUser={retryLastUser}
              regenerateLast={regenerateLast}
              openToolPath={openToolPath}
              forceOpenFailedTools={forceOpenFailedTools}
              openMessageArtifact={openMessageArtifact}
              boundArtifact={boundArtifact}
              oauth={oauth}
              decidePermission={decidePermission}
              trustFolder={trustFolder}
              editGateCommand={editGateCommand}
              planSettling={planSettling}
              planDecisionError={planDecisionError}
              settlePlan={settlePlan}
              pendingRecoveryDecision={pendingRecoveryDecision}
              recoverFromDock={recoverFromDock}
              setOauth={setOauth}
              skillsPalette={skillsPalette}
              skillsFilter={skillsFilter}
              skillsIndex={skillsIndex}
              armSkill={armSkill}
              setSkillsOpen={setSkillsOpen}
              effectiveArmedName={effectiveArmedName}
              setArmedSkillName={setArmedSkillName}
              dragOver={dragOver}
              setDragOver={setDragOver}
              attachFilesToComposer={attachFilesToComposer}
              setDraft={setDraft}
              atActiveIndex={atActiveIndex}
              setAtActiveIndex={setAtActiveIndex}
              setAtSuggestions={setAtSuggestions}
              insertAtFile={insertAtFile}
              mutateChatPack={mutateChatPack}
              composerRef={composerRef}
              draft={draft}
              onComposerChange={onComposerChange}
              onComposerKeyDown={onComposerKeyDown}
              sendDisabledReason={sendDisabledReason}
              connected={connected}
              send={send}
              queueCurrentDraft={queueCurrentDraft}
              cancelQueuedDraft={cancelQueuedDraft}
              queuedDraft={queuedDraft}
              decisionPending={decisionPending}
              chatHomeLabel={chatHomeLabel}
              composerChips={composerChips}
              contextRing={contextRing}
              composerMetaFacts={composerMetaFacts}
              packInventoryVisible={packInventoryVisible}
              chatPackComposer={chatPackComposer}
              armedPackMembers={armedPackMembers}
              packMutationInFlight={packMutationInFlight}
              fileIndex={fileIndex}
            />
          )}
        </main>
        </Panel>
        {changesDockVisible ? (
          <>
            <PanelResizeHandle className="layout-resize" aria-label="Resize changes" />
            <Panel id="changes" defaultSize="26%" minSize="300px" maxSize="560px" className="changes-panel">
              <ChangesDock
                files={changesDockFiles}
                verify={changesDockVerify}
                git={changesDockGit}
                diffQueue={diffQueue}
                activityStatusById={changesActivityStatusById}
                activityLifecycleById={changesActivityLifecycleById}
                onAccept={onChangesDockAccept}
                onReject={onChangesDockReject}
                onRevert={onChangesDockRevert}
                revertPendingEditId={changeRevertPendingEditId}
                recoveryFlash={changeRecoveryFlash}
                onCollapse={onChangesDockCollapse}
                onOpenReview={onOpenReview}
              />
            </Panel>
          </>
        ) : null}
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
