import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";
import { resolveProjectInstructions } from "./project-instructions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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

async function volumeIsCaseSensitive(root: string): Promise<boolean> {
  const a = path.join(root, "CaseProbe.tmp");
  const b = path.join(root, "caseprobe.tmp");
  await fs.writeFile(a, "x");
  try {
    await fs.stat(b);
    return false;
  } catch {
    return true;
  } finally {
    await fs.rm(a, { force: true });
  }
}

test("outside symlink recipe source does not load outside bytes as present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-int-esc-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pi-int-out-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const secret = path.join(outside, "secret.md");
    await fs.writeFile(secret, "OUTSIDE SECRET BODY\n", "utf8");
    try {
      await fs.symlink(secret, path.join(root, "AGENTS.md"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        assert.ok(true, `symlink creation skipped (${code})`);
        return;
      }
      throw error;
    }
    const snap = await resolveProjectInstructions(root);
    assert.notEqual(snap.status, "present");
    assert.equal(snap.body.includes("OUTSIDE SECRET BODY"), false);
    await openWorkspace(host.baseUrl, root);
    const state = await (await fetch(host.baseUrl + "/api/state")).json() as any;
    assert.notEqual(state.projectInstructions.status, "present");
    assert.notEqual(state.projectInstructions.path, secret);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("case-insensitive Agents.md-only → chrome path AGENTS.md when open hits inode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-int-case-"));
  try {
    await fs.writeFile(path.join(root, "Agents.md"), "Alias body\n", "utf8");
    const snap = await resolveProjectInstructions(root);
    if (await volumeIsCaseSensitive(root)) {
      assert.equal(snap.status, "absent");
      assert.equal(snap.path, null);
    } else {
      assert.equal(snap.status, "present");
      assert.equal(snap.path, "AGENTS.md");
      assert.notEqual(snap.path, "Agents.md");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plan-phase Code turn still receives recipe when present; no File changes/Verify invented", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-int-plan-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "project-instructions-included", XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Plan still loads recipe\n", "utf8");
    await openWorkspace(host.baseUrl, root);
    const sessionId = "piplanhost1";
    await engagePlan(host.baseUrl, sessionId);
    const admitted = await admit(host.baseUrl, sessionId, "plan with recipe");
    assert.equal(admitted.run.executionPhase, "plan");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      (body.events ?? []).some((event: any) => event.type === "project_instructions") &&
      (body.events ?? []).some((event: any) => event.type === "run_terminal"),
    );
    const inclusion = (replay.events ?? []).filter((event: any) => event.type === "project_instructions");
    assert.equal(inclusion.length, 1);
    assert.equal(inclusion[0].payload.projectInstructions.inclusion, "included");
    const edits = (replay.events ?? []).filter((event: any) => {
      if (event.type !== "activity_update") return false;
      const activity = event.payload.activity;
      return typeof activity?.editId === "string" && activity.editId;
    });
    assert.equal(edits.length, 0);
    const verifyLike = (replay.events ?? []).filter((event: any) => {
      if (event.type !== "activity_update") return false;
      const name = event.payload.activity?.name;
      return name === "run_shell" || name === "verify";
    });
    assert.equal(verifyLike.length, 0);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
