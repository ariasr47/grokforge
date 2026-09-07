import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderHook } from "@testing-library/react";
import { useHomeScreenData, type UseHomeScreenDataParams } from "./useHomeScreenData";
import { reloadSessionsFromDisk, type ChatSession } from "../lib/sessions";

const WS_A = "C:\\repo-a";
const WS_B = "C:\\repo-b";

function resetStore(): void {
  localStorage.clear();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
}

// Same seeding idiom as sessions.needsYou.test.ts: reloadSessionsFromDisk
// writes straight to the in-memory store so updatedAt/needsYou can be
// pinned exactly, rather than going through createSession/updateSessionMeta
// (both always re-stamp updatedAt to Date.now()). A needsYou:true session
// also needs status:"busy" — reloadSessionsFromDisk runs every session
// through resetStaleNeedsYou, which clears a "stale" (non-busy) needsYou
// flag back to false on load.
function session(
  over: Partial<ChatSession> &
    Pick<ChatSession, "id" | "workspace" | "title" | "updatedAt">,
): ChatSession {
  return { messages: [], ...over };
}

function baseParams(
  over: Partial<UseHomeScreenDataParams> = {},
): UseHomeScreenDataParams {
  return {
    sessionList: [],
    expandTick: 0,
    productMode: "chat",
    pinnedPaths: [],
    setPinnedPaths: () => {},
    branchMap: {},
    sessionPartition: "chat:__sandbox__",
    workspace: null,
    chatRoot: null,
    needsYouReasons: {},
    vouchedRunAnswers: {},
    buildInfo: null,
    authLabel: "Grok · API key",
    refreshBranches: async () => {},
    openPalette: () => {},
    browseFolder: async () => {},
    openHomeSession: () => {},
    ...over,
  };
}

describe("useHomeScreenData", () => {
  beforeEach(() => {
    resetStore();
  });

  it("needs-you ordering: newest-updated first, across pinned workspaces AND the chat home partition", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        [WS_A]: [
          session({
            id: "a1",
            workspace: WS_A,
            title: "A flagged, oldest",
            updatedAt: 1000,
            needsYou: true,
            status: "busy",
          }),
          session({
            id: "a2",
            workspace: WS_A,
            title: "A not flagged",
            updatedAt: 5000,
          }),
        ],
        [WS_B]: [
          session({
            id: "b1",
            workspace: WS_B,
            title: "B flagged, newest",
            updatedAt: 3000,
            needsYou: true,
            status: "busy",
          }),
        ],
        "chat:__sandbox__": [
          session({
            id: "c1",
            workspace: "chat:__sandbox__",
            title: "Chat home flagged, middle",
            updatedAt: 2000,
            needsYou: true,
            status: "busy",
          }),
        ],
      },
      activeId: {},
      pinned: [],
      expanded: [],
    });

    const { result } = renderHook(() =>
      useHomeScreenData(baseParams({ chatRoot: null })),
    );

    assert.deepEqual(
      result.current.homeNeedsYou.map((i) => i.id),
      ["b1", "c1", "a1"],
      "newest-updated flagged session first, spanning both Code workspaces and the Chat home partition",
    );
    assert.equal(
      result.current.homeNeedsYou.some((i) => i.id === "a2"),
      false,
      "unflagged sessions are excluded, not just sorted last",
    );
    assert.equal(result.current.homeNeedsYou[0]?.workspace, WS_B);
    assert.equal(result.current.homeNeedsYou[1]?.workspace, "chat:__sandbox__");
  });

  it("recent-workspace grouping: one row per pinned workspace, keyed to that workspace's own latest session", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        [WS_A]: [
          session({ id: "a-old", workspace: WS_A, title: "A old", updatedAt: 1000 }),
          session({
            id: "a-new",
            workspace: WS_A,
            title: "A new",
            updatedAt: 9000,
            branch: "main",
          }),
        ],
        [WS_B]: [
          session({ id: "b-only", workspace: WS_B, title: "B only", updatedAt: 4000 }),
        ],
      },
      activeId: {},
      pinned: [],
      expanded: [],
    });

    const { result } = renderHook(() => useHomeScreenData(baseParams()));

    assert.equal(
      result.current.homeRecentWorkspaces.length,
      2,
      "one row per workspace, not one row per session",
    );
    const rowA = result.current.homeRecentWorkspaces.find((w) => w.path === WS_A);
    assert.ok(rowA, "workspace A has a row");
    assert.equal(rowA?.lastSessionId, "a-new", "shows the workspace's own latest session, not its oldest");
    assert.equal(rowA?.sessionCount, 2, "counts every session in the workspace, not just the one shown");
    assert.equal(rowA?.branch, "main");
    const rowB = result.current.homeRecentWorkspaces.find((w) => w.path === WS_B);
    assert.ok(rowB, "workspace B has a row");
    assert.equal(rowB?.sessionCount, 1);
    assert.equal(rowB?.branch, null, "omitted, never guessed, when no branch is on record");
  });

  it("footer (house/guest rule): a missing version/channel is omitted, never faked; a real version passes through unchanged", () => {
    const { result, rerender } = renderHook(
      (props: { buildInfo: UseHomeScreenDataParams["buildInfo"] }) =>
        useHomeScreenData(baseParams({ buildInfo: props.buildInfo })),
      {
        initialProps: {
          buildInfo: null as UseHomeScreenDataParams["buildInfo"],
        },
      },
    );

    assert.equal(
      result.current.homeFooter.version,
      null,
      "no buildInfo yet -> omitted, not a placeholder string",
    );
    assert.equal(
      result.current.homeFooter.channel,
      null,
      "no channel override in this environment -> omitted, not a fabricated DEV/TST badge",
    );
    assert.equal(result.current.homeFooter.installerWarning, null);
    assert.equal(result.current.homeFooter.isPackagedWindows, false);
    assert.equal(
      result.current.homeFooter.authLabel,
      "Grok · API key",
      "passed through from the caller, not invented",
    );

    rerender({
      buildInfo: { version: "1.2.3", installerShaVoucher: { status: "pending" } },
    });

    assert.equal(
      result.current.homeFooter.version,
      "1.2.3",
      "a real version flows through unchanged once buildInfo has one",
    );
  });

  // fix/home-preview-run-reply: a Contract v1 run's reply never lands in
  // `messages` (promptSendHistory.ts's foldRunAnswersIntoHistory doc
  // comment), so homeChatHomes must consult vouchedRunAnswers (keyed by the
  // last user message's projectedRunId) rather than only the session store.
  it("chat-home preview: a vouched run answer is shown instead of the operator's own last prompt", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        "chat:__sandbox__": [
          session({
            id: "s1",
            workspace: "chat:__sandbox__",
            title: "Tell me a story",
            updatedAt: 1000,
            messages: [
              { id: "m1", role: "user", content: "Tell me a story", projectedRunId: "run-1" },
            ],
          }),
        ],
      },
      activeId: {},
      pinned: [],
      expanded: [],
    });

    const { result } = renderHook(() =>
      useHomeScreenData(
        baseParams({ vouchedRunAnswers: { "run-1": "Once upon a time, in a far kingdom." } }),
      ),
    );

    const row = result.current.homeChatHomes.find((c) => c.id === "s1");
    assert.ok(row, "expected the seeded session to appear as a chat home");
    assert.equal(
      row?.preview,
      "Once upon a time, in a far kingdom.",
      "preview must show the run's vouched answer, not the operator's own last prompt",
    );
  });

  it("chat-home preview degrades to the operator's last prompt when the run has no vouched answer yet (still streaming, failed, or cancelled)", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        "chat:__sandbox__": [
          session({
            id: "s1",
            workspace: "chat:__sandbox__",
            title: "Tell me a story",
            updatedAt: 1000,
            messages: [
              { id: "m1", role: "user", content: "Tell me a story", projectedRunId: "run-1" },
            ],
          }),
        ],
      },
      activeId: {},
      pinned: [],
      expanded: [],
    });

    // No entry for "run-1" — the same shape as a run that hasn't reached
    // its terminal event yet, or reached one with no vouched answer
    // (failed/cancelled). Must not invent or show partial text either way.
    const { result } = renderHook(() =>
      useHomeScreenData(baseParams({ vouchedRunAnswers: {} })),
    );

    const row = result.current.homeChatHomes.find((c) => c.id === "s1");
    assert.equal(
      row?.preview,
      "Tell me a story",
      "no vouched answer yet -> falls back to the plain last-message preview",
    );
  });

  it("chat-home preview: a session with no run at all still shows its last message, unchanged from before this fix", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        "chat:__sandbox__": [
          session({
            id: "s1",
            workspace: "chat:__sandbox__",
            title: "Hello",
            updatedAt: 1000,
            messages: [{ id: "m1", role: "user", content: "Hello there" }],
          }),
        ],
      },
      activeId: {},
      pinned: [],
      expanded: [],
    });

    const { result } = renderHook(() => useHomeScreenData(baseParams()));

    const row = result.current.homeChatHomes.find((c) => c.id === "s1");
    assert.equal(row?.preview, "Hello there");
  });
});
