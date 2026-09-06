import test from "node:test";
import assert from "node:assert/strict";
import { mergeState, type ChatPackView, type PublicState } from "../lib/api";
import {
  CHAT_PACK_FILE_CAP,
  CHAT_PACK_NOTE_CAP,
  packArmedLabel,
  projectChatPackComposer,
} from "./chatPackComposer";

const HOME = "home-a";

function view(overrides: Partial<ChatPackView> = {}): ChatPackView {
  return {
    conversationId: HOME,
    vouched: true,
    confirmFailed: false,
    members: { files: [], note: null },
    lastAttempt: "ok",
    ...overrides,
  };
}

test("product-named caps", () => {
  assert.equal(CHAT_PACK_FILE_CAP, 5);
  assert.equal(CHAT_PACK_NOTE_CAP, 4000);
});

test("Code → absent_code even with a Chat pack view", () => {
  assert.equal(
    projectChatPackComposer({
      mode: "code",
      connected: true,
      conversationId: HOME,
      chatPack: view({
        members: { files: [{ path: "a.md" }], note: "n" },
      }),
    }).state,
    "absent_code",
  );
});

test("missing chatPack → loading when connected (never invent members)", () => {
  const projection = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: undefined,
  });
  assert.equal(projection.state, "loading");
  assert.equal("fileCount" in projection, false);
});

test("conversationId mismatch ignores previous-home members (A→B)", () => {
  const projection = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: "home-b",
    chatPack: view({
      conversationId: HOME,
      members: { files: [{ path: "from-a.md" }], note: "a note" },
    }),
  });
  assert.equal(projection.state, "loading");
  assert.equal("fileCount" in projection, false);
});

test("mismatch + offline → Reconnect, not A's members", () => {
  assert.equal(
    projectChatPackComposer({
      mode: "chat",
      connected: false,
      conversationId: "home-b",
      chatPack: view({ conversationId: HOME, vouched: true }),
    }).state,
    "offline",
  );
});

test("confirmFailed wins over vouched armed members (hide members)", () => {
  assert.equal(
    projectChatPackComposer({
      mode: "chat",
      connected: true,
      conversationId: HOME,
      chatPack: view({
        confirmFailed: true,
        vouched: false,
        members: { files: [{ path: "a.md" }], note: "n" },
      }),
    }).state,
    "confirm_error",
  );
});

test("unvouched connected → loading even when members are present", () => {
  const projection = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: view({
      vouched: false,
      members: { files: [{ path: "a.md" }], note: null },
    }),
  });
  assert.equal(projection.state, "loading");
  assert.equal("fileCount" in projection, false);
});

test("unvouched offline → offline before empty", () => {
  assert.equal(
    projectChatPackComposer({
      mode: "chat",
      connected: false,
      conversationId: HOME,
      chatPack: view({ vouched: false, lastAttempt: "ok" }),
    }).state,
    "offline",
  );
});

test("hydrate_failed with empty armed is NOT empty (path fail)", () => {
  const projection = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: view({
      lastAttempt: "hydrate_failed",
      members: { files: [], note: null },
    }),
    durableMembers: { files: [{ path: "gone.md" }], note: null },
  });
  assert.equal(projection.state, "hydrate_failed");
  if (projection.state === "hydrate_failed") {
    assert.equal(projection.overCap, false);
    assert.equal(projection.fileCount, 0);
  }
});

test("hydrate_failed + durable over file cap → overCap copy", () => {
  const files = [1, 2, 3, 4, 5, 6].map((n) => ({ path: `f${n}.md` }));
  const projection = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: view({
      lastAttempt: "hydrate_failed",
      members: { files: [], note: null },
    }),
    durableMembers: { files, note: null },
  });
  assert.equal(projection.state, "hydrate_failed");
  if (projection.state === "hydrate_failed") assert.equal(projection.overCap, true);
});

test("pin_failed / note_failed retain prior membership counts", () => {
  const pin = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: view({
      lastAttempt: "pin_failed",
      members: { files: [{ path: "kept.md" }], note: "n" },
    }),
  });
  assert.equal(pin.state, "pin_failed");
  if (pin.state === "pin_failed") {
    assert.equal(pin.fileCount, 1);
    assert.equal(pin.hasNote, true);
  }
  const note = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: view({
      lastAttempt: "note_failed",
      members: { files: [{ path: "kept.md" }], note: "n" },
    }),
  });
  assert.equal(note.state, "note_failed");
});

test("vouched empty + ok → empty; vouched non-empty → armed", () => {
  assert.equal(
    projectChatPackComposer({
      mode: "chat",
      connected: true,
      conversationId: HOME,
      chatPack: view(),
    }).state,
    "empty",
  );
  const armed = projectChatPackComposer({
    mode: "chat",
    connected: true,
    conversationId: HOME,
    chatPack: view({
      members: { files: [{ path: "a.md" }, { path: "b.md" }], note: "hi" },
    }),
  });
  assert.equal(armed.state, "armed");
  if (armed.state === "armed") {
    assert.equal(armed.fileCount, 2);
    assert.equal(armed.hasNote, true);
    assert.equal(packArmedLabel(2, true), "Pack · 2 files · note");
  }
});

test("armed label variants", () => {
  assert.equal(packArmedLabel(3, false), "Pack · 3 files");
  assert.equal(packArmedLabel(0, true), "Pack · note");
  assert.equal(packArmedLabel(1, true), "Pack · 1 files · note");
});

test("mergeState does not invent chatPack when omitted", () => {
  const held = {
    chatPack: view({ members: { files: [{ path: "a.md" }], note: null } }),
  } as PublicState;
  const incoming = { connected: true } as PublicState;
  assert.deepEqual(mergeState(held, incoming).chatPack, held.chatPack);
});
