import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession } from "./session.js";
import { RunCoordinator } from "./run-coordinator.js";
import { RunJournal } from "./run-journal.js";

function harness() {
  const s = Object.create(AgentSession.prototype) as AgentSession;
  Object.assign(s, {
    cfg: { mode: "code", effort: "auto", model: "grok-4.6", recent: [], lastWorkspace: null, apiKey: "", modelSelectionProvenance: "inherited", modelMigrationVersion: 1, shellAllowlist: true, chatRoot: null, agentId: "grok-acp" },
    planEngaged: false,
    planEngagementVouched: true,
    pendingDecisions: new Map(),
    listeners: new Set(),
    workspace: "C:\\workspace",
    client: null,
    busy: false,
    sessionId: "acp",
    appliedEffort: null,
    appliedModel: null,
    executionEnvironment: { publicView: { status: "available", platform: "win32", osFamily: "windows", executable: "cmd", displayName: "cmd", dialect: "cmd", reasonCode: null, reason: null } },
    stableClientSessionId: "planadmit01",
    activeRunId: null,
    policyView: null,
    bypassActive: false,
    lastReadyPlanRunId: null,
  });
  return s;
}

const policy = {
  workspace: "C:\\workspace",
  storedMode: null,
  effectiveMode: "review" as const,
  source: "fallback" as const,
  revision: "r",
  fallbackReason: "missing" as const,
  snapshottedAt: new Date().toISOString(),
};
const model = { requestedModel: "grok-4.6", appliedModel: "grok-4.6", selectionProvenance: "inherited" as const };

test("engaged+vouched Code admit snapshots executionPhase plan", async () => {
  const s = harness();
  s.setPlanEngagement(true);
  assert.equal(s.resolveExecutionPhaseForAdmit("code"), "plan");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-admit-phase-"));
  try {
    const coordinator = new RunCoordinator(new RunJournal(dir));
    const run = await coordinator.admit({
      sessionId: "planadmit01",
      prompt: "plan this",
      connectionGeneration: 1,
      policy,
      model,
      executionPhase: s.resolveExecutionPhaseForAdmit("code"),
    });
    assert.equal(run.executionPhase, "plan");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("disengaged+vouched Code admit snapshots executionPhase execute", async () => {
  const s = harness();
  assert.equal(s.resolveExecutionPhaseForAdmit("code"), "execute");
});

test("unvouched Code prompt → 409 plan_engagement_unvouched; no run", () => {
  const s = harness();
  s.setPlanEngagementVouched(false);
  assert.throws(
    () => s.resolveExecutionPhaseForAdmit("code"),
    (e: unknown) => (e as { code?: string }).code === "plan_engagement_unvouched",
  );
  assert.equal(s.getActiveRunId(), null);
});

test("pending plan decision → 409 plan_decision_pending", () => {
  const s = harness();
  (s as unknown as { pendingDecisions: Map<string, unknown> }).pendingDecisions.set("plan-req", {
    sessionId: "planadmit01",
    runId: "run",
    generation: 1,
    invocationId: "plan-req",
    kind: "plan",
    status: "pending",
    expiresAt: 0,
  });
  assert.throws(
    () => s.resolveExecutionPhaseForAdmit("code"),
    (e: unknown) => (e as { code?: string }).code === "plan_decision_pending",
  );
});

test("unvouched wins over pending when both would apply", () => {
  const s = harness();
  (s as unknown as { pendingDecisions: Map<string, unknown> }).pendingDecisions.set("plan-req", {
    sessionId: "planadmit01",
    runId: "run",
    generation: 1,
    invocationId: "plan-req",
    kind: "plan",
    status: "pending",
    expiresAt: 0,
  });
  s.setPlanEngagementVouched(false);
  assert.throws(
    () => s.resolveExecutionPhaseForAdmit("code"),
    (e: unknown) => (e as { code?: string }).code === "plan_engagement_unvouched",
  );
});

test("arm during live execute-phase run does not flip that run.executionPhase", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-admit-live-"));
  try {
    const coordinator = new RunCoordinator(new RunJournal(dir));
    const run = await coordinator.admit({
      sessionId: "planadmit01",
      prompt: "execute first",
      connectionGeneration: 1,
      policy,
      model,
      executionPhase: "execute",
    });
    const s = harness();
    (s as unknown as { runCoordinator: RunCoordinator }).runCoordinator = coordinator;
    s.setPlanEngagement(true);
    assert.equal(coordinator.get(run.runId)?.executionPhase, "execute");
    assert.equal(s.resolveExecutionPhaseForAdmit("code"), "plan");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
