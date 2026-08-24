import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession } from "./session.js";
import { emptyChatPackView } from "./chat-pack.js";

function harness(workspace: string, mode: "chat" | "code" = "chat") {
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

const turn = {
  runId: "run-1",
  sessionId: "chatpack01",
  connectionGeneration: 0,
};

async function withRoot(fn: (root: string, s: AgentSession) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-mat-"));
  try {
    await fn(root, harness(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("vouched empty journals not_included with no prompt section", async () => {
  await withRoot(async (_root, s) => {
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: { files: [], note: null },
    });
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-a",
    });
    assert.equal(result.turn.inclusion, "not_included");
    assert.equal(result.turn.fault, null);
    assert.equal(result.turn.noteIncluded, false);
    assert.equal(result.promptSection, null);
  });
});

test("vouched note+file builds delimited section and included voucher", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "BODY", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: { files: [{ path: "ok.txt" }], note: "n1" },
    });
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-a",
    });
    assert.equal(result.turn.inclusion, "included");
    assert.equal(result.turn.fault, null);
    assert.equal(result.turn.noteIncluded, true);
    assert.deepEqual(result.turn.files, [{ path: "ok.txt" }]);
    assert.ok(result.promptSection);
    assert.equal(result.promptSection!.startsWith("\n\n## Chat pack\n\n"), true);
    assert.match(result.promptSection!, /### Note\n\nn1\n\n/);
    assert.match(result.promptSection!, /### File: `ok\.txt`\n\nBODY\n\n/);
  });
});

test("unvouched send journals unconfirmed and injects none", async () => {
  await withRoot(async (_root, s) => {
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-a",
    });
    assert.equal(result.turn.inclusion, "unconfirmed");
    assert.equal(result.turn.fault, null);
    assert.equal(result.turn.noteIncluded, false);
    assert.equal(result.promptSection, null);
  });
});

test("confirmFailed send journals confirm_failed not unconfirmed", async () => {
  await withRoot(async (_root, s) => {
    (s as unknown as { chatPackState: { conversationId: string; vouched: boolean; confirmFailed: boolean; members: { files: []; note: null }; lastAttempt: "ok" } }).chatPackState = {
      conversationId: "home-a",
      vouched: false,
      confirmFailed: true,
      members: { files: [], note: null },
      lastAttempt: "ok",
    };
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-a",
    });
    assert.equal(result.turn.inclusion, "confirm_failed");
    assert.equal(result.promptSection, null);
  });
});

test("conversationId mismatch is unconfirmed for that home", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "a.txt"), "A", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "pin_file",
      path: "a.txt",
    });
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-b",
    });
    assert.equal(result.turn.inclusion, "unconfirmed");
    assert.equal(result.turn.conversationId, "home-b");
    assert.equal(result.promptSection, null);
  });
});

test("stale path at send is materialization_fault path and withholds note", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "ok.txt"), "BODY", "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: { files: [{ path: "ok.txt" }], note: "secret" },
    });
    await fs.rm(path.join(root, "ok.txt"));
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-a",
    });
    assert.equal(result.turn.inclusion, "materialization_fault");
    assert.equal(result.turn.fault, "path");
    assert.equal(result.turn.noteIncluded, false);
    assert.equal(result.promptSection, null);
    assert.ok(result.turn.files.some((f) => f.path === "ok.txt"));
  });
});

test("file contents over 80000 is materialization_fault over_cap and withholds note", async () => {
  await withRoot(async (root, s) => {
    await fs.writeFile(path.join(root, "big.txt"), "x".repeat(80_001), "utf8");
    await s.applyChatPackMutation({
      sessionId: "chatpack01",
      conversationId: "home-a",
      action: "hydrate",
      members: { files: [{ path: "big.txt" }], note: "n" },
    });
    const result = await s.materializeChatPackForSend({
      ...turn,
      conversationId: "home-a",
    });
    assert.equal(result.turn.inclusion, "materialization_fault");
    assert.equal(result.turn.fault, "over_cap");
    assert.equal(result.turn.noteIncluded, false);
    assert.equal(result.promptSection, null);
  });
});
