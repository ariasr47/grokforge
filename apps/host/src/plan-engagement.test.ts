import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "./session.js";

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
    stableClientSessionId: "plan-session-01",
    activeRunId: null,
    policyView: null,
    bypassActive: false,
    planEngaged: false,
    planEngagementVouched: true,
    pendingDecisions: new Map(),
    listeners: new Set(),
    lastReadyPlanRunId: null,
  });
  return s;
}

test("getState always includes planEngagement; Chat is disengaged+vouched", () => {
  const chat = harness("chat");
  (chat as unknown as { planEngaged: boolean }).planEngaged = true;
  assert.deepEqual(chat.getState().planEngagement, { engaged: false, vouched: true });
});

test("Code POST plan-engagement arms and disarms when vouched", () => {
  const s = harness("code");
  const armed = s.setPlanEngagement(true);
  assert.deepEqual(armed.planEngagement, { engaged: true, vouched: true });
  const disarmed = s.setPlanEngagement(false);
  assert.deepEqual(disarmed.planEngagement, { engaged: false, vouched: true });
});

test("Chat plan-engagement → 400 plan_not_applicable", () => {
  const s = harness("chat");
  assert.throws(() => s.setPlanEngagement(true), (e: unknown) => (e as { code?: string }).code === "plan_not_applicable");
  assert.deepEqual(s.getState().planEngagement, { engaged: false, vouched: true });
});

test("unvouched plan-engagement mutation → 409 plan_engagement_unvouched only", () => {
  const s = harness("code");
  s.setPlanEngagement(true);
  s.setPlanEngagementVouched(false);
  assert.deepEqual(s.getState().planEngagement, { engaged: true, vouched: false });
  assert.throws(() => s.setPlanEngagement(true), (e: unknown) => (e as { code?: string }).code === "plan_engagement_unvouched");
  assert.throws(() => s.setPlanEngagement(false), (e: unknown) => (e as { code?: string }).code === "plan_engagement_unvouched");
  assert.equal(s.getState().planEngagement.engaged, true);
});

test("when vouching returns, engaged clears to false", () => {
  const s = harness("code");
  s.setPlanEngagement(true);
  s.setPlanEngagementVouched(false);
  const restored = s.setPlanEngagementVouched(true);
  assert.deepEqual(restored.planEngagement, { engaged: false, vouched: true });
});

test("idle terminal without a plan dock releases Plan arm", () => {
  const s = harness("code");
  s.setPlanEngagement(true);
  const released = (
    s as unknown as { releasePlanArmIfIdle: () => boolean }
  ).releasePlanArmIfIdle();
  assert.equal(released, true);
  assert.deepEqual(s.getState().planEngagement, { engaged: false, vouched: true });
});

test("pending plan dock keeps Plan arm", () => {
  const s = harness("code");
  s.setPlanEngagement(true);
  (
    s as unknown as { pendingDecisions: Map<string, { kind: string; status: string }> }
  ).pendingDecisions.set("p1", { kind: "plan", status: "pending" });
  const released = (
    s as unknown as { releasePlanArmIfIdle: () => boolean }
  ).releasePlanArmIfIdle();
  assert.equal(released, false);
  assert.deepEqual(s.getState().planEngagement, { engaged: true, vouched: true });
});
