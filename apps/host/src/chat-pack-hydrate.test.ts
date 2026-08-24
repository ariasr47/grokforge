import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type PublicState } from "./session.js";
import { emptyChatPackView } from "./chat-pack.js";

function harness(workspace: string) {
  const s = Object.create(AgentSession.prototype) as AgentSession;
  Object.assign(s, {
    cfg: {
      mode: "chat",
      effort: "auto",
      model: "grok-4.6",
      recent: [],
      lastWorkspace: null,
      apiKey: "",
      modelSelectionProvenance: "inherited",
      modelMigrationVersion: 1,
      shellAllowlist: true,
      chatRoot: workspace,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-hyd-"));
  try {
    await fn(root, harness(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("hydrate for B immediately yields unconfirmed empty members — no A members", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "a.txt"), "A", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "a.txt",
    });
    const snapshots: PublicState[] = [];
    s.on((ev) => {
      if (ev.type === "state") snapshots.push(ev.state);
    });
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-b",
      action: "hydrate",
      members: { files: [], note: null },
    });
    const first = snapshots[0]?.chatPack;
    assert.equal(first?.conversationId, "home-b");
    assert.equal(first?.vouched, false);
    assert.equal(first?.confirmFailed, false);
    assert.deepEqual(first?.members.files, []);
  });
});

test("hydrate with 3 good text files + note vouches accepted members", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "a.txt"), "A", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "B", "utf8");
    await fs.writeFile(path.join(root, "c.txt"), "C", "utf8");
    const state = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: {
        files: [{ path: "a.txt" }, { path: "b.txt" }, { path: "c.txt" }],
        note: "hello",
      },
    });
    assert.equal(state.chatPack.vouched, true);
    assert.equal(state.chatPack.confirmFailed, false);
    assert.equal(state.chatPack.lastAttempt, "ok");
    assert.equal(state.chatPack.conversationId, "home-a");
    assert.deepEqual(state.chatPack.members.files, [
      { path: "a.txt" },
      { path: "b.txt" },
      { path: "c.txt" },
    ]);
    assert.equal(state.chatPack.members.note, "hello");
  });
});

test("hydrate with one stale path among three drops only the stale path and hydrate_failed", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "a.txt"), "A", "utf8");
    await fs.writeFile(path.join(root, "c.txt"), "C", "utf8");
    const state = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: {
        files: [{ path: "a.txt" }, { path: "gone.txt" }, { path: "c.txt" }],
        note: null,
      },
    });
    assert.equal(state.chatPack.lastAttempt, "hydrate_failed");
    assert.equal(state.chatPack.vouched, true);
    assert.deepEqual(state.chatPack.members.files, [{ path: "a.txt" }, { path: "c.txt" }]);
    assert.ok(!state.chatPack.members.files.some((f) => f.path === "gone.txt"));
  });
});

test("hydrate with 6 file refs throws chat_pack_cap_refused, armed members empty", async () => {
  await withRoot(async (root, s) => {
    const states: PublicState[] = [];
    s.on((ev) => {
      if (ev.type === "state") states.push(ev.state);
    });
    await fs.writeFile(path.join(root, "a.txt"), "A", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "a.txt",
    });
    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-b",
          action: "hydrate",
          members: {
            files: [
              { path: "1.txt" },
              { path: "2.txt" },
              { path: "3.txt" },
              { path: "4.txt" },
              { path: "5.txt" },
              { path: "6.txt" },
            ],
            note: null,
          },
        }),
      (e: unknown) => codeOf(e) === "chat_pack_cap_refused",
    );
    const published = states.at(-1)?.chatPack;
    assert.equal(published?.conversationId, "home-b");
    assert.equal(published?.lastAttempt, "hydrate_failed");
    assert.deepEqual(published?.members.files, []);
    assert.equal(published?.members.note, null);
  });
});

test("hydrate note >4000 throws cap refuse with armed members empty", async () => {
  await withRoot(async (_root, s) => {
    await assert.rejects(
      () =>
        s.applyChatPackMutation({
          sessionId: "chatpack01",
          conversationId: "home-a",
          action: "hydrate",
          members: { files: [], note: "a".repeat(4001) },
        }),
      (e: unknown) => codeOf(e) === "chat_pack_cap_refused",
    );
    const cp = s.getState().chatPack;
    assert.equal(cp.lastAttempt, "hydrate_failed");
    assert.deepEqual(cp.members, { files: [], note: null });
  });
});

test("hydrate empty-string note becomes armed note null", async () => {
  await withRoot(async (_root, s) => {
    const state = await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: { files: [], note: "" },
    });
    assert.equal(state.chatPack.members.note, null);
    assert.equal(state.chatPack.lastAttempt, "ok");
    assert.equal(state.chatPack.vouched, true);
  });
});

test("GROKFORGE_CHAT_PACK_CONFIRM_FAIL=1 yields confirmFailed true and vouched false", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "a.txt"), "A", "utf8");
    const prev = process.env.GROKFORGE_CHAT_PACK_CONFIRM_FAIL;
    process.env.GROKFORGE_CHAT_PACK_CONFIRM_FAIL = "1";
    try {
      const state = await s.applyChatPackMutation({
        sessionId: "chatpack01",
        conversationId: "home-a",
        action: "hydrate",
        members: { files: [{ path: "a.txt" }], note: "n" },
      });
      assert.equal(state.chatPack.confirmFailed, true);
      assert.equal(state.chatPack.vouched, false);
    } finally {
      if (prev === undefined) delete process.env.GROKFORGE_CHAT_PACK_CONFIRM_FAIL;
      else process.env.GROKFORGE_CHAT_PACK_CONFIRM_FAIL = prev;
    }
  });
});
