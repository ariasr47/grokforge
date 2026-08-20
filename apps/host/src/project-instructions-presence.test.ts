import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession } from "./session.js";

function harness(mode: "chat" | "code", workspace: string | null = mode === "code" ? "C:\\workspace" : null) {
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
    stableClientSessionId: "pi-session-01",
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
  });
  return s;
}

test("Code + AGENTS.md → getState.projectInstructions present+path+vouched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-pres-"));
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
    const s = harness("code", root);
    await s.refreshProjectInstructionsPresence();
    const pi = s.getState().projectInstructions;
    assert.equal(pi.status, "present");
    assert.equal(pi.path, "AGENTS.md");
    assert.equal(pi.vouched, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Chat always absent path null vouched true — no disk dependency on recipe files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-chat-"));
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Should not load in Chat\n", "utf8");
    const s = harness("chat", root);
    await s.refreshProjectInstructionsPresence();
    assert.deepEqual(s.getState().projectInstructions, { status: "absent", path: null, vouched: true });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("no workspace → absent vouched; never prior path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-nows-"));
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
    const s = harness("code", root);
    await s.refreshProjectInstructionsPresence();
    assert.equal(s.getState().projectInstructions.path, "AGENTS.md");
    (s as unknown as { workspace: string | null }).workspace = null;
    await s.refreshProjectInstructionsPresence();
    const pi = s.getState().projectInstructions;
    assert.deepEqual(pi, { status: "absent", path: null, vouched: true });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("routine getState after create/empty/delete updates presence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-routine-"));
  try {
    const s = harness("code", root);
    await s.refreshProjectInstructionsPresence();
    assert.equal(s.getState().projectInstructions.status, "absent");

    await fs.writeFile(path.join(root, "AGENTS.md"), "hello\n", "utf8");
    await s.refreshProjectInstructionsPresence();
    assert.equal(s.getState().projectInstructions.status, "present");
    assert.equal(s.getState().projectInstructions.path, "AGENTS.md");

    await fs.writeFile(path.join(root, "AGENTS.md"), "   \n", "utf8");
    await s.refreshProjectInstructionsPresence();
    assert.equal(s.getState().projectInstructions.status, "absent");
    assert.equal(s.getState().projectInstructions.path, null);

    await fs.rm(path.join(root, "AGENTS.md"));
    await s.refreshProjectInstructionsPresence();
    assert.equal(s.getState().projectInstructions.status, "absent");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("unvouched seam → vouched false (does not invent path upgrade)", () => {
  const s = harness("code");
  s.setProjectInstructionsVouched(false);
  const pi = s.getState().projectInstructions;
  assert.equal(pi.vouched, false);
  assert.notEqual(pi.status, "present");
});
