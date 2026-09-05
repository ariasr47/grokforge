import type { RefObject } from "react";
import type { ProductMode, PublicState } from "./api";
import { patchFirstRun, type FirstRunState } from "./firstRun";
import type { ChatSession } from "./sessions";
import {
  isPackagedWindowsInstallerSession,
  type InstallerShaVoucher,
} from "./installerHonesty";
import { MessageList, type ChatMessage } from "./MessageList";
import type { RunProjection, RunProjectionRun } from "./runReducer";
import { catchUpForRun, type CatchUpMap } from "./catchUpWindows";
import { bindingMatchesTurn, type ArtifactOpenBinding } from "./artifactOpenBinding";
import { hostObserveRosterEligible } from "./activityMembership";
import { RETRY_PROMPT_SEND_OPTS } from "./promptSendHistory";
import { Button } from "./ui/Button";
import { EmptyStates } from "./EmptyStates";
import { Onboarding } from "./Onboarding";
import {
  HomeScreen,
  type HomeChatHome,
  type HomeFooterFacts,
  type HomeNeedsYouItem,
  type HomeRecentWorkspace,
} from "./HomeScreen";
import { RunSurface } from "./RunSurface";

export interface TranscriptBodyProps {
  showConversationsNotFound: boolean;
  skillsOpen: boolean;
  atSuggestions: string[];
  /** Matches `exportSessionDiagnostics`'s real signature in App.tsx. */
  exportSessionDiagnostics: () => Promise<void>;
  setNotFoundDismissed: (value: boolean) => void;
  showOnboarding: boolean;
  firstRun: FirstRunState;
  state: PublicState | null;
  productMode: ProductMode;
  browseFolder: () => Promise<void>;
  /** App.tsx's `View` union, inlined the same way Task 5's SettingsView did. */
  setView: (value: "chat" | "settings" | "review") => void;
  /** Only ever called with the updater form in this block — see App.tsx's
   *  `onSetMode`/`onDismiss`. */
  setFirstRun: (updater: (fr: FirstRunState) => FirstRunState) => void;
  switchMode: (mode: ProductMode) => Promise<void>;
  buildInfo: {
    version?: string;
    channel?: string;
    channelLabel?: string;
    installerShaVoucher: InstallerShaVoucher;
  } | null;
  messages: ChatMessage[];
  normalizedRunVisible: boolean;
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
  sessionId: string | null;
  catchUpByRunId: CatchUpMap;
  activeOwnedRunKeys: Set<string>;
  observeHostOwnerSessionId: string | null;
  /** Matches `sendText`'s real signature in App.tsx. */
  sendText: (
    raw: string,
    opts?: { skipUserBubble?: boolean; stripTrailingAssistant?: boolean },
  ) => Promise<boolean>;
  fillComposerFromChoice: (label: string, meta?: string) => void;
  artifactOpenBinding: ArtifactOpenBinding | null;
  openRunArtifact: (runId: string) => void;
  activeHome: ChatSession | null;
  activeRun: RunProjectionRun | null;
  visibleMessages: ChatMessage[];
  transcriptRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  runStartedAt: number | null;
  runPhaseDetail: string | null;
  lastUserId: string | null;
  lastAssistantId: string | null;
  retryLastUser: (id: string, content: string) => void;
  regenerateLast: (userContent: string) => void;
  openToolPath: (path: string) => Promise<void>;
  forceOpenFailedTools: boolean;
  openMessageArtifact: (messageId: string) => void;
}

/**
 * Task 6: the transcript's ladder of five mutually-exclusive states, moved
 * verbatim out of `App()`'s JSX (the `{...}` expression inside the
 * `.transcript` div, between the div itself and the trailing
 * `<div ref={bottomRef} />` — both of which stay in `ChatView`). Precedence,
 * top to bottom: conversations-not-found -> onboarding -> signed-out/Home ->
 * host-offline -> the run stream + `MessageList`. Every prop here is exactly
 * one free identifier the original block read from `App()`'s closure —
 * derived mechanically, the same way Task 5's `SettingsView` was. No hook
 * moved; every `useState`/`useMemo`/`useCallback` this block depends on
 * stays in `App()` at its exact original position — only the render output
 * moved into this component.
 */
export function TranscriptBody({
  showConversationsNotFound,
  skillsOpen,
  atSuggestions,
  exportSessionDiagnostics,
  setNotFoundDismissed,
  showOnboarding,
  firstRun,
  state,
  productMode,
  browseFolder,
  setView,
  setFirstRun,
  switchMode,
  buildInfo,
  messages,
  normalizedRunVisible,
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
  sessionId,
  catchUpByRunId,
  activeOwnedRunKeys,
  observeHostOwnerSessionId,
  sendText,
  fillComposerFromChoice,
  artifactOpenBinding,
  openRunArtifact,
  activeHome,
  activeRun,
  visibleMessages,
  transcriptRef,
  busy,
  runStartedAt,
  runPhaseDetail,
  lastUserId,
  lastAssistantId,
  retryLastUser,
  regenerateLast,
  openToolPath,
  forceOpenFailedTools,
  openMessageArtifact,
}: TranscriptBodyProps) {
  return (
    <>
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
    </>
  );
}
