import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "./session.js";

const policy: any = {
  workspace: "C:\\workspace",
  storedMode: null,
  effectiveMode: "review",
  source: "fallback",
  revision: "r",
  fallbackReason: "missing",
  snapshottedAt: new Date().toISOString(),
};

test("allow_session for write is remembered on the host after ACP reclaim", async () => {
  const promptOpts: Array<Record<string, unknown>> = [];
  const s = Object.create(AgentSession.prototype) as any;
  s.client = {
    respondPermission: async () => {},
    prompt: async (_sid: string, _text: string, opts: Record<string, unknown>) => {
      promptOpts.push(opts);
    },
  };
  s.sessionId = "acp";
  s.sessionWriteGrant = false;
  s.sessionShellGrant = false;
  s.pendingDecisions = new Map([["request", {
    sessionId: "stable",
    runId: "run",
    generation: 1,
    invocationId: "inv",
    kind: "permission",
    permissionKind: "write",
    status: "pending",
    expiresAt: 0,
  }]]);
  s.runCoordinator = {
    get: () => ({ sessionId: "stable", runId: "run", state: "running", connectionGeneration: 1, policy }),
    appendOwnedEvent: async () => {},
  };
  s.getRun = (runId: string, sessionId: string) =>
    runId === "run" && sessionId === "stable" ? s.runCoordinator.get() : undefined;

  await s.permission("request", "allow_session", {
    sessionId: "stable",
    runId: "run",
    connectionGeneration: 1,
  }, "inv");
  assert.equal(s.sessionWriteGrant, true);
  assert.equal(s.sessionShellGrant, false);
});

test("allow_session for shell is remembered on the host after ACP reclaim", async () => {
  const s = Object.create(AgentSession.prototype) as any;
  s.client = { respondPermission: async () => {} };
  s.sessionId = "acp";
  s.sessionWriteGrant = false;
  s.sessionShellGrant = false;
  s.pendingDecisions = new Map([["request", {
    sessionId: "stable",
    runId: "run",
    generation: 1,
    invocationId: "inv",
    kind: "permission",
    permissionKind: "shell",
    status: "pending",
    expiresAt: 0,
  }]]);
  s.runCoordinator = {
    get: () => ({ sessionId: "stable", runId: "run", state: "running", connectionGeneration: 1, policy }),
    appendOwnedEvent: async () => {},
  };
  s.getRun = (runId: string, sessionId: string) =>
    runId === "run" && sessionId === "stable" ? s.runCoordinator.get() : undefined;

  await s.permission("request", "allow_session", {
    sessionId: "stable",
    runId: "run",
    connectionGeneration: 1,
  }, "inv");
  assert.equal(s.sessionShellGrant, true);
  assert.equal(s.sessionWriteGrant, false);
});

test("terminal cancel settles leftover permission/diff and drops them from the map", async () => {
  const appended: unknown[] = [];
  const s = Object.create(AgentSession.prototype) as any;
  s.pendingDecisions = new Map([
    ["perm", {
      sessionId: "stable",
      runId: "run",
      generation: 1,
      invocationId: "perm",
      kind: "permission",
      permissionKind: "write",
      status: "pending",
      expiresAt: 0,
    }],
    ["diff", {
      sessionId: "stable",
      runId: "run",
      generation: 1,
      invocationId: "diff",
      kind: "diff",
      status: "pending",
      expiresAt: 0,
    }],
    ["plan", {
      sessionId: "stable",
      runId: "run",
      generation: 1,
      invocationId: "plan",
      kind: "plan",
      status: "pending",
      expiresAt: 0,
    }],
  ]);
  s.runCoordinator = {
    get: () => ({ sessionId: "stable", runId: "run", state: "running", connectionGeneration: 1, policy }),
    appendOwnedEvent: async (_runId: string, payload: unknown) => {
      appended.push(payload);
    },
  };
  await s.cancelPendingToolDecisions("run");
  assert.equal(s.pendingDecisions.has("perm"), false);
  assert.equal(s.pendingDecisions.has("diff"), false);
  assert.equal(s.pendingDecisions.get("plan")?.status, "pending");
  assert.equal(appended.length, 2);
});

test("Trusted workspace can be saved while a run is waiting on a permission", async () => {
  const s = Object.create(AgentSession.prototype) as any;
  s.activeRunId = "run";
  s.workspace = "C:\\workspace";
  s.policyView = null;
  s.emit = () => {};
  s.getState = () => ({});
  s.runCoordinator = { get: () => ({ state: "running" }) };
  let savedMode: string | null = null;
  s.workspacePolicies = {
    save: async (_workspace: string, mode: "review" | "trusted_workspace") => {
      savedMode = mode;
      return { ...policy, storedMode: mode, effectiveMode: mode, source: "stored" };
    },
  };
  const view = await s.saveWorkspacePolicy("C:\\workspace", "trusted_workspace");
  assert.equal(savedMode, "trusted_workspace");
  assert.equal(view.effectiveMode, "trusted_workspace");
});
