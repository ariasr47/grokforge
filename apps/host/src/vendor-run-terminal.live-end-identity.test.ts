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

async function setup(opts: {
  fixture?: string;
  pathHit: "spawnable" | "miss";
  grokAcp?: "ok" | "missing";
}): Promise<{
  home: string;
  workspace: string;
  session: AgentSession;
  sessionId: string;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vrt-id-"));
  const workspace = path.join(home, "ws");
  const dataDir = path.join(home, "data");
  const vendorBin = path.join(home, "vendor-bin");
  const emptyBin = path.join(home, "empty-bin");
  await fs.mkdir(workspace);
  await fs.mkdir(dataDir);
  await fs.mkdir(emptyBin);
  process.env.GROKFORGE_CHANNEL = "test";
  process.env.GROKFORGE_DATA_DIR = dataDir;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XAI_API_KEY = "host-secret";
  process.env.GROKFORGE_VENDOR_FIXTURE = opts.fixture ?? "ok";
  if (opts.grokAcp === "missing") {
    process.env.GROKFORGE_ROOT = path.join(home, "no-repo");
    process.env.GROKFORGE_AGENT_ENTRY = path.join(home, "missing-agent.mjs");
  } else {
    process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
    delete process.env.GROKFORGE_ROOT;
  }
  if (opts.pathHit === "spawnable") {
    await installSpawnableGrok(vendorBin, workspace);
    process.env.PATH = `${vendorBin}${path.delimiter}${emptyBin}`;
    process.env.Path = process.env.PATH;
  } else {
    process.env.PATH = emptyBin;
    process.env.Path = emptyBin;
  }
  const sessionId = "vrt-id";
  const session = new AgentSession(sessionId);
  await session.awaitReady();
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

test("live vendor normal completion does not rewrite identity to fallback", async () => {
  const ctx = await setup({ pathHit: "spawnable", fixture: "prompt-midturn-only" });
  try {
    await ctx.session.openWorkspace(ctx.workspace);
    const run = await ctx.session.prompt("pong", "auto", { clientSessionId: ctx.sessionId });
    await waitReplay(ctx.session, run.runId, ctx.sessionId, (body) => body.run.state === "terminal", "normal end");
    assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
    assert.notEqual(ctx.session.getState().codeAgent?.identity, "fallback");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("live vendor cancel does not rewrite identity to fallback", async () => {
  const ctx = await setup({ pathHit: "spawnable", fixture: "prompt-hang-midturn" });
  try {
    await ctx.session.openWorkspace(ctx.workspace);
    const run = await ctx.session.prompt("pong", "auto", { clientSessionId: ctx.sessionId });
    await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.events.some((e) => e.type === "message_delta"),
      "mid-turn",
    );
    await ctx.session.cancelRun(run.runId, ctx.sessionId);
    await waitReplay(ctx.session, run.runId, ctx.sessionId, (body) => body.run.state === "terminal", "cancel end");
    assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("live vendor fail does not rewrite identity to fallback", async () => {
  const ctx = await setup({ pathHit: "spawnable", fixture: "prompt-fail" });
  try {
    await ctx.session.openWorkspace(ctx.workspace);
    const run = await ctx.session.prompt("boom", "auto", { clientSessionId: ctx.sessionId });
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "fail end",
    );
    assert.equal(replay.run.terminalKind, "failed");
    assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("live vendor agent-exit does not rewrite identity to fallback", async () => {
  const ctx = await setup({ pathHit: "spawnable", fixture: "exit-after-live" });
  try {
    await ctx.session.openWorkspace(ctx.workspace);
    const run = await ctx.session.prompt("hi", "auto", { clientSessionId: ctx.sessionId });
    await waitReplay(ctx.session, run.runId, ctx.sessionId, (body) => body.run.state === "terminal", "exit end");
    assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
    assert.equal(ctx.session.getState().codeAgent?.fallbackReason, null);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("missing CLI still stamps honest fallback / Mini-Grok", async () => {
  const ctx = await setup({ pathHit: "miss", grokAcp: "ok" });
  try {
    await ctx.session.openWorkspace(ctx.workspace);
    const run = await ctx.session.prompt("hi", "auto", { clientSessionId: ctx.sessionId });
    assert.equal(ctx.session.getState().codeAgent?.identity, "fallback");
    assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "cli_missing");
    assert.equal(run.codeAgentProvenance?.identity, "fallback");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("hard_fail stays non-fallback and must not paint Mini-Grok", async () => {
  const ctx = await setup({ pathHit: "miss", grokAcp: "missing" });
  try {
    await ctx.session.openWorkspace(ctx.workspace);
    await assert.rejects(
      () => ctx.session.prompt("hi", "auto", { clientSessionId: ctx.sessionId }),
      /Couldn't start an agent for Code|hard_fail|Agent not connected|Failed to start/i,
    );
    const fact = ctx.session.getState().codeAgent;
    assert.equal(fact?.resolveStatus, "hard_fail");
    assert.equal(fact?.identity, "hard_fail");
    assert.notEqual(fact?.identity, "fallback");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});
