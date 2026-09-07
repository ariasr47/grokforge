import { useCallback, useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ProductMode } from "../lib/api";
import type { InstallerShaVoucher } from "../lib/installerHonesty";
import { isPackagedWindowsInstallerSession, SETTINGS_UNSIGNED_LINE } from "../lib/installerHonesty";
import { channelBadge } from "../lib/api";
import type { PaletteMode, PaletteSessionRow } from "../composer/CommandPalette";
import type { WorkspaceNode } from "../chrome/Sidebar";
import {
  type HomeChatHome,
  type HomeFooterFacts,
  type HomeNeedsYouItem,
  type HomeRecentWorkspace,
} from "../surfaces/HomeScreen";
import {
  chatListTitle,
  isExpanded,
  listNeedsYou,
  listPinnedWorkspaces,
  listSessions,
  partitionKey,
  truncatePreviewText,
  workspaceDisplayName,
  type ChatSession,
} from "../lib/sessions";

export interface UseHomeScreenDataParams {
  /** Trigger-only in every memo below (each one re-reads
   *  listPinnedWorkspaces()/listSessions() fresh rather than using this
   *  array's contents) — present purely so "the session store changed"
   *  recomputes them, the same role it already played in App.tsx. */
  sessionList: ChatSession[];
  /** Same trigger-only role as sessionList, for the pinned/expanded
   *  workspace tree changing. */
  expandTick: number;
  productMode: ProductMode;
  /**
   * Not part of the brief's literal input list. treeWorkspaces and the
   * branch-refresh effect (both moved into this hook) read/write
   * pinnedPaths directly, but the brief's "Moves:" line does not include
   * the pinnedPaths useState itself — it stays declared in App.tsx (its
   * setter is also called from App.tsx's own refreshTree, outside this
   * move), threaded through here as the real value/setter rather than
   * re-derived — same principle as Task 7/8's ref and setter findings.
   */
  pinnedPaths: string[];
  setPinnedPaths: Dispatch<SetStateAction<string[]>>;
  /**
   * Read by treeWorkspaces. The underlying useState stays in App.tsx —
   * other call sites (switchSession, the JSX Sidebar prop) read/write it
   * too.
   */
  branchMap: Record<string, string | null>;
  /**
   * Read by chatSessions only, among the nine memos. App.tsx's own
   * sessionPartition memo stays put (dozens of other call sites need it)
   * and is threaded through here as the real value.
   */
  sessionPartition: string;
  /** state?.workspace. Extracted to a scalar rather than passing the whole
   *  PublicState object, since treeWorkspaces is the only moved memo that
   *  reads it. Typed to match the optional-chained access itself (not
   *  PublicState's own non-optional `workspace: string | null`), so the
   *  call site can pass `state?.workspace` verbatim with no `?? null`
   *  coalescing. */
  workspace: string | null | undefined;
  /** state?.chatRoot. Same rationale as workspace. */
  chatRoot: string | null | undefined;
  /**
   * Read by both needsYouReasonsKey (its serialized form) and homeNeedsYou
   * (the raw per-id reason lookup). The underlying useMemo stays in
   * App.tsx — the separate, unmoved needs-you-toast effect depends on it
   * too.
   */
  needsYouReasons: Record<string, "approve" | "question">;
  /**
   * Every run's vouched final answer, keyed by runId (runReducer.ts's
   * vouchedAnswersByRunId — the same notion of "the reply"
   * promptSendHistory.ts's foldRunAnswersIntoHistory already relies on).
   * homeChatHomes is the one reader: a v1 run's reply never lands in
   * `messages` (that helper's own doc comment), so a chat home's preview
   * needs this to show Grok's actual answer instead of the operator's own
   * last prompt. Read only by homeChatHomes (via chatHomePreview) and
   * vouchedRunAnswersKey (its serialized form) — same two-reader shape as
   * needsYouReasons/needsYouReasonsKey just above.
   */
  vouchedRunAnswers: Record<string, string>;
  buildInfo: {
    version?: string;
    channel?: string;
    channelLabel?: string;
    installerShaVoucher: InstallerShaVoucher;
  } | null;
  /**
   * Brief names this "authLabel"; App.tsx's own local is railAuthLabel —
   * same value, renamed at the call boundary the same way Task 8 renamed
   * state?.skillsCatalog to skillsCatalog (task-8-report.md).
   */
  authLabel: string;
  /**
   * The branch-refresh effect (moved into this hook) calls this directly.
   * Defined in App.tsx via useCallback; not part of this move (App.tsx has
   * its own other call sites for it) — passed through as the real function
   * rather than re-implemented here.
   */
  refreshBranches: (paths: string[]) => Promise<void>;
  /**
   * homeOnFieldQuery/homeOnAllSessions (moved into this hook) call this
   * directly. Not part of this move — App.tsx has several other call sites
   * for the same store action — passed through as the real function.
   */
  openPalette: (mode: PaletteMode, query?: string) => void;
  /**
   * homeOnOpenFolder (moved into this hook) calls this directly. Defined in
   * App.tsx via useCallback, not part of this move — its own dependencies
   * (pickFolderNative/setPathInput/openPath) are App.tsx-only concerns this
   * hook has no other reason to take on.
   */
  browseFolder: () => Promise<void>;
  /**
   * homeOnOpenChatHome (moved into this hook) calls this directly. Defined
   * in App.tsx via useCallback, not part of this move — its own
   * dependencies (productMode/switchMode/switchSession) extend well beyond
   * Home.
   */
  openHomeSession: (workspace: string, id: string) => void;
}

export interface UseHomeScreenDataResult {
  treeWorkspaces: WorkspaceNode[];
  chatSessions: ChatSession[];
  homeChatPartition: string;
  /**
   * Returned because the brief specifies this hook returns "the nine
   * memos". App.tsx does not destructure this at its call site — nothing
   * outside homeNeedsYou's own dependency array reads it, and
   * apps/shell/tsconfig.json's noUnusedLocals would fail on an unused
   * destructured binding — but it is available to any future caller.
   */
  needsYouReasonsKey: string;
  homeNeedsYou: HomeNeedsYouItem[];
  homeRecentWorkspaces: HomeRecentWorkspace[];
  paletteSessions: PaletteSessionRow[];
  homeChatHomes: HomeChatHome[];
  homeFooter: HomeFooterFacts;
  homeOnOpenFolder: () => void;
  homeOnFieldQuery: (text: string) => void;
  homeOnAllSessions: () => void;
  homeOnOpenChatHome: (id: string) => void;
}

/**
 * homeChatHomes's own preview rule (fix/home-preview-run-reply): same
 * backward walk as sessions.ts's chatSessionPreview — the most recent
 * non-empty entry in `sess.messages` — but at each step, a `user` message
 * that started a run (`projectedRunId`) prefers that run's vouched answer
 * from `vouchedRunAnswers` over its own stored content, mirroring
 * promptSendHistory.ts's foldRunAnswersIntoHistory (same per-message rule:
 * `role === "user" && projectedRunId`, same runId -> answer lookup) rather
 * than inventing a second notion of "the reply". A Contract v1 run's reply
 * never lands in `messages` itself (that helper's own doc comment), so
 * without this a chat home's preview is stuck on the operator's own last
 * prompt even after Grok has actually answered.
 *
 * Degrades to the plain message text — today's behavior — whenever there
 * is nothing to prefer: no run bound yet, the run is still streaming (no
 * terminal event means no entry in vouchedRunAnswers yet), or the run
 * ended without a vouched answer (failed/cancelled). Never shows partial
 * streamed text as if it were the reply.
 */
function chatHomePreview(
  sess: ChatSession,
  vouchedRunAnswers: Record<string, string>,
): string | null {
  for (let i = sess.messages.length - 1; i >= 0; i -= 1) {
    const m = sess.messages[i]!;
    if (m.role === "user" && m.projectedRunId) {
      const answer = vouchedRunAnswers[m.projectedRunId]?.trim();
      if (answer) return truncatePreviewText(answer);
    }
    const flat = truncatePreviewText(m.content);
    if (flat) return flat;
  }
  return null;
}

/**
 * Home screen data — moved verbatim out of App.tsx (Task 9): the
 * branch-refresh effect, the nine memos it and the rest of Home's data feed
 * (treeWorkspaces, chatSessions, homeChatPartition, needsYouReasonsKey,
 * homeNeedsYou, homeRecentWorkspaces, paletteSessions, homeChatHomes,
 * homeFooter), and the four `homeOn*` stable wrapper callbacks. Home is a
 * cross-mode launcher (not gated by productMode the way the Code tree and
 * Chat sessions list are), so most of these read the session store fresh
 * via listPinnedWorkspaces()/listSessions() rather than reusing the
 * mode-gated values.
 *
 * `homeChatHomes` was briefly parked at `useMemo(() => [], [])` after a
 * machine crash mid-development, not because the projection was wrong — see
 * .superpowers/sdd/crash-diagnosis.md. It was un-parked in commit
 * e2a944b ("fix(shell): populate chat homes on Home; seed the palette from
 * its field") once the real cause (a node:assert call on a live DOM node,
 * elsewhere in the test suite) was fixed. What is moved here is that real,
 * un-parked derivation — confirmed via `git log` before touching it.
 *
 * `browseFolder` and `openHomeSession`, which the `homeOn*` wrappers call,
 * are NOT part of this move (the brief's "Moves:" line does not name them,
 * and both have their own dependencies — pickFolderNative/openPath and
 * productMode/switchMode/switchSession respectively — that reach well
 * beyond Home) — passed through as parameters instead, same principle as
 * Task 7's ref-passthrough finding.
 */
export function useHomeScreenData({
  sessionList,
  expandTick,
  productMode,
  pinnedPaths,
  setPinnedPaths,
  branchMap,
  sessionPartition,
  workspace,
  chatRoot,
  needsYouReasons,
  vouchedRunAnswers,
  buildInfo,
  authLabel,
  refreshBranches,
  openPalette,
  browseFolder,
  openHomeSession,
}: UseHomeScreenDataParams): UseHomeScreenDataResult {
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
      : workspace
        ? [workspace]
        : [];
    return paths.map((path) => ({
      path,
      name: workspaceDisplayName(path),
      branch: branchMap[path] ?? null,
      sessions: listSessions(path),
      expanded: isExpanded(path),
      active: path === workspace,
    }));
  }, [
    productMode,
    pinnedPaths,
    branchMap,
    workspace,
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
    () => partitionKey("chat", chatRoot),
    [chatRoot],
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

  // Same reference-vs-value problem as needsYouReasonsKey above, for the
  // same reason: vouchedRunAnswers is rebuilt (new object) from
  // runProjection on every streamed token, but a run only ever gains a
  // vouched answer once, at its own terminal event. Depend on the
  // serialized value so homeChatHomes doesn't recompute on every token of
  // some unrelated live run.
  const vouchedRunAnswersKey = useMemo(
    () =>
      Object.entries(vouchedRunAnswers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, answer]) => `${id}:${answer}`)
        .join(","),
    [vouchedRunAnswers],
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
          preview: chatHomePreview(s, vouchedRunAnswers),
          updatedAt: s.updatedAt,
        }),
      )
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, expandTick, homeChatPartition, vouchedRunAnswersKey]);

  const homeFooter: HomeFooterFacts = useMemo(
    () => ({
      version: buildInfo?.version ?? null,
      installerWarning: isPackagedWindowsInstallerSession()
        ? SETTINGS_UNSIGNED_LINE
        : null,
      authLabel: authLabel,
      channel: channelBadge(),
      isPackagedWindows: isPackagedWindowsInstallerSession(),
    }),
    [buildInfo?.version, authLabel],
  );

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

  return {
    treeWorkspaces,
    chatSessions,
    homeChatPartition,
    needsYouReasonsKey,
    homeNeedsYou,
    homeRecentWorkspaces,
    paletteSessions,
    homeChatHomes,
    homeFooter,
    homeOnOpenFolder,
    homeOnFieldQuery,
    homeOnAllSessions,
    homeOnOpenChatHome,
  };
}
