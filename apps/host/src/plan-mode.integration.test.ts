import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");
const deterministicAgent = path.resolve(here, "../../../packages/grok-acp/test-support/deterministic-tool-agent.ts");

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function replayUntil(baseUrl: string, sessionId: string, runId: string, predicate: (body: any) => boolean) {
  for (let i = 0; i < 250; i++) {
    const response = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`);
    if (response.ok) {
      const body = await response.json();
      if (predicate(body)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} did not reach expected state`);
}

async function openWorkspace(baseUrl: string, root: string) {
  const opened = await fetch(baseUrl + "/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: root }),
  });
  assert.equal(opened.status, 200, await opened.text());
}

async function engagePlan(baseUrl: string, sessionId: string) {
  const res = await fetch(baseUrl + "/api/plan-engagement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, engaged: true }),
  });
  const raw = await res.text();
  assert.equal(res.status, 200, raw);
  const state = JSON.parse(raw) as { planEngagement: { engaged: boolean; vouched: boolean } };
  assert.deepEqual(state.planEngagement, { engaged: true, vouched: true });
}

async function admit(baseUrl: string, sessionId: string, text: string) {
  const response = await fetch(baseUrl + "/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text, effort: "auto", history: [] }),
  });
  const raw = await response.text();
  assert.equal(response.status, 202, raw);
  return JSON.parse(raw) as { run: { runId: string; executionPhase: string } };
}

function latestPlan(body: any) {
  let plan = null;
  for (const event of body.events ?? []) {
    if (event.type === "plan_record") plan = event.payload.plan;
  }
  return plan;
}

function latestPlanDecision(body: any) {
  let request = null;
  for (const event of body.events ?? []) {
    if (event.type === "decision_request" && event.payload.request.kind === "plan") request = event.payload.request;
  }
  return request;
}

function writeMembers(body: any) {
  const map = new Map<string, any>();
  for (const event of body.events ?? []) {
    if (event.type !== "activity_update") continue;
    const activity = event.payload.activity;
    if (typeof activity.editId === "string" && activity.editId) map.set(activity.editId, activity);
  }
  return [...map.values()];
}

test("GET /api/state always includes planEngagement; Chat cannot arm", async () => {
  const host = await startHost({ port: await freePort(), env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" } });
  try {
    const state = await (await fetch(host.baseUrl + "/api/state")).json() as any;
    assert.equal(typeof state.planEngagement?.engaged, "boolean");
    assert.equal(typeof state.planEngagement?.vouched, "boolean");
    const chat = await fetch(host.baseUrl + "/api/plan-engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engaged: true }),
    });
    assert.equal(chat.status, 400);
    const body = await chat.json() as any;
    assert.equal(body.code, "plan_not_applicable");
  } finally {
    await host.stop();
  }
});

test("E1 composer Plan POST without sessionId still plans the shell-session prompt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plan-int-e1-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const composer = await fetch(host.baseUrl + "/api/plan-engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engaged: true }),
    });
    assert.equal(composer.status, 200, await composer.text());
    const singleton = await (await fetch(host.baseUrl + "/api/state")).json() as { planEngagement: { engaged: boolean } };
    assert.equal(singleton.planEngagement.engaged, true);
    const admitted = await admit(host.baseUrl, "shellplan1", "plan this");
    assert.equal(admitted.run.executionPhase, "plan");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plan-phase write is not_executed and creates no File changes members", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plan-int-write-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: deterministicAgent, XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "planwrite01";
    await engagePlan(host.baseUrl, sessionId);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-edit");
    assert.equal(admitted.run.executionPhase, "plan");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      (body.events ?? []).some((event: any) => event.type === "activity_update" && event.payload.activity.execution === "not_executed"),
    );
    const refused = (replay.events ?? []).filter((event: any) => event.type === "activity_update" && event.payload.activity.execution === "not_executed");
    assert.ok(refused.length >= 1, JSON.stringify(replay.events?.map((e: any) => e.type)));
    assert.equal(writeMembers(replay).length, 0);
    await assert.rejects(() => fs.stat(path.join(root, "trusted.txt")));
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("empty ready zero-member plan and Accept clears engagement", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plan-int-empty-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "plan-empty", XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "planempty1";
    await engagePlan(host.baseUrl, sessionId);
    const admitted = await admit(host.baseUrl, sessionId, "plan empty");
    assert.equal(admitted.run.executionPhase, "plan");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => {
      const plan = latestPlan(body);
      return plan?.status === "ready" && latestPlanDecision(body)?.status === "pending";
    });
    const plan = latestPlan(replay);
    assert.equal(plan.status, "ready");
    assert.equal(plan.proposedMembers.length, 0);
    const decision = latestPlanDecision(replay);
    assert.equal(decision.expiresAt, null);
    const accepted = await fetch(host.baseUrl + "/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId: admitted.run.runId,
        requestId: decision.requestId,
        invocationId: decision.invocationId,
        connectionGeneration: replay.run.connectionGeneration,
        action: "accept",
      }),
    });
    assert.equal(accepted.status, 200, await accepted.text());
    const state = await (await fetch(`${host.baseUrl}/api/state?sessionId=${sessionId}`)).json() as any;
    assert.deepEqual(state.planEngagement, { engaged: false, vouched: true });
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("E1 Accept plan does not keep composer Plan on for a later shell session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plan-int-e1-next-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "plan-empty", XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "planfirst1";
    await engagePlan(host.baseUrl, sessionId);
    const admitted = await admit(host.baseUrl, sessionId, "plan empty");
    assert.equal(admitted.run.executionPhase, "plan");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => {
      const plan = latestPlan(body);
      return plan?.status === "ready" && latestPlanDecision(body)?.status === "pending";
    });
    const decision = latestPlanDecision(replay);
    const accepted = await fetch(host.baseUrl + "/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId: admitted.run.runId,
        requestId: decision.requestId,
        invocationId: decision.invocationId,
        connectionGeneration: replay.run.connectionGeneration,
        action: "accept",
      }),
    });
    assert.equal(accepted.status, 200, await accepted.text());
    const later = await admit(host.baseUrl, "planlater1", "execute now");
    assert.equal(later.run.executionPhase, "execute");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("unvouched Code prompt is 409 plan_engagement_unvouched and creates no run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plan-int-unv-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture", GROKFORGE_PLAN_UNVOUCHED: "1" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "planunvouch";
    const mutation = await fetch(host.baseUrl + "/api/plan-engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, engaged: true }),
    });
    const mutationBody = await mutation.json() as any;
    assert.equal(mutation.status, 409);
    assert.equal(mutationBody.code, "plan_engagement_unvouched");
    const refused = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text: "should not run", effort: "auto" }),
    });
    const body = await refused.json() as any;
    assert.equal(refused.status, 409);
    assert.equal(body.code, "plan_engagement_unvouched");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reconnect restores plan_record from the owned run journal", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "plan-int-re-"));
  const root = path.join(home, "ws");
  await fs.mkdir(root);
  const sessionId = "planreconn1";
  const first = await startHost({
    port: await freePort(),
    homeDir: home,
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "plan-multi", XAI_API_KEY: "fixture" },
  });
  let runId = "";
  try {
    await openWorkspace(first.baseUrl, root);
    await engagePlan(first.baseUrl, sessionId);
    const admitted = await admit(first.baseUrl, sessionId, "plan multi");
    runId = admitted.run.runId;
    await replayUntil(first.baseUrl, sessionId, runId, (body) => latestPlan(body)?.status === "ready");
  } finally {
    await first.stopProcess();
  }
  const second = await startHost({
    port: await freePort(),
    homeDir: home,
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "plan-multi", XAI_API_KEY: "fixture" },
  });
  try {
    const replay = await (await fetch(`${second.baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`)).json() as any;
    assert.equal(replay.run.executionPhase, "plan");
    const plan = latestPlan(replay);
    assert.equal(plan.status, "ready");
    assert.equal(plan.proposedMembers.length, 2);
  } finally {
    await second.stop();
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
