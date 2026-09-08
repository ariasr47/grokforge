import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentSession } from "./session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");
const vendorFixture = path.resolve(here, "./test-support/vendor-acp-agent.mjs");
const origEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in origEnv)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(origEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function installSpawnableGrok(binDir: string, workspace: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  const grokPath = path.join(binDir, process.platform === "win32" ? "grok.exe" : "grok");
  if (process.platform === "win32") {
    try { await fs.link(process.execPath, grokPath); }
    catch { await fs.copyFile(process.execPath, grokPath); }
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ type: "module" }));
    await fs.copyFile(vendorFixture, path.join(workspace, "agent.js"));
  } else {
    await fs.writeFile(grokPath, `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(vendorFixture).href)};\n`);
    await fs.chmod(grokPath, 0o755);
  }
}

async function setup(fixture: string): Promise<{
  home: string;
  session: AgentSession;
  sessionId: string;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vrt-dq-"));
  const workspace = path.join(home, "ws");
  const dataDir = path.join(home, "data");
  const vendorBin = path.join(home, "vendor-bin");
  await fs.mkdir(workspace);
  await fs.mkdir(dataDir);
  await installSpawnableGrok(vendorBin, workspace);
  process.env.GROKFORGE_CHANNEL = "test";
  process.env.GROKFORGE_DATA_DIR = dataDir;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XAI_API_KEY = "host-secret";
  process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
  process.env.GROKFORGE_VENDOR_FIXTURE = fixture;
  process.env.PATH = vendorBin;
  process.env.Path = vendorBin;
  const sessionId = "vrt-dq";
  const session = new AgentSession(sessionId);
  await session.awaitReady();
  await session.openWorkspace(workspace);
  return { home, session, sessionId };
}

async function waitReplay(
  session: AgentSession,
  runId: string,
  sessionId: string,
  pred: (body: Awaited<ReturnType<AgentSession["replayRun"]>>) => boolean,
  label: string,
  ms = 8000,
) {
  const deadline = Date.now() + ms;
  let last: Awaited<ReturnType<AgentSession["replayRun"]>> | null = null;
  while (Date.now() < deadline) {
    last = await session.replayRun(runId, sessionId).catch(() => last);
    if (last && pred(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify({
    state: last?.run?.state,
    terminalKind: last?.run?.terminalKind,
    kinds: last?.events?.map((e) => e.type),
  })}`);
}

function pendingOfKind(body: Awaited<ReturnType<AgentSession["replayRun"]>>, kind: "permission" | "diff" | "plan") {
  const hits = body.events.filter((e) =>
    e.type === "decision_request" &&
    e.payload.kind === "decision_request" &&
    e.payload.request.kind === kind &&
    e.payload.request.status === "pending",
  );
  const last = hits.at(-1);
  return last && last.payload.kind === "decision_request" ? last.payload.request : null;
}

test("RPC completion while permission already open → queue; after Accept with no remaining ask → must finalize", async () => {
  const ctx = await setup("prompt-with-open-permission");
  try {
    const run = await ctx.session.prompt("mutate", "auto", { clientSessionId: ctx.sessionId });
    const pendingReplay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => Boolean(pendingOfKind(body, "permission")),
      "open permission",
    );
    assert.notEqual(pendingReplay.run.state, "terminal", "must not CAS-finalize while an ask is already open at RPC return");
    assert.notEqual(pendingReplay.run.terminalKind, "answered");
    const decision = pendingOfKind(pendingReplay, "permission");
    assert.ok(decision);
    const settled = await ctx.session.permission(
      decision.requestId,
      "allow_once",
      { sessionId: ctx.sessionId, runId: run.runId, connectionGeneration: run.connectionGeneration },
      decision.invocationId,
    );
    assert.equal(settled, "accepted");
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "mandatory post-settle finalize",
    );
    assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 1);
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.answerVouched, true);
    assert.equal(replay.run.finalAnswer, "about to write");
    assert.equal(ctx.session.getState().busy, false);
    assert.equal(ctx.session.getState().session?.activeRunId, null);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("permission+diff both open: settling one does not drain; settling both drains", async () => {
  const ctx = await setup("prompt-with-permission-and-diff");
  try {
    const run = await ctx.session.prompt("mutate both", "auto", { clientSessionId: ctx.sessionId });
    const both = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => Boolean(pendingOfKind(body, "permission") && pendingOfKind(body, "diff")),
      "permission and diff open",
    );
    assert.notEqual(both.run.state, "terminal");
    const perm = pendingOfKind(both, "permission");
    const diff = pendingOfKind(both, "diff");
    assert.ok(perm && diff);
    await ctx.session.permission(
      perm.requestId,
      "allow_once",
      { sessionId: ctx.sessionId, runId: run.runId, connectionGeneration: run.connectionGeneration },
      perm.invocationId,
    );
    await new Promise((r) => setTimeout(r, 80));
    const afterOne = await ctx.session.replayRun(run.runId, ctx.sessionId);
    assert.notEqual(afterOne.run.state, "terminal", "settling one ask must not drain while another remains");
    await ctx.session.diffAction(
      diff.requestId,
      "accept",
      { sessionId: ctx.sessionId, runId: run.runId, connectionGeneration: run.connectionGeneration },
      diff.invocationId,
    );
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "drain after both asks",
    );
    assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 1);
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.finalAnswer, "about to mutate");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("plan settlePlanPhase then finalize is not held by queue (ask minted by this completion)", async () => {
  const ctx = await setup("prompt-empty-finish");
  try {
    ctx.session.setPlanEngagement(true);
    const run = await ctx.session.prompt("plan now", "auto", { clientSessionId: ctx.sessionId });
    assert.equal(run.executionPhase, "plan");
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "plan finalize not queued",
    );
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.answerVouched, true);
    assert.equal((replay.run.finalAnswer ?? "").trim(), "");
    const planAsk = pendingOfKind(replay, "plan");
    assert.ok(planAsk, "plan ask minted by this completion must not hold finalize");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("cancel while queued → discard queue; cancelled terminal; no second answered", async () => {
  const ctx = await setup("prompt-with-open-permission");
  try {
    const run = await ctx.session.prompt("mutate", "auto", { clientSessionId: ctx.sessionId });
    await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => Boolean(pendingOfKind(body, "permission")) && body.run.state !== "terminal",
      "queued behind permission",
    );
    await ctx.session.cancelRun(run.runId, ctx.sessionId);
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "cancelled terminal",
    );
    assert.equal(replay.run.terminalKind, "cancelled");
    assert.equal(replay.run.answerVouched, false);
    assert.equal(replay.run.finalAnswer, null);
    assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 1);
    await new Promise((r) => setTimeout(r, 80));
    const again = await ctx.session.replayRun(run.runId, ctx.sessionId);
    assert.equal(again.run.terminalKind, "cancelled");
    assert.equal(again.events.filter((e) => e.type === "run_terminal").length, 1);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});
