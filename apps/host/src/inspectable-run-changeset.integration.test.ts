import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost, type StartedHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
function fixtureEnv() {
  return {
    GROKFORGE_AGENT_ENTRY: path.resolve(here, "../../../packages/grok-acp/test-support/deterministic-tool-agent.ts"),
    XAI_API_KEY: "fixture",
  };
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function admit(baseUrl: string, sessionId: string, text: string) {
  const response = await fetch(baseUrl + "/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text, effort: "auto", history: [] }),
  });
  const raw = await response.text();
  assert.equal(response.status, 202, `${text}: ${raw}`);
  return JSON.parse(raw) as { run: { runId: string } };
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

function latestDecisions(body: any) {
  const map = new Map<string, any>();
  for (const event of body.events ?? []) {
    if (event.type !== "decision_request") continue;
    map.set(event.payload.request.requestId, event.payload.request);
  }
  return [...map.values()];
}

function latestActivities(body: any) {
  const map = new Map<string, any>();
  for (const event of body.events ?? []) {
    if (event.type !== "activity_update") continue;
    const activity = event.payload.activity;
    map.set(activity.editId || activity.activityId, activity);
  }
  return [...map.values()];
}

function writeMembers(body: any) {
  return latestActivities(body).filter(
    (activity) => typeof activity.editId === "string" && activity.editId && typeof activity.path === "string" && activity.path,
  );
}

async function openWorkspace(host: StartedHost, root: string) {
  const opened = await fetch(host.baseUrl + "/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: root }),
  });
  assert.equal(opened.status, 200, await opened.text());
}

async function saveTrusted(host: StartedHost, sessionId: string, root: string) {
  const saved = await fetch(host.baseUrl + "/api/workspace-policy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, workspace: root, mode: "trusted_workspace" }),
  });
  assert.equal(saved.status, 200, await saved.text());
}

async function allowPendingPermissions(baseUrl: string, sessionId: string, runId: string) {
  const body = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`).then((r) => r.json());
  for (const request of latestDecisions(body)) {
    if (request.kind !== "permission" || request.status !== "pending") continue;
    const response = await fetch(baseUrl + "/api/permission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId,
        requestId: request.requestId,
        invocationId: request.invocationId,
        decision: "allow_once",
      }),
    });
    assert.equal(response.status, 200, await response.text());
  }
}

async function waitReviewPending(baseUrl: string, sessionId: string, runId: string, count: number) {
  for (let i = 0; i < 80; i++) {
    await allowPendingPermissions(baseUrl, sessionId, runId);
    const body = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`).then((r) => r.json());
    const pendingDiffs = latestDecisions(body).filter((request) => request.kind === "diff" && request.status === "pending");
    const members = writeMembers(body).filter((activity) => typeof activity.diff === "string" && activity.diff.length > 0);
    if (pendingDiffs.length >= count && members.length >= count) return { body, pendingDiffs, members };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("review pending edits did not journal");
}

test("Trusted multi-edit journals 3 activities with path+diff+editId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-trusted-multi-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "trusted-multi";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-multi-edit");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    const members = writeMembers(replay);
    assert.equal(members.length, 3, JSON.stringify(members));
    assert.deepEqual(members.map((m) => m.path).sort(), ["a.txt", "b.txt", "c.txt"]);
    for (const member of members) {
      assert.ok(member.editId);
      assert.ok(typeof member.diff === "string" && member.diff.length > 0, member.path);
      assert.equal(member.autoApplied, true);
      assert.equal(member.automaticEligibility, "text_edit");
    }
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review proposed journals decision_request and activity path+diff+editId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-review-pending-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "review-pending";
    const admitted = await admit(host.baseUrl, sessionId, "fixture:review-pending-two");
    const pending = await waitReviewPending(host.baseUrl, sessionId, admitted.run.runId, 2);
    assert.equal(pending.pendingDiffs.length, 2, JSON.stringify(pending.pendingDiffs));
    assert.equal(pending.members.length, 2, JSON.stringify(pending.members));
    assert.deepEqual(pending.members.map((m) => m.path).sort(), ["r1.txt", "r2.txt"]);
    for (const member of pending.members) {
      assert.ok(member.editId);
      assert.ok(member.diff.includes("+one") || member.diff.includes("+two"), member.diff);
    }
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("POST /api/diff reject and accept retain proposed full diff on 200 and replay", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-diff-retain-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "diff-retain";
    const admitted = await admit(host.baseUrl, sessionId, "fixture:review-pending-two");
    const pending = await waitReviewPending(host.baseUrl, sessionId, admitted.run.runId, 2);
    const first = pending.members.find((m) => m.path === "r1.txt")!;
    const second = pending.members.find((m) => m.path === "r2.txt")!;
    const firstReq = pending.pendingDiffs.find((d) => d.invocationId === first.invocationId || d.requestId === first.editId)!;
    const secondReq = pending.pendingDiffs.find((d) => d.invocationId === second.invocationId || d.requestId === second.editId)!;
    const rejected = await fetch(host.baseUrl + "/api/diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId: admitted.run.runId,
        requestId: firstReq.requestId,
        invocationId: firstReq.invocationId,
        editId: first.editId,
        action: "reject",
      }),
    });
    assert.equal(rejected.status, 200, await rejected.clone().text());
    const rejectedBody = await rejected.json() as any;
    assert.equal(rejectedBody.activity.diff, first.diff);
    assert.equal(rejectedBody.activity.path, "r1.txt");
    assert.equal(rejectedBody.activity.editId, first.editId);

    const accepted = await fetch(host.baseUrl + "/api/diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId: admitted.run.runId,
        requestId: secondReq.requestId,
        invocationId: secondReq.invocationId,
        editId: second.editId,
        action: "accept",
      }),
    });
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const acceptedBody = await accepted.json() as any;
    assert.equal(acceptedBody.activity.diff, second.diff);
    assert.equal(acceptedBody.activity.path, "r2.txt");
    assert.equal(acceptedBody.activity.editId, second.editId);

    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => {
      const members = writeMembers(body);
      const r1 = members.find((m) => m.editId === first.editId);
      const r2 = members.find((m) => m.editId === second.editId);
      return r1?.diff === first.diff && r2?.diff === second.diff && r1?.status === "rejected" && r2?.status === "succeeded";
    });
    const settled = writeMembers(replay);
    assert.equal(settled.find((m) => m.editId === first.editId)?.diff, first.diff);
    assert.equal(settled.find((m) => m.editId === second.editId)?.diff, second.diff);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("edit-recovery journals recovery.status reverted with path and diff retained", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-recover-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "recover-ok";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-edit");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    const member = writeMembers(replay)[0];
    assert.ok(member, JSON.stringify(replay.events));
    const recovered = await fetch(host.baseUrl + "/api/edit-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: admitted.run.runId, editId: member.editId }),
    });
    assert.equal(recovered.status, 200, await recovered.clone().text());
    const body = await recovered.json() as any;
    assert.equal(body.activity.recovery.status, "reverted");
    assert.equal(body.activity.path, member.path);
    assert.equal(body.activity.diff, member.diff);
    const after = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (journal) => {
      const last = writeMembers(journal).find((activity) => activity.editId === member.editId);
      return last?.recovery?.status === "reverted";
    });
    const last = writeMembers(after).find((activity) => activity.editId === member.editId);
    assert.equal(last?.recovery?.status, "reverted");
    assert.equal(last?.path, member.path);
    assert.equal(last?.diff, member.diff);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("edit-recovery conflict retains stored diff and journals conflict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-conflict-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "recover-conflict";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-edit");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    const member = writeMembers(replay)[0];
    assert.ok(member);
    await fs.writeFile(path.join(root, "trusted.txt"), "user change", "utf8");
    const conflict = await fetch(host.baseUrl + "/api/edit-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: admitted.run.runId, editId: member.editId }),
    });
    const conflictBody = await conflict.json() as any;
    assert.equal(conflict.status, 409, JSON.stringify(conflictBody));
    assert.equal(conflictBody.code, "recovery_conflict");
    assert.equal(conflictBody.activity.diff, member.diff);
    assert.equal(conflictBody.activity.path, member.path);
    assert.equal(conflictBody.activity.recovery.status, "conflict");
    const after = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (journal) => {
      const last = writeMembers(journal).find((activity) => activity.editId === member.editId);
      return last?.recovery?.status === "conflict";
    });
    const last = writeMembers(after).find((activity) => activity.editId === member.editId);
    assert.equal(last?.diff, member.diff);
    assert.equal(last?.recovery?.status, "conflict");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("read/shell fixture produces no write/patch members", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-read-"));
  await fs.writeFile(path.join(root, "fixture.txt"), "needle\n");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "read-only";
    const admitted = await admit(host.baseUrl, sessionId, "fixture:structured");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(writeMembers(replay).length, 0, JSON.stringify(writeMembers(replay)));
    const activities = latestActivities(replay);
    assert.ok(activities.some((activity) => activity.name === "read_file"));
    for (const activity of activities) {
      assert.equal(activity.editId, null);
      assert.equal(activity.path, null);
    }
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cross-run isolation of edit events by runId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-isolate-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "isolate-runs";
    await saveTrusted(host, sessionId, root);
    const first = await admit(host.baseUrl, sessionId, "fixture:structured");
    const firstReplay = await replayUntil(host.baseUrl, sessionId, first.run.runId, (body) => body.run?.state === "terminal");
    const second = await admit(host.baseUrl, sessionId, "fixture:trusted-edit");
    const secondReplay = await replayUntil(host.baseUrl, sessionId, second.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(writeMembers(firstReplay).length, 0);
    const secondMembers = writeMembers(secondReplay);
    assert.equal(secondMembers.length, 1);
    assert.equal(secondMembers[0].path, "trusted.txt");
    for (const event of firstReplay.events) {
      assert.equal(event.runId, first.run.runId);
      if (event.type === "activity_update") assert.notEqual(event.payload.activity.path, "trusted.txt");
    }
    for (const event of secondReplay.events) assert.equal(event.runId, second.run.runId);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("replay after stop/start host restores path+diff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "irc-restart-"));
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "irc-restart-home-"));
  const firstHost = await startHost({ port: await freePort(), homeDir, env: fixtureEnv() });
  let sessionId = "restart-session";
  let runId = "";
  let before: any[] = [];
  try {
    await openWorkspace(firstHost, root);
    await saveTrusted(firstHost, sessionId, root);
    const admitted = await admit(firstHost.baseUrl, sessionId, "fixture:trusted-multi-edit");
    runId = admitted.run.runId;
    const replay = await replayUntil(firstHost.baseUrl, sessionId, runId, (body) => body.run?.state === "terminal");
    before = writeMembers(replay);
    assert.equal(before.length, 3);
  } finally {
    await firstHost.stopProcess();
  }
  const secondHost = await startHost({ port: await freePort(), homeDir, env: fixtureEnv() });
  try {
    const restored = await fetch(`${secondHost.baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`);
    assert.equal(restored.status, 200, await restored.clone().text());
    const journal = await restored.json() as any;
    const after = writeMembers(journal);
    assert.equal(after.length, 3);
    assert.deepEqual(
      after.map((m) => ({ path: m.path, diff: m.diff, editId: m.editId })).sort((a, b) => a.path.localeCompare(b.path)),
      before.map((m) => ({ path: m.path, diff: m.diff, editId: m.editId })).sort((a, b) => a.path.localeCompare(b.path)),
    );
  } finally {
    await secondHost.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
