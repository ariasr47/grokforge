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
import {
  ComposerPane,
  EMPTY_DRAFT_SEND,
  composerBlockReasonVisible,
  draftIsSendReady,
} from "./ComposerPane";
import { beginPageSend, cancelDuringAdmission, composerChromeBusy, composerSendAdmitted, endPageSend, queueAdmitted, shouldFlushQueue } from "./composerSend";
import { isStalePermissionDecision } from "./stalePermissionDecision";
import { activityIsVendorSessionPlan, activityLooksLikeWrite } from "./activityWriteLike";
import { atFileSuggestions } from "./atFileQuery";
import { recentCrashes } from "./crashSink";

import { EffortControl } from "./EffortControl";
import { ContextRing } from "./ContextRing";
import { PlanArmControl } from "./PlanArmControl";
import {
  PLAN_ARM_BLOCKED_UNVOUCHED,
  PLAN_LIVE_FOOTER,
  planArmFailureCopy,
  projectPlanArm,
} from "./planArm";
import { projectProjectInstructionsComposer } from "./projectInstructionsComposer";
import { ProjectInstructionsStatus } from "./ProjectInstructionsStatus";
import { projectChatPackComposer } from "./chatPackComposer";
import { ChatPackStatus } from "./ChatPackStatus";
import { CODE_AGENT_HARD_FAIL, projectCodeAgentComposer } from "./codeAgentComposer";
import { CodeAgentStatus } from "./CodeAgentStatus";
import {
  composeArmedPromptText,
  filterSkillCommands,
  mayOpenSkillsPalette,
  projectSkillsPalette,
  shouldClearArmedInvocation,
  slashTokenFilter,
  stripLeadingSlashToken,
  SKILLS_UNAVAILABLE,
} from "./skillsCatalogComposer";
import { SkillsPalette } from "./SkillsPalette";
import { SkillArmedChip } from "./SkillArmedChip";
import { ChatPackInventory } from "./ChatPackInventory";
import { ChatHomeName } from "./ChatHomeName";
import { isLivePlanning, planReadyIsEmpty } from "./runPlanSection";
import {
  isOnboardingDone,
  loadFirstRun,
  patchFirstRun,
  type FirstRunState,
} from "./firstRun";
import { Onboarding } from "./Onboarding";
import { CommandPalette, type PaletteAction, type PaletteSessionRow } from "./CommandPalette";
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
import { MessageList, WAITING_PLACEHOLDER_HEAD, type ChatMessage } from "./MessageList";
import {
  formatToolInput,
  formatToolOutput,
} from "./toolFormat";
import { ActionDock, PLAN_DECISION_FAILURE } from "./ActionDock";
import {
  ChangesDock,
  type ChangesDockFilesState,
  type ChangesDockGitState,
  type ChangesDockMember,
  type ChangesDockVerifyState,
} from "./ChangesDock";
import { ThreadHeader } from "./ThreadHeader";
import { projectRunVerifyList } from "./runVerifyList";
import { projectRunGitReviewList, draftCommitMessageFromGitReview } from "./runGitReviewList";
import { ReviewSurface } from "./ReviewSurface";
import { inEditable, dockOwnsFocus } from "./inEditable";

/** Legacy per-run phase label — superseded by derivedLivePhase's phaseCopy for
 *  display, but still threaded through several socket-event handlers below. */
type RunPhase = "waiting_model" | "reasoning" | "tools" | "writing" | "done" | null;
import { loadPromptHistory, pushPromptHistory } from "./promptHistory";
import {
  cancelledDoneShouldPaint,
  foldRunAnswersIntoHistory,
  RETRY_PROMPT_SEND_OPTS,
  stopChipBelongsOnTranscript,
  stripTrailingStopAndAssistant,
} from "./promptSendHistory";
import {
  chatListTitle,
  chatSessionPreview,
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
  isExpanded,
  listNeedsYou,
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
  workspaceDisplayName,
  type ChatSession,
} from "./sessions";
import { FrameFlush, StreamBuffer } from "./streamBuffer";
import { computeOverview, OverviewStrip, pickToolsJumpEl, toolsJumpNeedsStart } from "./OverviewStrip";
import { EmptyStates } from "./EmptyStates";
import {
  HomeScreen,
  type HomeChatHome,
  type HomeFooterFacts,
  type HomeNeedsYouItem,
  type HomeRecentWorkspace,
} from "./HomeScreen";
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
import {
  isPackagedWindowsInstallerSession,
  SETTINGS_UNSIGNED_LINE,
  SHA_TITLE,
  shaSettingsLabel,
  type InstallerShaVoucher,
} from "./installerHonesty";
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
  mergeLiveRunsForExport,
  suggestChatFilename,
  transcriptToMarkdown,
} from "./exportChat";
import { expandAtMentions } from "./expandMentions";
import { initialRunProjection, isRunStreamDelta, mergeRunSnapshot, persistableRunProjection, reduceRunEvent, reduceRunEvents, restoreRunProjection, type ActivityRecord, type RunProjection, type RunEventEnvelope } from "./runReducer";
import {
  hostObserveRosterEligible,
  isOwnedMembership,
  observeRosterFingerprint,
  ownedRunKeysFromProjection,
} from "./activityMembership";
import { deriveLivePhase, deriveLivePhaseFromRun, phaseCopy } from "./derivedLivePhase";
import {
  hasDockOwnedPending,
  mergePendingDiffs,
  mergePendingPermissions,
  isStaleRailChip,
  projectRunChangeList,
  railEvidenceFromRun,
  settledRailIdentities,
  type PendingDiff,
  type PermissionReq,
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
import { ArtifactPanel } from "./ArtifactPanel";
import { elevateArtifact } from "./artifactEligibility";
import {
  bindingMatchesTurn,
  clearArtifactBinding,
  openArtifactBinding,
  shouldClearOnConversationChange,
  shouldClearOnSourceGone,
  type ArtifactContentKind,
  type ArtifactOpenBinding,
} from "./artifactOpenBinding";
import { savedPolicyUnusable } from "./PermissionPolicyControl";
import { PolicyControls } from "./PolicyControls";
import { PolicyChip, POLICY_SENTENCE, effectivePolicyKind } from "./PolicyChip";
import { TrustedCommandClassesControl } from "./TrustedCommandClassesControl";
import type { TrustedCommandClassesStatus } from "./TrustedCommandClassesControl";

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
    installerShaVoucher: InstallerShaVoucher;
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
  /** Queue ⇧⏎ (Task 11): a single held draft, bound to the session it was
   *  queued against — never a bare string. `busy`, `sendText`, and the
   *  "Queued" chip all key off whichever session is *currently selected*,
   *  so a draft with no session id of its own would flush into (or show
   *  in) the wrong session after a switch. `switchSession`/`newSession`
   *  deliberately do nothing to this slot: the draft simply stays inert —
   *  hidden and unflushed — until the user selects its own session again,
   *  at which point it flushes as soon as that session reads idle (see
   *  composerSend.ts's queueAdmitted/shouldFlushQueue). */
  const [queuedDraft, setQueuedDraft] = useState<{ sessionId: string; text: string } | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState<string>(INHERITED_DEFAULT_MODEL);
  const [shellAllowlist, setShellAllowlist] = useState(true);
  const [permissions, setPermissions] = useState<PermissionReq[]>([]);
  const permissionInFlightRef = useRef<string | null>(null);
  const recoveryInFlightRef = useRef<string | null>(null);
  const [diffQueue, setDiffQueue] = useState<PendingDiff[]>([]);
  const [planArmError, setPlanArmError] = useState<string | null>(null);
  const [planSettling, setPlanSettling] = useState(false);
  const [planDecisionError, setPlanDecisionError] = useState<string | null>(null);
  const [changeRecoveryFlash, setChangeRecoveryFlash] = useState<Record<string, "reverted" | "conflict">>({});
  const [changeRevertPendingEditId, setChangeRevertPendingEditId] = useState<string | null>(null);
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
  const [armedSkillName, setArmedSkillName] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsActiveIndex, setSkillsActiveIndex] = useState(0);
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
  const [artifactOpenBinding, setArtifactOpenBinding] =
    useState<ArtifactOpenBinding | null>(null);
  const [artifactAnnounce, setArtifactAnnounce] = useState("");
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
  const thinkingIdRef = useRef<string | null>(null);
  const cancelInFlightRef = useRef(false);
  const cancelGenerationRef = useRef(0);
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
  const sendInFlightRef = useRef(false);
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
  // Latest-value mirror for the HostSocket connect effect above, which is
  // built once per boot and deliberately does not depend on restoreOwnedRuns
  // (see that effect's dependency-array comment). Kept current in an effect,
  // matching onServerEventRef's pattern above rather than applyRailEvidenceRef's
  // render-time assignment — see the Global Constraints note on ref timing.
  const restoreOwnedRunsRef = useRef(restoreOwnedRuns);
  useEffect(() => {
    restoreOwnedRunsRef.current = restoreOwnedRuns;
  });

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
      // A healthy transport does not prove a run outcome. Poll only runs that
      // remain nonterminal in the owned projection, and merge journal truth
      // idempotently. Hours-long live runs remain live; missed terminals are
      // recovered without requiring a reload or a second prompt.
      const hasOwnedNonterminal = runProjectionRef.current.runOrder.some((id) => {
        const run = runProjectionRef.current.runsById[id];
        return Boolean(run && run.state !== "terminal");
      });
      if (hasOwnedNonterminal) void reconcileOwnedRuns();
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
    return { state: "ready", members };
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
        reportError(e instanceof Error ? e.message : "Recovery failed");
      }
    } finally {
      setChangeRevertPendingEditId(null);
    }
  }, [reportError]);
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
  const planBusyOther = Boolean(activeRun && !isLivePlanning(activeRun));
  const planArm = useMemo(
    () =>
      projectPlanArm({
        mode: productMode,
        workspace: state?.workspace ?? null,
        connected,
        planEngagement: state?.planEngagement,
        busyOther: planBusyOther,
        armError: planArmError,
      }),
    [productMode, state?.workspace, connected, state?.planEngagement, planBusyOther, planArmError],
  );
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
  const skillsPalette = useMemo(
    () =>
      projectSkillsPalette({
        mode: productMode,
        codeAgent,
        skillsCatalog: state?.skillsCatalog,
      }),
    [
      productMode,
      codeAgent?.identity,
      codeAgent?.resolveStatus,
      codeAgent?.fallbackReason,
      state?.skillsCatalog?.disposition,
      state?.skillsCatalog?.commands,
    ],
  );
  const skillsFilter = slashTokenFilter(
    draft,
    composerRef.current?.selectionStart ?? draft.length,
  );
  const skillsRows =
    skillsPalette.state === "ready"
      ? filterSkillCommands(skillsPalette.commands, skillsFilter)
      : [];
  const skillsIndex =
    skillsRows.length === 0
      ? 0
      : Math.min(skillsActiveIndex, skillsRows.length - 1);
  const effectiveArmedName = shouldClearArmedInvocation(skillsPalette)
    ? null
    : armedSkillName;
  useEffect(() => {
    const caret = composerRef.current?.selectionStart ?? draft.length;
    const next = mayOpenSkillsPalette(skillsPalette, draft, caret);
    setSkillsOpen((open) => (open === next ? open : next));
  }, [skillsPalette.state, draft]);
  useEffect(() => {
    if (shouldClearArmedInvocation(skillsPalette)) setArmedSkillName(null);
  }, [skillsPalette.state]);
  useEffect(() => {
    setArmedSkillName(null);
  }, [sessionId]);
  useEffect(() => {
    setSkillsActiveIndex((i) => (i === 0 ? i : 0));
  }, [draft, skillsPalette.state]);
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
    if (
      oauth ||
      permissions.length > 0 ||
      diffQueue.length > 0 ||
      pendingPlanDecision ||
      sessionHasDockOwnedPending
    ) {
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

  // Task 13 — Home screen data. Unlike treeWorkspaces/chatSessions above,
  // these are NOT gated by productMode: Home is a cross-mode launcher (it
  // is the one place that opens either a Code workspace or a Chat home), so
  // both columns must reflect real data regardless of which mode happens to
  // be selected right now. listPinnedWorkspaces()/listSessions() are
  // synchronous local-store reads (no engine round-trip), so it's safe to
  // call them fresh here instead of reusing the mode-gated memos above.
  // sessionList/expandTick carry no value read directly below — they exist
  // purely as "the store changed, recompute" triggers, the same role they
  // already play in treeWorkspaces's own dependency array.
  const homeChatPartition = useMemo(
    () => partitionKey("chat", state?.chatRoot),
    [state?.chatRoot],
  );

  // needsYouReasons is a brand-new object every time runProjection changes —
  // which, mid-stream, is every single token delta. Depending on that
  // object's *reference* would recompute homeNeedsYou (and hand HomeScreen
  // a new array) on every streamed token even though the actual approve/
  // question assignment essentially never changes during plain streaming.
  // Depend on its serialized *value* instead, so homeNeedsYou (and anything
  // memoized on it) stays referentially stable across a run that streams
  // for a while with no decision pending.
  const needsYouReasonsKey = useMemo(
    () =>
      Object.entries(needsYouReasons)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, reason]) => `${id}:${reason}`)
        .join(","),
    [needsYouReasons],
  );

  const homeNeedsYou: HomeNeedsYouItem[] = useMemo(() => {
    const workspaces = [...listPinnedWorkspaces(), homeChatPartition];
    const flagged = workspaces.flatMap((ws) =>
      listNeedsYou(ws).map((s) => ({ ws, s })),
    );
    flagged.sort((a, b) => b.s.updatedAt - a.s.updatedAt);
    return flagged.map(({ ws, s }) => ({
      workspace: ws,
      id: s.id,
      title: chatListTitle(s),
      reason: needsYouReasons[s.id],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, expandTick, homeChatPartition, needsYouReasonsKey]);

  const homeRecentWorkspaces: HomeRecentWorkspace[] = useMemo(() => {
    return listPinnedWorkspaces()
      .map((path): HomeRecentWorkspace | null => {
        const sessions = listSessions(path); // already updatedAt-desc
        const last = sessions[0];
        if (!last) return null;
        return {
          path,
          name: workspaceDisplayName(path),
          branch: last.branch ?? null,
          sessionCount: sessions.length,
          lastSessionId: last.id,
          lastTitle: chatListTitle(last),
          updatedAt: last.updatedAt,
        };
      })
      .filter((w): w is HomeRecentWorkspace => w !== null)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, expandTick]);

  // Task 14 — Ctrl+P's sessions mode: every session in every pinned Code
  // workspace (not just each workspace's latest, unlike homeRecentWorkspaces
  // above), flattened and sorted most-recent-first so the palette can fuzzy
  // search across all of them. Same staleness ceiling as homeRecentWorkspaces
  // — a background workspace's own data only refreshes when sessionList
  // (the active partition) or expandTick changes, which is the established,
  // accepted pattern here (Task 13).
  const paletteSessions: PaletteSessionRow[] = useMemo(() => {
    const rows: PaletteSessionRow[] = [];
    for (const path of listPinnedWorkspaces()) {
      const workspaceName = workspaceDisplayName(path);
      for (const s of listSessions(path)) {
        rows.push({
          id: s.id,
          workspacePath: path,
          workspaceName,
          title: chatListTitle(s),
          branch: s.branch ?? null,
          updatedAt: s.updatedAt,
        });
      }
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, expandTick]);

  // Chat homes column (Task 13; un-parked — see
  // .superpowers/sdd/crash-diagnosis.md). Mirrors homeRecentWorkspaces
  // above: listSessions() already returns updatedAt-desc, capped to the 5
  // most recent so this column reads as bounded the same way Recent does.
  // The crash that parked this was never in this data wiring — it was
  // App.ac9.test.tsx's own `assert.equal` called with a live rendered DOM
  // element, which walks React's Fiber tree at unbounded depth the moment
  // the comparison legitimately fails. That assertion (and the same hazard
  // elsewhere in the suite) is fixed, so this can derive real rows again.
  const homeChatHomes: HomeChatHome[] = useMemo(() => {
    return listSessions(homeChatPartition)
      .map(
        (s): HomeChatHome => ({
          id: s.id,
          title: chatListTitle(s),
          preview: chatSessionPreview(s),
          updatedAt: s.updatedAt,
        }),
      )
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, expandTick, homeChatPartition]);

  const homeFooter: HomeFooterFacts = useMemo(
    () => ({
      version: buildInfo?.version ?? null,
      installerWarning: isPackagedWindowsInstallerSession()
        ? SETTINGS_UNSIGNED_LINE
        : null,
      authLabel: railAuthLabel,
      channel: channelBadge(),
      isPackagedWindows: isPackagedWindowsInstallerSession(),
    }),
    [buildInfo?.version, railAuthLabel],
  );

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

  // Stable wrappers for HomeScreen's remaining props. HomeScreen is
  // React.memo'd; an inline arrow recreated on every App render (App
  // re-renders on every streamed token while a run is live) would defeat
  // that memo the instant Home happens to be on screen during a live turn
  // (e.g. right after a mode switch, before the next turn's first message
  // lands) — every token would re-render the whole Home tree for no reason.
  const homeOnOpenFolder = useCallback(() => void browseFolder(), [browseFolder]);
  // Home's field and its "All sessions" link both open Ctrl+P's sessions
  // mode (Task 14) rather than the command list — "jump to a session" is
  // Home's whole purpose. The field's typed text lands straight in the
  // palette's own input; All-sessions opens the same list unfiltered.
  const homeOnFieldQuery = useCallback(
    (text: string) => openPalette("sessions", text),
    [openPalette],
  );
  const homeOnAllSessions = useCallback(() => openPalette("sessions", ""), [openPalette]);
  const homeOnOpenChatHome = useCallback(
    (id: string) => openHomeSession(homeChatPartition, id),
    [openHomeSession, homeChatPartition],
  );
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

  const decidePermission = useCallback(
    async (decision: "allow_once" | "allow_session" | "deny") => {
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
        if (decision !== "allow_once") {
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
      toast.push("File accepted", "success");
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
      toast.push("File rejected", "info");
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    }
  }, [reportError, settleOwnedDiff, toast]);
  // Stable wrappers so ChangesDock (memo()) does not re-render on every App
  // render just because an inline arrow function got a new identity.
  const onChangesDockAccept = useCallback((id: string) => void acceptDiff(id), [acceptDiff]);
  const onChangesDockReject = useCallback((id: string) => void rejectDiff(id), [rejectDiff]);
  const onChangesDockRevert = useCallback(
    (member: ChangesDockMember) => void recoverChangeMember(member),
    [recoverChangeMember],
  );
  const onChangesDockCollapse = useCallback(() => setChangesOpen(false), [setChangesOpen]);
  const onOpenReview = useCallback(() => setView("review"), []);
  // DiffPanel's inline queue is gone, but its "settle everything currently
  // queued" shape is exactly what the Review surface's footer/Ctrl+⇧A need.
  const acceptAllDiffs = useCallback(() => {
    for (const d of diffQueue) void acceptDiff(d.id);
  }, [diffQueue, acceptDiff]);
  const rejectAllDiffs = useCallback(() => {
    for (const d of diffQueue) void rejectDiff(d.id);
  }, [diffQueue, rejectDiff]);


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
      if (!pendingRecoveryDecision) return;
      if (index === 0) void recoverFromDock();
    },
    [pendingRecoveryDecision, recoverFromDock],
  );

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

  const closeArtifact = useCallback(() => {
    setArtifactOpenBinding((prev) => {
      if (prev) setArtifactAnnounce("Artifact closed");
      return clearArtifactBinding(prev);
    });
  }, []);

  const openRunArtifact = useCallback(
    (runId: string) => {
      if (!sessionId) return;
      const run = runProjectionRef.current.runsById[runId];
      const r = elevateArtifact(run?.finalAnswer ?? "");
      if (r.kind === "none") return;
      setArtifactOpenBinding((prev) =>
        openArtifactBinding(prev, {
          conversationId: sessionId,
          turn: { surface: "run", id: runId },
          contentKind: r.kind === "long-markdown" ? "long-markdown" : "rich-document",
        }),
      );
      setArtifactAnnounce("Artifact opened");
    },
    [sessionId],
  );

  const openMessageArtifact = useCallback(
    (messageId: string) => {
      if (!sessionId) return;
      const msg = messagesRef.current.find((m) => m.id === messageId);
      const r = elevateArtifact(msg?.content ?? "");
      if (r.kind === "none") return;
      setArtifactOpenBinding((prev) =>
        openArtifactBinding(prev, {
          conversationId: sessionId,
          turn: { surface: "message", id: messageId },
          contentKind: r.kind === "long-markdown" ? "long-markdown" : "rich-document",
        }),
      );
      setArtifactAnnounce("Artifact opened");
    },
    [sessionId],
  );

  const boundArtifact = useMemo(() => {
    if (!artifactOpenBinding || !sessionId) return null;
    if (artifactOpenBinding.conversationId !== sessionId) return null;
    const { turn } = artifactOpenBinding;
    if (turn.surface === "run") {
      const run = runProjection.runsById[turn.id];
      if (!run || run.sessionId !== sessionId) return null;
      const r = elevateArtifact(run.finalAnswer ?? "");
      if (r.kind === "none" || !r.body) return null;
      return { body: r.body, contentKind: r.kind as ArtifactContentKind };
    }
    const msg = messages.find((m) => m.id === turn.id);
    if (!msg) return null;
    const r = elevateArtifact(msg.content);
    if (r.kind === "none" || !r.body) return null;
    return { body: r.body, contentKind: r.kind as ArtifactContentKind };
  }, [artifactOpenBinding, sessionId, runProjection, messages]);

  useEffect(() => {
    if (!artifactOpenBinding) return;
    if (shouldClearOnConversationChange(artifactOpenBinding.conversationId, sessionId)) {
      setArtifactOpenBinding(null);
    }
  }, [sessionId, artifactOpenBinding]);

  useEffect(() => {
    if (!artifactOpenBinding) return;
    const present = new Set<string>();
    for (const id of runProjection.runOrder) {
      const run = runProjection.runsById[id];
      if (run?.sessionId === sessionId) present.add(run.runId);
    }
    for (const m of messages) present.add(m.id);
    if (shouldClearOnSourceGone(artifactOpenBinding.turn, present)) {
      setArtifactOpenBinding(null);
    }
  }, [artifactOpenBinding, runProjection, messages, sessionId]);

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

  const armSkill = (name: string) => {
    const caret = composerRef.current?.selectionStart ?? draft.length;
    setDraft(stripLeadingSlashToken(draft, caret));
    setArmedSkillName(name);
    setSkillsOpen(false);
    composerRef.current?.focus();
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
          const dockOwns =
            permissions.length > 0 ||
            diffQueue.length > 0 ||
            pendingPlanDecision != null ||
            oauth != null;
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
                  <span>
                    {shaSettingsLabel(buildInfo?.installerShaVoucher)}
                    {buildInfo?.installerShaVoucher.status === "live" &&
                    typeof buildInfo.installerShaVoucher.value === "string" ? (
                      <>
                        {" "}
                        <code className="installer-sha" title={SHA_TITLE}>
                          {buildInfo.installerShaVoucher.value}
                        </code>
                      </>
                    ) : null}
                  </span>
                  <br />
                  <span className="installer-unsigned-line">
                    {SETTINGS_UNSIGNED_LINE}
                  </span>
                  <br />
                  Logs:{" "}
                  <code>{state?.logHint || "%USERPROFILE%\\.grokforge\\logs"}</code>
                </div>
                <p className="settings-meta">
                  {channelBadge() ? `${channelBadge()} · ` : ""}
                  {chip.text}
                  {state?.authSource ? ` · ${state.authSource}` : ""}
                </p>
                {(() => {
                  const policy = (state as PublicState & { permissionPolicy?: { effectiveMode?: string; fallbackReason?: string | null; status?: string } })?.permissionPolicy;
                  return (
                    <PolicyControls
                      state={state}
                      sessionId={sessionId}
                      hostOk={hostOk}
                      runStartedAt={runStartedAt}
                      onApplyState={applyState}
                    >
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
                    </PolicyControls>
                  );
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
                    <Hint label="Aurora is still. Stars twinkle.">
                      <Button
                        onClick={() => {
                          const next = patchPrefs({
                            field: prefs.field === "stars" ? "aurora" : "stars",
                          });
                          setPrefs(next);
                        }}
                      >
                        Background: {prefs.field === "stars" ? "Stars" : "Aurora"}
                      </Button>
                    </Hint>
                  </div>
                </div>
                <div className="field">
                  <span>Shortcuts</span>
                  <p className="settings-hint">
                    {/* F6: Ctrl+N is new session (tinykeys $mod+KeyN); Ctrl+Shift+N
                        is new chat (matches HomeScreen's own copy) — this panel
                        previously paired Ctrl+N with "new chat", which is wrong. */}
                    <kbd>Ctrl+K</kbd> palette · <kbd>Ctrl+N</kbd> new session ·{" "}
                    <kbd>Ctrl+Shift+N</kbd> new chat · <kbd>Ctrl+L</kbd> composer ·{" "}
                    <kbd>Y/N/S</kbd> permissions ·{" "}
                    <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> line, or queue while busy
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
            <div className="panel-chat">
              <ThreadHeader
                title={activeHome?.title ?? ""}
                model={state?.appliedModel || state?.model || null}
                effortLabel={
                  effortLevel !== "auto"
                    ? effortLevel.charAt(0).toUpperCase() + effortLevel.slice(1)
                    : null
                }
                elapsedMinutes={runStartedAt ? Math.floor((liveNow - runStartedAt) / 60000) : null}
                elapsedSeconds={runStartedAt ? Math.floor((liveNow - runStartedAt) / 1000) : null}
                liveStatusText={liveCopy.status}
                decisionPending={
                  permissions.length > 0 ||
                  diffQueue.length > 0 ||
                  Boolean(pendingPlanDecision) ||
                  sessionHasDockOwnedPending
                }
                cancellable={busy}
                onCancel={requestCancel}
                overview={
                  <OverviewStrip
                    overview={overview}
                    workspaceName={
                      productMode === "chat" ? chatRootLabel : (state?.workspaceName ?? null)
                    }
                    mode={productMode}
                    shellCapability={state?.shellCapability}
                    codeAgentIdentity={state?.codeAgent?.identity}
                    onJumpToFiles={
                      overview.filesTouched.length ? () => setChangesOpen(true) : undefined
                    }
                    onJumpToTools={
                      overview.tools > 0
                        ? () => {
                            const tools = pickToolsJumpEl();
                            if (!tools) return;
                            tools.scrollIntoView({ block: "nearest", behavior: "instant" });
                            const you = document.querySelector<HTMLElement>(".you");
                            if (you) {
                              const toolsR0 = tools.getBoundingClientRect();
                              const youR = you.getBoundingClientRect();
                              if (toolsJumpNeedsStart({ toolsTop: toolsR0.top, youBottom: youR.bottom })) {
                                tools.scrollIntoView({ block: "start", behavior: "instant" });
                              }
                            }
                          }
                        : undefined
                    }
                  />
                }
                onExport={exportCurrentChat}
                exportDisabled={messages.length === 0}
                changesCount={
                  changesDockFiles.state === "ready" ? changesDockFiles.members.length : undefined
                }
                changesOpen={changesOpen}
                onToggleChanges={() => setChangesOpen((v) => !v)}
                changesAvailable={changesAvailable}
                artifactOpen={Boolean(artifactOpenBinding)}
                onToggleArtifact={closeArtifact}
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

              <div className={`chat-stage${artifactOpenBinding ? " chat-stage--artifact-open" : ""}`}>
              <div className="sr-only" aria-live="polite">{artifactAnnounce}</div>
              <div className="transcript" tabIndex={-1} ref={transcriptRef}>
                {showConversationsNotFound && !skillsOpen && atSuggestions.length === 0 ? (
                  <EmptyStates
                    kind="conversations-not-found"
                    onSaveDiagnostics={() => void exportSessionDiagnostics()}
                    onStartNewConversation={() => {
                      setNotFoundDismissed(true);
                    }}
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
                    installerShaVoucher={
                      buildInfo?.installerShaVoucher ?? { status: "pending" }
                    }
                    packagedWindowsHonesty={isPackagedWindowsInstallerSession()}
                  />
                ) : messages.length === 0 && !normalizedRunVisible && hostOk && !skillsOpen && atSuggestions.length === 0 ? (
                  !state?.hasApiKey && !vendorCode ? (
                    <EmptyStates
                      kind="signed-out"
                      onSettings={() => setView("settings")}
                      onSignIn={startGrokSignIn}
                    />
                  ) : (
                    // Task 13 — Home screen. Replaces the old "ready"/
                    // "no-workspace" EmptyStates kinds: mode-agnostic (see
                    // homeNeedsYou/homeRecentWorkspaces/homeChatHomes above),
                    // so it renders the same regardless of productMode or
                    // whether a Code workspace happens to be open.
                    <HomeScreen
                      // No OS user name is available anywhere on `state`,
                      // the desktop bridge, or api.ts (checked) — greet
                      // without one rather than inventing "there".
                      greetingName={null}
                      needsYou={homeNeedsYou}
                      recentWorkspaces={homeRecentWorkspaces}
                      chatHomes={homeChatHomes}
                      footer={homeFooter}
                      onFieldQuery={homeOnFieldQuery}
                      onOpenNeedsYou={openHomeSession}
                      onOpenWorkspace={openHomeSession}
                      onOpenChatHome={homeOnOpenChatHome}
                      onAllSessions={homeOnAllSessions}
                      onNewChatHome={startNewChatHome}
                      onOpenFolder={homeOnOpenFolder}
                      onNewSession={startNewCodeSession}
                      onNewChat={startNewChatHome}
                    />
                  )
                ) : messages.length === 0 && !normalizedRunVisible && !hostOk ? (
                  <EmptyStates
                    kind="host-offline"
                    onReconnect={
                      engineRetryAllowed ? () => void retryHost() : undefined
                    }
                  />
                ) : (
                  <>
                    {runProjection.runOrder.some((id) => runProjection.runsById[id]?.sessionId === sessionId) && (
                    <div className="stream">
                      <div className="spine" aria-hidden="true" />
                      {runProjection.runOrder.map((id) => {
                        const run = runProjection.runsById[id];
                        if (!run || run.sessionId !== sessionId) return null;
                        const runCatchUp = catchUpForRun(catchUpByRunId, run.runId);
                        return (
                        <div key={id} className="run-stack">
                        <RunSurface run={run} catchUp={runCatchUp} offline={!hostOk} productMode={productMode} codeAgent={state?.codeAgent ?? null} childAgents={state?.childAgents} browserWork={state?.browserWork} mcpServers={state?.mcpServers} hooks={state?.hooks} hostRosterEligible={hostObserveRosterEligible({ owned: activeOwnedRunKeys, key: { sessionId: run.sessionId, runId: run.runId }, runState: run.state, activeSessionId: sessionId, hostOwnerSessionId: observeHostOwnerSessionId })} ownershipLost={run.failure?.code === "execution_owner_lost"} onRetryPrompt={(prompt) => void sendText(prompt, RETRY_PROMPT_SEND_OPTS)} onReconnect={() => void retryHost()} onOpenSettings={() => setView("settings")} onExportDiagnostics={() => void exportSessionDiagnostics()} onChoose={fillComposerFromChoice} artifactOpen={bindingMatchesTurn(artifactOpenBinding, { surface: "run", id: run.runId })} onOpenArtifact={openRunArtifact} title={activeHome?.title ?? ""} />
                        </div>
                        );
                      })}
                    </div>
                    )}
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
                      lastUserId={lastUserId}
                      lastAssistantId={lastAssistantId}
                      onRetryUser={retryLastUser}
                      onRegenerate={regenerateLast}
                      onChoose={fillComposerFromChoice}
                      onOpenPath={(p) => void openToolPath(p)}
                      forceOpenFailedTools={forceOpenFailedTools}
                      artifactOpenMessageId={
                        artifactOpenBinding?.turn.surface === "message"
                          ? artifactOpenBinding.turn.id
                          : null
                      }
                      onOpenArtifact={openMessageArtifact}
                      title={activeHome?.title ?? ""}
                    />
                  </>
                )}
                <div ref={bottomRef} />
              </div>
              <ArtifactPanel
                body={boundArtifact?.body ?? null}
                contentKind={boundArtifact?.contentKind ?? null}
                title={activeHome?.title ?? ""}
                onClose={closeArtifact}
                onChoose={fillComposerFromChoice}
              />
              </div>

              <ActionDock
                permissions={permissions}
                oauth={oauth}
                onPermission={(d) => void decidePermission(d)}
                onTrustFolder={
                  permissions[0]?.kind === "write" && state?.workspace
                    ? () => void trustFolder()
                    : undefined
                }
                onEditCommand={
                  permissions[0]?.kind === "shell"
                    ? () => editGateCommand(permissions[0]!.detail)
                    : undefined
                }
                workspaceName={state?.workspaceName ?? null}
                onOauthCancel={() => {
                  void api.oauthCancel();
                  setOauth(null);
                }}
                planDecision={
                  pendingPlanDecision
                    ? {
                        empty: pendingPlanDecision.empty,
                        proposedMembers: pendingPlanDecision.run.plan?.proposedMembers ?? [],
                        body: pendingPlanDecision.run.plan?.body ?? null,
                        settling: planSettling,
                        error: planDecisionError,
                      }
                    : null
                }
                onPlanAccept={() => void settlePlan("accept")}
                onPlanKeepPlanning={() => void settlePlan("keep_planning")}
                recoveryDecision={
                  pendingRecoveryDecision
                    ? {
                        id: pendingRecoveryDecision.decision.requestId,
                        question: pendingRecoveryDecision.decision.detail,
                      }
                    : null
                }
                onRecover={() => void recoverFromDock()}
              />

              <ComposerPane
                skillsMenu={
                  <SkillsPalette
                    open={skillsOpen}
                    projection={skillsPalette}
                    filter={skillsFilter}
                    activeIndex={skillsIndex}
                    onSelect={armSkill}
                    onDismiss={() => setSkillsOpen(false)}
                  />
                }
                armedSkill={
                  effectiveArmedName ? (
                    <SkillArmedChip
                      name={effectiveArmedName}
                      onClear={() => setArmedSkillName(null)}
                    />
                  ) : null
                }
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
                atActiveIndex={atActiveIndex}
                onAtActiveIndexChange={setAtActiveIndex}
                onDismissAt={() => {
                  setAtSuggestions([]);
                  setAtActiveIndex(0);
                }}
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
                onAttachFiles={(files) => void attachFilesToComposer(files)}
                busy={busy}
                onCancel={requestCancel}
                onSend={() => void send()}
                onQueue={queueCurrentDraft}
                onCancelQueued={cancelQueuedDraft}
                queuedCount={queuedDraft && queuedDraft.sessionId === sessionId ? 1 : 0}
                decisionPending={decisionPending}
                chatHomeLabel={chatHomeLabel}
                chips={composerChips}
                contextRing={contextRing}
                metaFacts={composerMetaFacts}
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
                {savedPolicyUnusable(state?.permissionPolicy?.fallbackReason) && (
                  <div className="composer-policy-notice" role="status">
                    Forge couldn’t use the saved permission policy. Review is active.
                  </div>
                )}
                {composerBlockReasonVisible(sendDisabledReason, draft) ? (
                  <div className="composer-block-reason" role="status">
                    {sendDisabledReason}
                  </div>
                ) : null}
                {(busy || runStartedAt || livePlanning) && (liveCopy.status || liveCopy.footer) && (
                  <div className="composer-thinking" role="status">
                    <span className="run-dot" />
                    {livePlanning
                      ? `${liveCopy.status} · ${liveCopy.footer}`
                      : liveCopy.footer || liveCopy.status}
                  </div>
                )}
                  </>
                }
              />
            </div>
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
