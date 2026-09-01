import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession } from "./session.js";
import { RunCoordinator } from "./run-coordinator.js";
import { RunJournal } from "./run-journal.js";
import type { PlanRecord, PolicySnapshot } from "./run-types.js";

const policy: PolicySnapshot = {
  workspace: "C:\\workspace",
  storedMode: null,
  effectiveMode: "review",
  source: "fallback",
  revision: "r",
  fallbackReason: "missing",
  snapshottedAt: new Date().toISOString(),
};
const model = { requestedModel: "grok-4.6", appliedModel: "grok-4.6", selectionProvenance: "inherited" as const };

describe("plan decisions", { concurrency: 1 }, () => {
  async function inFlightPlan(body: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-dec-"));
    const coordinator = new RunCoordinator(new RunJournal(dir));
    const run = await coordinator.admit({
      sessionId: "stable-plan-01",
      prompt: "plan",
      connectionGeneration: 1,
      policy,
      model,
      executionPhase: "plan",
    });
    const s = Object.create(AgentSession.prototype) as AgentSession;
    Object.assign(s, {
      pendingDecisions: new Map(),
      queuedTurnEnd: new Map(),
      planEngaged: true,
      planEngagementVouched: true,
      lastReadyPlanRunId: null,
      runCoordinator: coordinator,
      listeners: new Set(),
      cfg: { mode: "code", effort: "auto", model: "grok-4.6", recent: [], lastWorkspace: null, apiKey: "", modelSelectionProvenance: "inherited", modelMigrationVersion: 1, shellAllowlist: true, chatRoot: null, agentId: "grok-acp" },
      workspace: "C:\\workspace",
      client: null,
      busy: false,
      sessionId: "acp",
      appliedEffort: null,
      appliedModel: null,
      executionEnvironment: { publicView: { status: "available", platform: "win32", osFamily: "windows", executable: "cmd", displayName: "cmd", dialect: "cmd", reasonCode: null, reason: null } },
      stableClientSessionId: "stable-plan-01",
      activeRunId: run.runId,
      policyView: null,
      bypassActive: false,
    });
    await (s as unknown as { settlePlanPhase: (next: unknown, kind: "answered", text: string) => Promise<void> }).settlePlanPhase(run, "answered", body);
    return { s, run, coordinator, dir };
  }

  async function readyPlan(body: string) {
    const h = await inFlightPlan(body);
    await h.coordinator.finalize(h.run.runId, "answered", body);
    return h;
  }

  function pendingId(s: AgentSession): string {
    const map = (s as unknown as { pendingDecisions: Map<string, { kind: string; status: string }> }).pendingDecisions;
    for (const [id, pending] of map) if (pending.kind === "plan" && pending.status === "pending") return id;
    throw new Error("no pending plan");
  }

  async function latestPlan(coordinator: RunCoordinator, sessionId: string, runId: string): Promise<PlanRecord | null> {
    const replayed = await coordinator.replay(sessionId, runId, 0);
    let latest: PlanRecord | null = null;
    for (const event of replayed.events) {
      if (event.payload.kind === "plan_record") latest = event.payload.plan;
    }
    return latest;
  }

  test("accept on in-flight plan finalizes answered and does not mint a second pending", async () => {
    const h = await inFlightPlan("- Update `src/a.ts`\n- Create apps/shell/src/b.tsx");
    try {
      const requestId = pendingId(h.s);
      const settled = await h.s.planAction(requestId, "accept", {
        sessionId: "stable-plan-01",
        runId: h.run.runId,
        connectionGeneration: 1,
      }, requestId);
      assert.equal(settled, "accepted");
      const live = h.coordinator.get(h.run.runId);
      assert.equal(live?.state, "terminal");
      assert.equal(live?.terminalKind, "answered");
      const map = (h.s as unknown as { pendingDecisions: Map<string, { kind: string; status: string }> }).pendingDecisions;
      assert.equal([...map.values()].filter((p) => p.kind === "plan" && p.status === "pending").length, 0);
      assert.equal(h.s.getState().planEngagement.engaged, false);
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("accept clears engagement, applies no edits, settles accepted", async () => {
    const h = await readyPlan("- Update `src/a.ts`\n- Create apps/shell/src/b.tsx");
    try {
      const requestId = pendingId(h.s);
      const settled = await h.s.planAction(requestId, "accept", {
        sessionId: "stable-plan-01",
        runId: h.run.runId,
        connectionGeneration: 1,
      }, requestId);
      assert.equal(settled, "accepted");
      assert.equal(h.s.getState().planEngagement.engaged, false);
      const plan = await latestPlan(h.coordinator, "stable-plan-01", h.run.runId);
      assert.equal(plan?.status, "accepted");
      assert.equal(plan?.proposedMembers.length, 2);
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("keep_planning leaves engagement on, status kept_planning, never declined", async () => {
    const h = await readyPlan("- Update `only.ts`.");
    try {
      const requestId = pendingId(h.s);
      const settled = await h.s.planAction(requestId, "keep_planning", {
        sessionId: "stable-plan-01",
        runId: h.run.runId,
        connectionGeneration: 1,
      }, requestId);
      assert.equal(settled, "kept_planning");
      assert.notEqual(settled, "declined");
      assert.equal(h.s.getState().planEngagement.engaged, true);
      const plan = await latestPlan(h.coordinator, "stable-plan-01", h.run.runId);
      assert.equal(plan?.status, "kept_planning");
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("plan decision does not expire after 5 minutes", async () => {
    const h = await readyPlan("Nothing to change in this workspace.");
    try {
      const requestId = pendingId(h.s);
      const pending = (h.s as unknown as { pendingDecisions: Map<string, { expiresAt: number }> }).pendingDecisions.get(requestId)!;
      pending.expiresAt = Date.now() - 400_000;
      assert.throws(
        () => h.s.resolveExecutionPhaseForAdmit("code"),
        (e: unknown) => (e as { code?: string }).code === "plan_decision_pending",
      );
      const stillPending = (h.s as unknown as { hasPendingPlanDecision: () => boolean }).hasPendingPlanDecision();
      assert.equal(stillPending, true);
      const settled = await h.s.planAction(requestId, "accept", {
        sessionId: "stable-plan-01",
        runId: h.run.runId,
        connectionGeneration: 1,
      }, requestId);
      assert.equal(settled, "accepted");
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("foreign ownership refused", async () => {
    const h = await readyPlan("Update `only.ts`.");
    try {
      const requestId = pendingId(h.s);
      await assert.rejects(
        () => h.s.planAction(requestId, "accept", {
          sessionId: "other-session",
          runId: h.run.runId,
          connectionGeneration: 1,
        }, requestId),
        (e: unknown) => (e as { code?: string }).code === "decision_not_found",
      );
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("disarm via plan-engagement false cancels pending and clears engagement", async () => {
    const h = await readyPlan("Update `only.ts`.");
    try {
      const requestId = pendingId(h.s);
      h.s.setPlanEngagement(false);
      const pending = (h.s as unknown as { pendingDecisions: Map<string, { status: string }> }).pendingDecisions.get(requestId);
      assert.equal(pending?.status, "cancelled");
      assert.equal(h.s.getState().planEngagement.engaged, false);
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("reject/declined action not accepted on /api/plan", async () => {
    const h = await readyPlan("Update `only.ts`.");
    try {
      const requestId = pendingId(h.s);
      await assert.rejects(
        () => (h.s.planAction as (id: string, action: string, o: object, inv: string) => Promise<unknown>)(
          requestId,
          "declined",
          { sessionId: "stable-plan-01", runId: h.run.runId, connectionGeneration: 1 },
          requestId,
        ),
      );
      const pending = (h.s as unknown as { pendingDecisions: Map<string, { status: string }> }).pendingDecisions.get(requestId);
      assert.equal(pending?.status, "pending");
    } finally {
      await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("empty commentary is ready zero members + pending; cancel before ready is cancelled", async () => {
    const empty = await readyPlan("Nothing to change in this workspace.");
    try {
      const plan = await latestPlan(empty.coordinator, "stable-plan-01", empty.run.runId);
      assert.equal(plan?.status, "ready");
      assert.equal(plan?.proposedMembers.length, 0);
      assert.ok(pendingId(empty.s));
    } finally {
      await fs.rm(empty.dir, { recursive: true, force: true }).catch(() => undefined);
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-cancel-"));
    const coordinator = new RunCoordinator(new RunJournal(dir));
    const run = await coordinator.admit({
      sessionId: "stable-plan-01",
      prompt: "plan",
      connectionGeneration: 1,
      policy,
      model,
      executionPhase: "plan",
    });
    const s = Object.create(AgentSession.prototype) as AgentSession;
    Object.assign(s, {
      pendingDecisions: new Map(),
      queuedTurnEnd: new Map(),
      planEngaged: true,
      planEngagementVouched: true,
      lastReadyPlanRunId: null,
      runCoordinator: coordinator,
      listeners: new Set(),
    });
    await (s as unknown as { settlePlanPhase: (next: unknown, kind: "cancelled", text: null) => Promise<void> }).settlePlanPhase(run, "cancelled", null);
    const cancelled = await latestPlan(coordinator, "stable-plan-01", run.runId);
    assert.equal(cancelled?.status, "cancelled");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  test("Keep planning then new ready → prior superseded", async () => {
    const first = await readyPlan("Update `first.ts`.");
    try {
      const requestId = pendingId(first.s);
      await first.s.planAction(requestId, "keep_planning", {
        sessionId: "stable-plan-01",
        runId: first.run.runId,
        connectionGeneration: 1,
      }, requestId);
      const second = await first.coordinator.admit({
        sessionId: "stable-plan-01",
        prompt: "plan again",
        connectionGeneration: 1,
        policy,
        model,
        executionPhase: "plan",
      });
      await (first.s as unknown as { settlePlanPhase: (next: unknown, kind: "answered", text: string) => Promise<void> }).settlePlanPhase(second, "answered", "Update `second.ts`.");
      const prior = await latestPlan(first.coordinator, "stable-plan-01", first.run.runId);
      assert.equal(prior?.status, "superseded");
      const next = await latestPlan(first.coordinator, "stable-plan-01", second.runId);
      assert.equal(next?.status, "ready");
    } finally {
      await fs.rm(first.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
