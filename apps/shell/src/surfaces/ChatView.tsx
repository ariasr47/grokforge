import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { api, type EffortLevel, type ProductMode, type PublicState } from "../lib/api";
import type { FirstRunState } from "../lib/firstRun";
import type { ChatSession } from "../lib/sessions";
import type { InstallerShaVoucher } from "../lib/installerHonesty";
import type { ChatMessage } from "./MessageList";
import type { RunProjection, RunProjectionRun, DecisionRequest } from "../projections/runReducer";
import type { CatchUpMap } from "../projections/catchUpWindows";
import type { ArtifactOpenBinding, ArtifactContentKind } from "../projections/artifactOpenBinding";
import type { PermissionReq, PendingDiff } from "../projections/runChangeList";
import type { ChangesDockFilesState } from "../dock/ChangesDock";
import type {
  HomeChatHome,
  HomeFooterFacts,
  HomeNeedsYouItem,
  HomeRecentWorkspace,
} from "./HomeScreen";
import type { SkillsPaletteProjection } from "../projections/skillsCatalogComposer";
import type { ChatPackComposerProjection } from "../projections/chatPackComposer";
import { ThreadHeader } from "../chrome/ThreadHeader";
import { OverviewStrip, pickToolsJumpEl, toolsJumpNeedsStart, type RunOverview } from "./OverviewStrip";
import { ChatHomeName } from "../sections/ChatHomeName";
import { PLAN_LIVE_FOOTER } from "../projections/planArm";
import { TranscriptBody } from "./TranscriptBody";
import { ArtifactPanel } from "../dock/ArtifactPanel";
import { ActionDock } from "../dock/ActionDock";
import { ComposerPane, composerBlockReasonVisible } from "../composer/ComposerPane";
import { settleLockCopy } from "../lib/copyDock";
import { SkillsPalette } from "../composer/SkillsPalette";
import { SkillArmedChip } from "../sections/SkillArmedChip";
import { ChatPackInventory } from "../sections/ChatPackInventory";
import { savedPolicyUnusable } from "../composer/PermissionPolicyControl";

/**
 * Mirrors `App.tsx`'s own (unexported) `OAuthPending` shape — same
 * duplication rationale Task 5's `SettingsView` recorded: this is the OAuth
 * device-code payload, a stable external contract, not something the two
 * files would evolve independently without both call sites failing to
 * typecheck anyway.
 */
interface OAuthPending {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

/** Matches `mutateChatPack`'s real parameter union in App.tsx. */
type ChatPackMutation =
  | { action: "pin_file"; path: string }
  | { action: "unpin_file"; path: string }
  | { action: "set_note"; note: string }
  | { action: "clear_note" }
  | { action: "clear_pack" };

export interface ChatViewProps {
  activeHome: ChatSession | null;
  state: PublicState | null;
  /** Header model id: last-run appliedModel after reload, not session.model. */
  chromeModel: string | null;
  effortLevel: EffortLevel;
  runStartedAt: number | null;
  liveNow: number;
  /** App.tsx's own `liveCopy = useMemo(...)` (phaseCopy, with recovering/cancelling overrides). */
  liveCopy: { status: string | null; footer: string | null };
  permissions: PermissionReq[];
  diffQueue: PendingDiff[];
  pendingPlanDecision: { run: RunProjectionRun; decision: DecisionRequest; empty: boolean } | null;
  sessionHasDockOwnedPending: boolean;
  busy: boolean;
  requestCancel: () => void;
  overview: RunOverview;
  productMode: ProductMode;
  chatRootLabel: string | null;
  setChangesOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  exportCurrentChat: () => void;
  messages: ChatMessage[];
  changesDockFiles: ChangesDockFilesState;
  changesOpen: boolean;
  changesAvailable: boolean;
  artifactOpenBinding: ArtifactOpenBinding | null;
  closeArtifact: () => void;
  homeNameSaveFailed: boolean;
  sessionId: string | null;
  setHomeNameDraft: (value: string) => void;
  /** Matches `renameSession`'s real signature in App.tsx. */
  renameSession: (workspace: string, id: string, title: string) => void;
  sessionPartition: string;
  homeNameDraft: string;
  openingWs: boolean;
  runFooter: string | null;
  livePlanning: boolean;
  artifactAnnounce: string;
  transcriptRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;

  // TranscriptBody's own ladder props (Task 6) — threaded straight through.
  showConversationsNotFound: boolean;
  skillsOpen: boolean;
  atSuggestions: string[];
  exportSessionDiagnostics: () => Promise<void>;
  setNotFoundDismissed: (value: boolean) => void;
  showOnboarding: boolean;
  firstRun: FirstRunState;
  browseFolder: () => Promise<void>;
  /** App.tsx's `View` union, inlined the same way Task 5's SettingsView did. */
  setView: (value: "chat" | "settings" | "review") => void;
  setFirstRun: (updater: (fr: FirstRunState) => FirstRunState) => void;
  switchMode: (mode: ProductMode) => Promise<void>;
  buildInfo: {
    version?: string;
    channel?: string;
    channelLabel?: string;
    installerShaVoucher: InstallerShaVoucher;
  } | null;
  normalizedRunVisible: boolean;
  turnReady: boolean;
  hostOk: boolean;
  vendorCode: boolean;
  startGrokSignIn: () => void;
  homeNeedsYou: HomeNeedsYouItem[];
  homeRecentWorkspaces: HomeRecentWorkspace[];
  homeChatHomes: HomeChatHome[];
  homeFooter: HomeFooterFacts;
  homeOnFieldQuery: (text: string) => void;
  openHomeSession: (workspace: string, id: string) => void;
  homeOnOpenChatHome: (id: string) => void;
  homeOnAllSessions: () => void;
  startNewChatHome: () => void;
  homeOnOpenFolder: () => void;
  startNewCodeSession: () => void;
  engineRetryAllowed: boolean;
  retryHost: () => Promise<void>;
  runProjection: RunProjection;
  catchUpByRunId: CatchUpMap;
  activeOwnedRunKeys: Set<string>;
  observeHostOwnerSessionId: string | null;
  sendText: (
    raw: string,
    opts?: { skipUserBubble?: boolean; stripTrailingAssistant?: boolean },
  ) => Promise<boolean>;
  fillComposerFromChoice: (label: string, meta?: string) => void;
  openRunArtifact: (runId: string) => void;
  activeRun: RunProjectionRun | null;
  visibleMessages: ChatMessage[];
  runPhaseDetail: string | null;
  lastUserId: string | null;
  lastAssistantId: string | null;
  retryLastUser: (id: string, content: string) => void;
  regenerateLast: (userContent: string) => void;
  openToolPath: (path: string) => Promise<void>;
  forceOpenFailedTools: boolean;
  openMessageArtifact: (messageId: string) => void;

  // ArtifactPanel / ActionDock / ComposerPane (ChatView's own tail).
  boundArtifact: { body: string; contentKind: ArtifactContentKind } | null;
  oauth: OAuthPending | null;
  /** Matches `decidePermission`'s real signature in App.tsx. */
  decidePermission: (decision: "allow_once" | "allow_session" | "deny" | `option:${number}`, command?: string) => Promise<void>;
  trustFolder: () => Promise<void>;
  editGateCommand: (command: string) => void;
  planSettling: boolean;
  planDecisionError: string | null;
  settlePlan: (action: "accept" | "keep_planning") => Promise<void>;
  pendingRecoveryDecision: { run: RunProjectionRun; decision: DecisionRequest; editId: string | null } | null;
  recoverFromDock: () => Promise<void>;
  setOauth: (value: OAuthPending | null) => void;
  skillsPalette: SkillsPaletteProjection;
  skillsFilter: string;
  skillsIndex: number;
  armSkill: (name: string) => void;
  setSkillsOpen: (value: boolean) => void;
  effectiveArmedName: string | null;
  setArmedSkillName: (value: string | null) => void;
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  attachFilesToComposer: (files: FileList | File[]) => Promise<void>;
  /** Only ever called with the updater form in this block — see App.tsx's composer onDrop. */
  setDraft: (updater: (d: string) => string) => void;
  atActiveIndex: number;
  setAtActiveIndex: (value: number) => void;
  setAtSuggestions: (value: string[]) => void;
  insertAtFile: (file: string) => void;
  /** Matches `mutateChatPack`'s real parameter union in App.tsx. */
  mutateChatPack: (action: ChatPackMutation) => Promise<void>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onComposerChange: (value: string) => void;
  onComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendDisabledReason: string | null;
  connected: boolean;
  send: () => Promise<void>;
  queueCurrentDraft: () => void;
  cancelQueuedDraft: () => void;
  queuedDraft: { sessionId: string; text: string } | null;
  decisionPending: boolean;
  chatHomeLabel: string | null;
  composerChips: ReactNode;
  contextRing: ReactNode;
  composerMetaFacts: ReactNode;
  packInventoryVisible: boolean;
  chatPackComposer: ChatPackComposerProjection;
  armedPackMembers: { files: Array<{ path: string }>; note: string | null };
  packMutationInFlight: boolean;
  fileIndex: string[];
}

/**
 * Task 6: the chat view, moved verbatim out of `App()`'s JSX (the
 * `view === "chat"` branch, `<div className="panel-chat">...</div>`).
 * Composes `ThreadHeader`, the optional `ChatHomeName`, the run footer,
 * `TranscriptBody`, `ArtifactPanel`, `ActionDock` and `ComposerPane` — same
 * shape as Task 6's own `TranscriptBody` and Task 5's `SettingsView`: every
 * prop is one free identifier the original block read from `App()`'s
 * closure, threaded through under its original name. No hook moved; every
 * `useState`/`useMemo`/`useCallback` this block depends on stays in `App()`
 * at its exact original position — only the render output moved.
 */
export function ChatView({
  activeHome,
  state,
  chromeModel,
  effortLevel,
  runStartedAt,
  liveNow,
  liveCopy,
  permissions,
  diffQueue,
  pendingPlanDecision,
  sessionHasDockOwnedPending,
  busy,
  requestCancel,
  overview,
  productMode,
  chatRootLabel,
  setChangesOpen,
  exportCurrentChat,
  messages,
  changesDockFiles,
  changesOpen,
  changesAvailable,
  artifactOpenBinding,
  closeArtifact,
  homeNameSaveFailed,
  sessionId,
  setHomeNameDraft,
  renameSession,
  sessionPartition,
  homeNameDraft,
  openingWs,
  runFooter,
  livePlanning,
  artifactAnnounce,
  transcriptRef,
  bottomRef,
  showConversationsNotFound,
  skillsOpen,
  atSuggestions,
  exportSessionDiagnostics,
  setNotFoundDismissed,
  showOnboarding,
  firstRun,
  browseFolder,
  setView,
  setFirstRun,
  switchMode,
  buildInfo,
  normalizedRunVisible,
  turnReady,
  hostOk,
  vendorCode,
  startGrokSignIn,
  homeNeedsYou,
  homeRecentWorkspaces,
  homeChatHomes,
  homeFooter,
  homeOnFieldQuery,
  openHomeSession,
  homeOnOpenChatHome,
  homeOnAllSessions,
  startNewChatHome,
  homeOnOpenFolder,
  startNewCodeSession,
  engineRetryAllowed,
  retryHost,
  runProjection,
  catchUpByRunId,
  activeOwnedRunKeys,
  observeHostOwnerSessionId,
  sendText,
  fillComposerFromChoice,
  openRunArtifact,
  activeRun,
  visibleMessages,
  runPhaseDetail,
  lastUserId,
  lastAssistantId,
  retryLastUser,
  regenerateLast,
  openToolPath,
  forceOpenFailedTools,
  openMessageArtifact,
  boundArtifact,
  oauth,
  decidePermission,
  trustFolder,
  planSettling,
  planDecisionError,
  settlePlan,
  pendingRecoveryDecision,
  recoverFromDock,
  setOauth,
  skillsPalette,
  skillsFilter,
  skillsIndex,
  armSkill,
  setSkillsOpen,
  effectiveArmedName,
  setArmedSkillName,
  dragOver,
  setDragOver,
  attachFilesToComposer,
  setDraft,
  atActiveIndex,
  setAtActiveIndex,
  setAtSuggestions,
  insertAtFile,
  mutateChatPack,
  composerRef,
  draft,
  onComposerChange,
  onComposerKeyDown,
  sendDisabledReason,
  connected,
  send,
  queueCurrentDraft,
  cancelQueuedDraft,
  queuedDraft,
  decisionPending,
  chatHomeLabel,
  composerChips,
  contextRing,
  composerMetaFacts,
  packInventoryVisible,
  chatPackComposer,
  armedPackMembers,
  packMutationInFlight,
  fileIndex,
}: ChatViewProps) {
  return (
    <div className="panel-chat">
      <ThreadHeader
        title={activeHome?.title ?? ""}
        model={chromeModel}
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
        <TranscriptBody
          showConversationsNotFound={showConversationsNotFound}
          skillsOpen={skillsOpen}
          atSuggestions={atSuggestions}
          exportSessionDiagnostics={exportSessionDiagnostics}
          setNotFoundDismissed={setNotFoundDismissed}
          showOnboarding={showOnboarding}
          firstRun={firstRun}
          state={state}
          productMode={productMode}
          browseFolder={browseFolder}
          setView={setView}
          setFirstRun={setFirstRun}
          switchMode={switchMode}
          buildInfo={buildInfo}
          messages={messages}
          normalizedRunVisible={normalizedRunVisible}
          turnReady={turnReady}
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
          sessionId={sessionId}
          catchUpByRunId={catchUpByRunId}
          activeOwnedRunKeys={activeOwnedRunKeys}
          observeHostOwnerSessionId={observeHostOwnerSessionId}
          sendText={sendText}
          fillComposerFromChoice={fillComposerFromChoice}
          artifactOpenBinding={artifactOpenBinding}
          openRunArtifact={openRunArtifact}
          activeHome={activeHome}
          activeRun={activeRun}
          visibleMessages={visibleMessages}
          transcriptRef={transcriptRef}
          busy={busy}
          runStartedAt={runStartedAt}
          runPhaseDetail={runPhaseDetail}
          lastUserId={lastUserId}
          lastAssistantId={lastAssistantId}
          retryLastUser={retryLastUser}
          regenerateLast={regenerateLast}
          openToolPath={openToolPath}
          forceOpenFailedTools={forceOpenFailedTools}
          openMessageArtifact={openMessageArtifact}
        />
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
        onPermission={(d, command) => void decidePermission(d, command)}
        onTrustFolder={
          permissions[0]?.kind === "write" && state?.workspace
            ? () => void trustFolder()
            : undefined
        }
        onEditCommand={
          // PARKED 2026-09-10: deny+prefill unlock. Restore: editGateCommand(detail); decidePermission("deny").
          // In-place Allow: Gate stays; Allow runs the edited command. Do not deny here.
          permissions[0]?.kind === "shell" ? () => {} : undefined
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
        lockedReason={settleLockCopy({
          oauth: Boolean(oauth),
          permissionCount: permissions.length,
          planPending: Boolean(pendingPlanDecision),
          dockOwnedPending: sessionHasDockOwnedPending,
          changeCount: diffQueue.length,
        })}
        productMode={productMode}
        connected={connected}
        onAttachFiles={(files) => void attachFilesToComposer(files)}
        busy={busy}
        onCancel={requestCancel}
        onSend={() => void send()}
        onQueue={queueCurrentDraft}
        onCancelQueued={cancelQueuedDraft}
        queuedCount={queuedDraft && queuedDraft.sessionId === sessionId ? 1 : 0}
        decisionPending={
          decisionPending ||
          permissions.length > 0 ||
          diffQueue.length > 0 ||
          Boolean(pendingPlanDecision) ||
          sessionHasDockOwnedPending
        }
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
  );
}
