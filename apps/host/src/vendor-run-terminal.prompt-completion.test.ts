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
  workspace: string;
  session: AgentSession;
  sessionId: string;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vrt-pc-"));
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
  const sessionId = "vrt-pc";
  const session = new AgentSession(sessionId);
  await session.awaitReady();
  await session.openWorkspace(workspace);
  return { home, workspace, session, sessionId };
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

test("vendor mid-turn-only RPC completion → answered + answerVouched + finalAnswer pong", async () => {
  const ctx = await setup("prompt-midturn-only");
  try {
    const run = await ctx.session.prompt("Reply with one word only: pong", "auto", {
      clientSessionId: ctx.sessionId,
    });
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "run_terminal",
    );
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.answerVouched, true);
    assert.equal(replay.run.finalAnswer, "pong");
    const terminals = replay.events.filter((e) => e.type === "run_terminal");
    assert.equal(terminals.length, 1);
    assert.ok(replay.events.some((e) => e.type === "reasoning_delta"));
    assert.ok(replay.events.some((e) => e.type === "message_delta" && e.payload.kind === "message_delta" && e.payload.delta === "pong"));
    assert.notEqual(replay.run.finalAnswer, "considering");
    const state = ctx.session.getState();
    assert.equal(state.busy, false);
    assert.equal(state.session?.activeRunId, null);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("vendor empty execute finish → missing_final_answer + retry_prompt", async () => {
  const ctx = await setup("prompt-empty-finish");
  try {
    const run = await ctx.session.prompt("say nothing", "auto", { clientSessionId: ctx.sessionId });
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "empty-finish terminal",
    );
    assert.equal(replay.run.terminalKind, "failed");
    assert.equal(replay.run.failure?.code, "missing_final_answer");
    assert.equal(replay.run.failure?.recoveryAction, "retry_prompt");
    assert.equal(replay.run.finalAnswer, null);
    assert.equal(replay.run.answerVouched, false);
    assert.ok(replay.events.some((e) => e.type === "reasoning_delta"));
    assert.equal(replay.events.some((e) => e.type === "message_delta"), false);
    assert.equal(ctx.session.getState().busy, false);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("RPC done + notification done → exactly one CAS winner", async () => {
  const ctx = await setup("prompt-double-done");
  try {
    const run = await ctx.session.prompt("pong", "auto", { clientSessionId: ctx.sessionId });
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "double-done terminal",
    );
    assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 1);
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.finalAnswer, "pong");
    assert.equal(replay.run.answerVouched, true);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("plan exemption: empty plan finish CAS-answers without missing_final", async () => {
  const ctx = await setup("prompt-empty-finish");
  try {
    ctx.session.setPlanEngagement(true);
    const run = await ctx.session.prompt("plan empty", "auto", { clientSessionId: ctx.sessionId });
    assert.equal(run.executionPhase, "plan");
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "plan terminal",
    );
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.answerVouched, true);
    assert.equal(replay.run.failure, null);
    assert.equal((replay.run.finalAnswer ?? "").trim(), "");
    assert.notEqual(replay.run.failure?.code, "missing_final_answer");
    assert.ok(replay.events.some((e) => e.type === "plan_record"));
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});
