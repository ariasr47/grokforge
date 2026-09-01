import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { HOME_NAME_PLACEHOLDER } from "./chatPackComposer";
import {
  clearPackMembers,
  commitHomeName,
  createSession,
  chatListTitle,
  defaultSessionTitle,
  flushSessions,
  getLastSessionSaveError,
  listSessions,
  loadSession,
  reloadSessionsFromDisk,
  saveSessionMessages,
  updatePackMembers,
} from "./sessions";

const PART = "chat:__sandbox__";

it("chatListTitle shows auto-title so uncommitted homes are distinguishable", () => {
  assert.equal(
    chatListTitle({
      committedName: false,
      title: "Reply with exactly CHAT-GLANCE-OK and stop. Do not edit files.",
      workspace: PART,
    }),
    "Reply with exactly CHAT-GLANCE-OK and stop. Do not edit files.",
  );
  assert.equal(
    chatListTitle({ committedName: false, title: "New chat", workspace: PART }),
    HOME_NAME_PLACEHOLDER,
  );
  assert.equal(
    chatListTitle({ committedName: true, title: "Atlas", workspace: PART }),
    "Atlas",
  );
});

function resetStore(): void {
  localStorage.clear();
  reloadSessionsFromDisk({
    byWorkspace: {},
    activeId: {},
    pinned: [],
    expanded: [],
  });
}

describe("named-home session durability", () => {
  beforeEach(() => {
    resetStore();
  });

  it("Code folder titles New session; Chat titles New chat", () => {
    assert.equal(defaultSessionTitle("chat:__sandbox__"), "New chat");
    assert.equal(defaultSessionTitle("C:\\Dev\\grokforge"), "New session");
    assert.equal(createSession("C:\\repo").title, "New session");
    assert.equal(createSession("chat:__sandbox__").title, "New chat");
  });

  it("new session defaults committedName false and empty packMembers", () => {
    const s = createSession(PART, "New chat");
    assert.equal(s.committedName, false);
    assert.deepEqual(s.packMembers, { files: [], note: null });
    const loaded = loadSession(PART, s.id);
    assert.equal(loaded?.committedName, false);
    assert.deepEqual(loaded?.packMembers, { files: [], note: null });
  });

  it("auto-title from first user message when committedName is false", () => {
    const s = createSession(PART, "New chat");
    saveSessionMessages(PART, s.id, [
      { id: "u1", role: "user", content: "Please summarize the weekly notes" },
    ]);
    const loaded = loadSession(PART, s.id);
    assert.equal(loaded?.committedName, false);
    assert.equal(loaded?.title, "Please summarize the weekly notes");
  });

  it("saveSessionMessages must not overwrite title when committedName is true", () => {
    const s = createSession(PART, "New chat");
    assert.equal(commitHomeName(PART, s.id, "Atlas"), true);
    saveSessionMessages(
      PART,
      s.id,
      [{ id: "u1", role: "user", content: "this should not become the title" }],
      "this should not become the title",
    );
    const loaded = loadSession(PART, s.id);
    assert.equal(loaded?.committedName, true);
    assert.equal(loaded?.title, "Atlas");
  });

  it("commitHomeName persists immediately including before any model turn", () => {
    const s = createSession(PART, "New chat");
    assert.equal(s.messages.length, 0);
    assert.equal(commitHomeName(PART, s.id, "Keep this"), true);
    const raw = JSON.parse(localStorage.getItem("grokforge.sessions.v2") || "{}") as {
      byWorkspace?: Record<string, Array<{ id: string; title: string; committedName?: boolean }>>;
    };
    const stored = raw.byWorkspace?.[PART]?.find((row) => row.id === s.id);
    assert.equal(stored?.title, "Keep this");
    assert.equal(stored?.committedName, true);
    assert.equal(getLastSessionSaveError(), null);
  });

  it("commitHomeName never flips committedName from auto-title path", () => {
    const s = createSession(PART, "New chat");
    saveSessionMessages(PART, s.id, [
      { id: "u1", role: "user", content: "auto title candidate" },
    ]);
    const loaded = loadSession(PART, s.id);
    assert.equal(loaded?.committedName, false);
    assert.equal(loaded?.title, "auto title candidate");
  });

  it("updatePackMembers and clearPackMembers update durable refs only", () => {
    const s = createSession(PART, "New chat");
    updatePackMembers(PART, s.id, {
      files: [{ path: "notes/brief.md" }],
      note: "operator note",
    });
    let loaded = loadSession(PART, s.id);
    assert.deepEqual(loaded?.packMembers, {
      files: [{ path: "notes/brief.md" }],
      note: "operator note",
    });
    clearPackMembers(PART, s.id);
    loaded = loadSession(PART, s.id);
    assert.deepEqual(loaded?.packMembers, { files: [], note: null });
  });

  it("legacy records without fields migrate to defaults on read", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        [PART]: [
          {
            id: "legacy-1",
            workspace: PART,
            title: "Old home",
            messages: [],
            updatedAt: Date.now(),
            open: true,
          },
        ],
      },
      activeId: { [PART]: "legacy-1" },
      pinned: [PART],
      expanded: [PART],
    });
    const loaded = loadSession(PART, "legacy-1");
    assert.equal(loaded?.committedName, false);
    assert.deepEqual(loaded?.packMembers, { files: [], note: null });
    const listed = listSessions(PART);
    assert.equal(listed[0]?.committedName, false);
    assert.deepEqual(listed[0]?.packMembers, { files: [], note: null });
  });

  it("commitHomeName surfaces persist failure without claiming success", () => {
    const s = createSession(PART, "New chat");
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new Error("quota exceeded");
    };
    try {
      const ok = commitHomeName(PART, s.id, "Will not stick");
      assert.equal(ok, false);
      assert.ok(getLastSessionSaveError());
    } finally {
      Storage.prototype.setItem = orig;
      flushSessions();
    }
  });
});
