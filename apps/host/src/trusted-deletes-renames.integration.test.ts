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
  return JSON.parse(raw) as { run: { runId: string; executionPhase?: string } };
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

function members(body: any) {
  return latestActivities(body).filter(
    (activity) =>
      typeof activity.editId === "string" &&
      activity.editId &&
      (activity.kind === "delete" || activity.kind === "rename" || activity.kind === "content"),
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

async function engagePlan(baseUrl: string, sessionId: string) {
  const res = await fetch(baseUrl + "/api/plan-engagement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, engaged: true }),
  });
  assert.equal(res.status, 200, await res.text());
}

async function allowPendingPermissions(baseUrl: string, sessionId: string, runId: string, decision: "allow_once" | "deny" = "allow_once") {
  const body = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`).then((r) => r.json());
  const pending = latestDecisions(body).filter((request) => request.kind === "permission" && request.status === "pending");
  for (const request of pending) {
    const response = await fetch(baseUrl + "/api/permission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId,
        requestId: request.requestId,
        invocationId: request.invocationId,
        decision,
      }),
    });
    assert.equal(response.status, 200, await response.text());
  }
  return pending;
}

async function waitReviewPending(baseUrl: string, sessionId: string, runId: string, count: number) {
  for (let i = 0; i < 80; i++) {
    await allowPendingPermissions(baseUrl, sessionId, runId);
    const body = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`).then((r) => r.json());
    const pendingDiffs = latestDecisions(body).filter((request) => request.kind === "diff" && request.status === "pending");
    const listed = members(body);
    if (pendingDiffs.length >= count && listed.length >= count) return { body, pendingDiffs, members: listed };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("review pending edits did not journal");
}

test("Trusted delete auto-applies with kind delete, null diff, and recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-del-"));
  await fs.writeFile(path.join(root, "victim.txt"), "victim-body", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-trusted-del";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-delete");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(await fs.stat(path.join(root, "victim.txt")).then(() => true, () => false), false);
    const listed = members(replay);
    assert.equal(listed.length, 1, JSON.stringify(listed));
    const activity = listed[0];
    assert.equal(activity.kind, "delete");
    assert.equal(activity.path, "victim.txt");
    assert.equal(activity.autoApplied, true);
    assert.equal(activity.automaticEligibility, "text_edit");
    assert.ok(activity.editId);
    assert.equal(activity.diff ?? null, null);
    assert.equal(activity.recovery?.available, true);
    assert.equal(activity.recovery?.status, "available");
    assert.equal(latestDecisions(replay).filter((d) => d.kind === "diff" && d.status === "pending").length, 0);

    const recovered = await fetch(host.baseUrl + "/api/edit-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: admitted.run.runId, editId: activity.editId }),
    });
    assert.equal(recovered.status, 200, await recovered.clone().text());
    const recoveredBody = await recovered.json() as any;
    assert.equal(recoveredBody.activity.recovery.status, "reverted");
    assert.equal(recoveredBody.activity.kind, "delete");
    assert.equal(await fs.readFile(path.join(root, "victim.txt"), "utf8"), "victim-body");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted delete recovery conflicts when path exists again including identical bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-del-conflict-"));
  await fs.writeFile(path.join(root, "victim.txt"), "victim-body", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-del-conflict";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-delete");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    const activity = members(replay)[0];
    assert.ok(activity?.editId);
    await fs.writeFile(path.join(root, "victim.txt"), "victim-body", "utf8");
    const conflict = await fetch(host.baseUrl + "/api/edit-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: admitted.run.runId, editId: activity.editId }),
    });
    const conflictBody = await conflict.json() as any;
    assert.equal(conflict.status, 409, JSON.stringify(conflictBody));
    assert.equal(conflictBody.code, "recovery_conflict");
    assert.equal(conflictBody.activity.recovery.status, "conflict");
    assert.equal(conflictBody.activity.kind, "delete");
    assert.equal(await fs.readFile(path.join(root, "victim.txt"), "utf8"), "victim-body");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted rename auto-applies with fromPath+toPath and recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-ren-"));
  await fs.writeFile(path.join(root, "old.txt"), "renamed-body", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-trusted-ren";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-rename");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "renamed-body");
    assert.equal(await fs.stat(path.join(root, "old.txt")).then(() => true, () => false), false);
    const activity = members(replay)[0];
    assert.ok(activity, JSON.stringify(replay.events));
    assert.equal(activity.kind, "rename");
    assert.equal(activity.fromPath, "old.txt");
    assert.equal(activity.toPath, "new.txt");
    assert.equal(activity.path, "new.txt");
    assert.equal(activity.autoApplied, true);
    assert.equal(activity.diff ?? null, null);

    const recovered = await fetch(host.baseUrl + "/api/edit-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: admitted.run.runId, editId: activity.editId }),
    });
    assert.equal(recovered.status, 200, await recovered.clone().text());
    const recoveredBody = await recovered.json() as any;
    assert.equal(recoveredBody.activity.recovery.status, "reverted");
    assert.equal(recoveredBody.activity.kind, "rename");
    assert.equal(recoveredBody.activity.path, "old.txt");
    assert.equal(await fs.readFile(path.join(root, "old.txt"), "utf8"), "renamed-body");
    assert.equal(await fs.stat(path.join(root, "new.txt")).then(() => true, () => false), false);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted rename recovery conflicts when source reappeared", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-ren-conflict-"));
  await fs.writeFile(path.join(root, "old.txt"), "renamed-body", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-ren-conflict";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-rename");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    const activity = members(replay)[0];
    await fs.writeFile(path.join(root, "old.txt"), "other", "utf8");
    const conflict = await fetch(host.baseUrl + "/api/edit-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: admitted.run.runId, editId: activity.editId }),
    });
    const conflictBody = await conflict.json() as any;
    assert.equal(conflict.status, 409, JSON.stringify(conflictBody));
    assert.equal(conflictBody.code, "recovery_conflict");
    assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "renamed-body");
    assert.equal(await fs.readFile(path.join(root, "old.txt"), "utf8"), "other");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review pending rename binds path to fromPath until accept", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-rev-ren-"));
  await fs.writeFile(path.join(root, "old.txt"), "stay", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-review-ren";
    const admitted = await admit(host.baseUrl, sessionId, "fixture:review-rename");
    const pending = await waitReviewPending(host.baseUrl, sessionId, admitted.run.runId, 1);
    const activity = pending.members[0];
    assert.equal(activity.kind, "rename");
    assert.equal(activity.path, "old.txt");
    assert.equal(activity.fromPath, "old.txt");
    assert.equal(activity.toPath, "new.txt");
    assert.equal(activity.diff ?? null, null);
    assert.equal(await fs.readFile(path.join(root, "old.txt"), "utf8"), "stay");
    assert.equal(await fs.stat(path.join(root, "new.txt")).then(() => true, () => false), false);
    const req = pending.pendingDiffs[0];
    const accepted = await fetch(host.baseUrl + "/api/diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        runId: admitted.run.runId,
        requestId: req.requestId,
        invocationId: req.invocationId,
        editId: activity.editId,
        action: "accept",
      }),
    });
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const acceptedBody = await accepted.json() as any;
    assert.equal(acceptedBody.activity.kind, "rename");
    assert.equal(acceptedBody.activity.path, "new.txt");
    assert.equal(acceptedBody.activity.fromPath, "old.txt");
    assert.equal(acceptedBody.activity.toPath, "new.txt");
    await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "stay");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review deny of delete_file is not_executed with no File changes member", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-deny-"));
  await fs.writeFile(path.join(root, "victim.txt"), "keep", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-review-deny";
    const admitted = await admit(host.baseUrl, sessionId, "fixture:review-delete");
    let denied = false;
    for (let i = 0; i < 80 && !denied; i++) {
      const pending = await allowPendingPermissions(host.baseUrl, sessionId, admitted.run.runId, "deny");
      if (pending.length > 0) denied = true;
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(denied, true, "expected a permission card to deny");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(await fs.readFile(path.join(root, "victim.txt"), "utf8"), "keep");
    const listed = members(replay);
    assert.equal(listed.length, 0, JSON.stringify(listed));
    const refused = latestActivities(replay).filter((a) => a.execution === "not_executed" && a.status === "rejected");
    assert.ok(refused.length >= 1, JSON.stringify(latestActivities(replay)));
    for (const activity of refused) {
      assert.equal(activity.editId ?? null, null);
      assert.equal(activity.kind ?? null, null);
    }
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("directory delete_file is not_executed non_regular_file with no member", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-dir-"));
  await fs.mkdir(path.join(root, "subdir"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-dir01";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:delete-directory");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(members(replay).length, 0, JSON.stringify(members(replay)));
    const refused = latestActivities(replay).find((a) => a.name === "delete_file" && a.execution === "not_executed");
    assert.ok(refused, JSON.stringify(latestActivities(replay)));
    assert.equal(refused.error, "non_regular_file");
    assert.equal(refused.editId ?? null, null);
    assert.equal(refused.kind ?? null, null);
    assert.equal(await fs.stat(path.join(root, "subdir")).then((s) => s.isDirectory(), () => false), true);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("protected recursive shell delete stays not_executed with no Deleted member", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-prot-"));
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-protected";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:protected-delete");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.ok(latestActivities(replay).some((a) => a.execution === "not_executed"));
    assert.equal(members(replay).length, 0, JSON.stringify(members(replay)));
    for (const activity of latestActivities(replay)) {
      assert.notEqual(activity.kind, "delete");
    }
    assert.equal(await fs.stat(root).then(() => true, () => false), true);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Plan phase delete_file is not_executed with file untouched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-plan-"));
  await fs.writeFile(path.join(root, "victim.txt"), "keep", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-plan";
    await engagePlan(host.baseUrl, sessionId);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:trusted-delete");
    assert.equal(admitted.run.executionPhase, "plan");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      (body.events ?? []).some((event: any) => event.type === "activity_update" && event.payload.activity.execution === "not_executed"),
    );
    assert.equal(members(replay).length, 0);
    assert.equal(await fs.readFile(path.join(root, "victim.txt"), "utf8"), "keep");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted shell del cards and never becomes a File changes member", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-int-shell-"));
  await fs.writeFile(path.join(root, "victim.txt"), "keep", "utf8");
  const host = await startHost({ port: await freePort(), env: fixtureEnv() });
  try {
    await openWorkspace(host, root);
    const sessionId = "tdr-shell";
    await saveTrusted(host, sessionId, root);
    const admitted = await admit(host.baseUrl, sessionId, "fixture:shell-rm");
    let denied = false;
    for (let i = 0; i < 80 && !denied; i++) {
      const pending = await allowPendingPermissions(host.baseUrl, sessionId, admitted.run.runId, "deny");
      if (pending.length > 0) denied = true;
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(denied, true, "expected a shell permission card");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) => body.run?.state === "terminal");
    assert.equal(members(replay).length, 0, JSON.stringify(members(replay)));
    const shell = latestActivities(replay).find((a) => a.name === "run_shell");
    assert.ok(shell, JSON.stringify(latestActivities(replay)));
    assert.equal(shell.kind ?? null, null);
    assert.equal(shell.editId ?? null, null);
    assert.equal(await fs.readFile(path.join(root, "victim.txt"), "utf8"), "keep");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
