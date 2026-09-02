import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  createSession,
  listNeedsYou,
  loadSession,
  reloadSessionsFromDisk,
  setSessionNeedsYou,
} from "./sessions";

const WS = "C:\\repo";
const OTHER_WS = "C:\\other";

function resetStore(): void {
  localStorage.clear();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
}

describe("needsYou", () => {
  beforeEach(() => {
    resetStore();
  });

  it("setSessionNeedsYou flips the flag and persists it across reads", () => {
    const s = createSession(WS, "Fix typecheck in apps/shell");
    assert.equal(loadSession(WS, s.id)?.needsYou, undefined);

    setSessionNeedsYou(WS, s.id, true);
    assert.equal(loadSession(WS, s.id)?.needsYou, true);

    setSessionNeedsYou(WS, s.id, false);
    assert.equal(loadSession(WS, s.id)?.needsYou, false);
  });

  it("setSessionNeedsYou on an unknown id is a harmless no-op", () => {
    assert.doesNotThrow(() => setSessionNeedsYou(WS, "no-such-id", true));
    assert.equal(loadSession(WS, "no-such-id"), null);
  });

  it("listNeedsYou returns only flagged sessions, most recently updated first", () => {
    reloadSessionsFromDisk({
      byWorkspace: {
        [WS]: [
          {
            id: "a",
            workspace: WS,
            title: "A — flagged, older",
            messages: [],
            updatedAt: 1000,
            needsYou: true,
            open: true,
          },
          {
            id: "b",
            workspace: WS,
            title: "B — not flagged, newest",
            messages: [],
            updatedAt: 3000,
            needsYou: false,
            open: true,
          },
          {
            id: "c",
            workspace: WS,
            title: "C — flagged, newer",
            messages: [],
            updatedAt: 2000,
            needsYou: true,
            open: true,
          },
        ],
      },
      activeId: {},
      pinned: [WS],
      expanded: [WS],
    });

    const list = listNeedsYou(WS);
    assert.deepEqual(
      list.map((s) => s.id),
      ["c", "a"],
    );
    assert.ok(list.every((s) => s.needsYou === true));
  });

  it("listNeedsYou is scoped per workspace", () => {
    const s = createSession(WS, "Session in WS");
    setSessionNeedsYou(WS, s.id, true);
    const other = createSession(OTHER_WS, "Session in OTHER_WS");
    setSessionNeedsYou(OTHER_WS, other.id, true);

    assert.deepEqual(
      listNeedsYou(WS).map((x) => x.id),
      [s.id],
    );
    assert.deepEqual(
      listNeedsYou(OTHER_WS).map((x) => x.id),
      [other.id],
    );
  });

  it("listNeedsYou is empty when nothing is flagged", () => {
    createSession(WS, "Plain session");
    assert.deepEqual(listNeedsYou(WS), []);
  });
});
