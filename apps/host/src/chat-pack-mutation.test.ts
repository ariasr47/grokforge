import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type PublicState } from "./session.js";
import { emptyChatPackView } from "./chat-pack.js";

function harness(mode: "chat" | "code", workspace: string) {
  const s = Object.create(AgentSession.prototype) as AgentSession;
  Object.assign(s, {
    cfg: {
      mode,
      effort: "auto",
      model: "grok-4.6",
      recent: [],
      lastWorkspace: null,
      apiKey: "",
      modelSelectionProvenance: "inherited",
      modelMigrationVersion: 1,
      shellAllowlist: true,
      chatRoot: mode === "chat" ? workspace : null,
      agentId: "grok-acp",
    },
    workspace,
    client: null,
    busy: false,
    sessionId: null,
    appliedEffort: null,
    appliedModel: null,
    executionEnvironment: {
      publicView: {
        status: "available",
        platform: "win32",
        osFamily: "windows",
        executable: "cmd",
        displayName: "cmd",
        dialect: "cmd",
        reasonCode: null,
        reason: null,
      },
    },
    stableClientSessionId: "chatpack01",
    activeRunId: null,
    policyView: null,
    bypassActive: false,
    planEngaged: false,
    planEngagementVouched: true,
    pendingDecisions: new Map(),
    listeners: new Set(),
    lastReadyPlanRunId: null,
    projectInstructionsCache: { status: "absent", path: null, vouched: true },
    projectInstructionsProbeRoot: null,
    projectInstructionsVouched: true,
    chatPackState: emptyChatPackView(null),
  });
  return s;
}

function codeOf(e: unknown): string | undefined {
  return (e as { code?: string }).code;
}

async function withRoot(fn: (root: string, s: AgentSession) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-mut-"));
  try {
    await fn(root, harness("chat", root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("Code mode chat-pack mutation throws chat_pack_not_applicable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-code-"));
  try {
    const s = harness("code", root);
    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "pin_file",
          path: "ok.txt",
        }),
      (e: unknown) => codeOf(e) === "chat_pack_not_applicable",
    );
    assert.deepEqual(s.getState().chatPack, {
      conversationId: null,
      vouched: true,
      confirmFailed: false,
      members: { files: [], note: null },
      lastAttempt: "ok",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("pin_file success appends relative path, lastAttempt ok, vouched, conversationId set", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    const state = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });
    assert.equal(state.chatPack.conversationId, "home-a");
    assert.equal(state.chatPack.vouched, true);
    assert.equal(state.chatPack.confirmFailed, false);
    assert.equal(state.chatPack.lastAttempt, "ok");
    assert.deepEqual(state.chatPack.members.files, [{ path: "ok.txt" }]);
  });
});

test("duplicate pin of the same relative path is idempotent success", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });
    const again = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });
    assert.equal(again.chatPack.lastAttempt, "ok");
    assert.deepEqual(again.chatPack.members.files, [{ path: "ok.txt" }]);
  });
});

test("6th distinct file throws chat_pack_cap_refused, prior members retained, WS pin_failed", async () => {
  await withRoot(async (root, s) => {
    const states: PublicState[] = [];
    s.on((ev) => {
      if (ev.type === "state") states.push(ev.state);
    });
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(path.join(root, `f${i}.txt`), "x", "utf8");
      await s.applyChatPackMutation({
        sessionId: "chatpack01",
        conversationId: "home-a",
        action: "pin_file",
        path: `f${i}.txt`,
      });
    }
    await fs.writeFile(path.join(root, "f6.txt"), "x", "utf8");
    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "pin_file",
          path: "f6.txt",
        }),
      (e: unknown) => codeOf(e) === "chat_pack_cap_refused",
    );
    const published = states.at(-1)?.chatPack;
    assert.equal(published?.lastAttempt, "pin_failed");
    assert.equal(published?.members.files.length, 5);
    assert.ok(!published?.members.files.some((f) => f.path === "f6.txt"));
    assert.equal(s.getState().chatPack.lastAttempt, "pin_failed");
    assert.equal(s.getState().chatPack.members.files.length, 5);
  });
});

test("outside / missing / binary pin throws chat_pack_pin_refused and retains prior members", async () => {
  await withRoot(async (root, s) => {
    const states: PublicState[] = [];
    s.on((ev) => {
      if (ev.type === "state") states.push(ev.state);
    });
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    await fs.writeFile(path.join(root, "bin.bin"), Buffer.from([0, 1, 2]));
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });

    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "pin_file",
          path: "../escape.txt",
        }),
      (e: unknown) => codeOf(e) === "chat_pack_pin_refused",
    );
    assert.equal(states.at(-1)?.chatPack.lastAttempt, "pin_failed");
    assert.deepEqual(s.getState().chatPack.members.files, [{ path: "ok.txt" }]);

    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "pin_file",
          path: "missing.txt",
        }),
      (e: unknown) => codeOf(e) === "chat_pack_pin_refused",
    );
    assert.deepEqual(s.getState().chatPack.members.files, [{ path: "ok.txt" }]);

    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "pin_file",
          path: "bin.bin",
        }),
      (e: unknown) => codeOf(e) === "chat_pack_pin_refused",
    );
    assert.deepEqual(s.getState().chatPack.members.files, [{ path: "ok.txt" }]);
    assert.equal(s.getState().chatPack.lastAttempt, "pin_failed");
  });
});

test("set_note over 4000 throws chat_pack_cap_refused / note_failed; last note retained", async () => {
  await withRoot(async (root, s) => {
    const states: PublicState[] = [];
    s.on((ev) => {
      if (ev.type === "state") states.push(ev.state);
    });
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "set_note",
      note: "kept",
    });
    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "set_note",
          note: "a".repeat(4001),
        }),
      (e: unknown) => codeOf(e) === "chat_pack_cap_refused",
    );
    assert.equal(states.at(-1)?.chatPack.lastAttempt, "note_failed");
    assert.equal(s.getState().chatPack.members.note, "kept");
    assert.equal(s.getState().chatPack.lastAttempt, "note_failed");
  });
});

test("set_note empty string clears note with lastAttempt ok", async () => {
  await withRoot(async (_root, s) => {
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "set_note",
      note: "kept",
    });
    const cleared = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "set_note",
      note: "",
    });
    assert.equal(cleared.chatPack.members.note, null);
    assert.equal(cleared.chatPack.lastAttempt, "ok");
  });
});

test("unpin_file of a non-member is idempotent ok", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });
    const unpinned = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "unpin_file",
      path: "other.txt",
    });
    assert.equal(unpinned.chatPack.lastAttempt, "ok");
    assert.deepEqual(unpinned.chatPack.members.files, [{ path: "ok.txt" }]);
  });
});

test("clear_pack empties members and sets lastAttempt ok", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "set_note",
      note: "n",
    });
    const cleared = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "clear_pack",
    });
    assert.deepEqual(cleared.chatPack.members, { files: [], note: null });
    assert.equal(cleared.chatPack.lastAttempt, "ok");
    assert.equal(cleared.chatPack.conversationId, "home-a");
    assert.equal(cleared.chatPack.vouched, true);
  });
});

test("clear_note sets note null and lastAttempt ok", async () => {
  await withRoot(async (_root, s) => {
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "set_note",
      note: "n",
    });
    const cleared = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "clear_note",
    });
    assert.equal(cleared.chatPack.members.note, null);
    assert.equal(cleared.chatPack.lastAttempt, "ok");
  });
});

test("unpin_file of a member removes it and resets lastAttempt ok", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "ok.txt",
    });
    const unpinned = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "unpin_file",
      path: "ok.txt",
    });
    assert.deepEqual(unpinned.chatPack.members.files, []);
    assert.equal(unpinned.chatPack.lastAttempt, "ok");
  });
});
