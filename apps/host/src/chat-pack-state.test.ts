import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "./session.js";
import { codeChatPackView } from "./chat-pack.js";

function harness(mode: "chat" | "code") {
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
      chatRoot: null,
      agentId: "grok-acp",
    },
    workspace: mode === "code" ? "C:\\workspace" : null,
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
    stableClientSessionId: "sess-1",
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
    chatPackState: undefined,
  });
  return s;
}

test("Code getState.chatPack is empty vouched null conversationId", () => {
  const s = harness("code");
  assert.deepEqual(s.getState().chatPack, codeChatPackView());
});

test("Chat getState.chatPack always present (default unconfirmed empty members)", () => {
  const s = harness("chat");
  const cp = s.getState().chatPack;
  assert.equal(typeof cp.vouched, "boolean");
  assert.equal(typeof cp.confirmFailed, "boolean");
  assert.ok(Array.isArray(cp.members.files));
  assert.ok("lastAttempt" in cp);
});

test("Code getState does not wipe stored Chat pack", () => {
  const s = harness("code");
  const stored = {
    conversationId: "home-a",
    vouched: true,
    confirmFailed: false,
    members: { files: [{ path: "keep.txt" }], note: "n" },
    lastAttempt: "ok" as const,
  };
  (s as unknown as { chatPackState: typeof stored }).chatPackState = stored;
  assert.deepEqual(s.getState().chatPack, codeChatPackView());
  assert.deepEqual((s as unknown as { chatPackState: typeof stored }).chatPackState, stored);
});
