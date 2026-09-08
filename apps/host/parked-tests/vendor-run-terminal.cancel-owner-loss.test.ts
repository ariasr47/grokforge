import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { AgentSession } from "./session.js";
import { startHost } from "./test-support/host-process.js";

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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vrt-col-"));
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
  const sessionId = "vrt-col";
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
    failure: last?.run?.failure,
    kinds: last?.events?.map((e) => e.type),
  })}`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("cancel after usable mid-turn and no answered CAS → cancelled unvouched", async () => {
  const ctx = await setup("prompt-hang-midturn");
  try {
    const run = await ctx.session.prompt("pong", "auto", { clientSessionId: ctx.sessionId });
    await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.events.some((e) => e.type === "message_delta"),
      "mid-turn",
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
    assert.ok(replay.events.some((e) => e.type === "message_delta" && e.payload.kind === "message_delta" && e.payload.delta === "pong"));
    assert.ok(replay.events.some((e) => e.type === "reasoning_delta"));
    assert.notEqual(replay.run.failure?.code, "missing_final_answer");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("cancel after answered CAS is a rejected second terminal", async () => {
  const ctx = await setup("prompt-midturn-only");
  try {
    const run = await ctx.session.prompt("pong", "auto", { clientSessionId: ctx.sessionId });
    const answered = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal" && body.run.terminalKind === "answered",
      "answered",
    );
    await assert.rejects(
      () => ctx.session.cancelRun(run.runId, ctx.sessionId),
      (err: unknown) => (err as { code?: string }).code === "run_terminal",
    );
    const replay = await ctx.session.replayRun(run.runId, ctx.sessionId);
    assert.equal(replay.run.terminalKind, "answered");
    assert.equal(replay.run.answerVouched, true);
    assert.equal(replay.run.finalAnswer, answered.run.finalAnswer);
    assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 1);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("vendor child exit mid-turn → failed agent_exited; mid-turn unvouched", async () => {
  const ctx = await setup("exit-after-live");
  try {
    const run = await ctx.session.prompt("hi", "auto", { clientSessionId: ctx.sessionId });
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "agent_exited",
    );
    assert.equal(replay.run.terminalKind, "failed");
    assert.equal(replay.run.failure?.code, "agent_exited");
    assert.equal(replay.run.answerVouched, false);
    assert.equal(replay.run.finalAnswer, null);
    assert.equal(ctx.session.getState().busy, false);
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("true execution-owner loss in-flight before terminal → execution_owner_lost", async () => {
  const ctx = await setup("prompt-hang-midturn");
  try {
    const run = await ctx.session.prompt("pong", "auto", { clientSessionId: ctx.sessionId });
    await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.events.some((e) => e.type === "message_delta"),
      "mid-turn before owner-loss",
    );
    const other = path.join(ctx.home, "ws2");
    await fs.mkdir(other);
    await ctx.session.openWorkspace(other);
    const replay = await waitReplay(
      ctx.session,
      run.runId,
      ctx.sessionId,
      (body) => body.run.state === "terminal",
      "owner-loss terminal",
    );
    assert.equal(replay.run.terminalKind, "failed");
    assert.equal(replay.run.failure?.code, "execution_owner_lost");
    assert.equal(replay.run.answerVouched, false);
    assert.equal(replay.run.finalAnswer, null);
    assert.notEqual(replay.run.terminalKind, "cancelled");
    assert.notEqual(replay.run.terminalKind, "answered");
    assert.notEqual(ctx.session.getState().codeAgent?.identity, "fallback");
  } finally {
    await ctx.session.shutdown().catch(() => undefined);
    await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("WS/transport drop while vendor child may still be live → no false terminal", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vrt-wsblip-"));
  const workspace = path.join(home, "ws");
  const vendorBin = path.join(home, "vendor-bin");
  await fs.mkdir(workspace);
  await installSpawnableGrok(vendorBin, workspace);
  const host = await startHost({
    port: await freePort(),
    homeDir: home,
    env: {
      GROKFORGE_AGENT_ENTRY: fakeAgent,
      GROKFORGE_VENDOR_FIXTURE: "prompt-hang-midturn",
      XAI_API_KEY: "host-secret",
      PATH: vendorBin,
      Path: vendorBin,
    },
  });
  const sessionId = "vrt-wsblip";
  let ws: WebSocket | null = null;
  try {
    const opened = await fetch(host.baseUrl + "/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    const openedRaw = await opened.text();
    assert.equal(opened.status, 200, openedRaw);
    ws = new WebSocket(host.baseUrl.replace(/^http/, "ws") + "/ws");
    await new Promise<void>((resolve, reject) => {
      ws!.once("open", () => resolve());
      ws!.once("error", reject);
    });
    const admitted = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text: "pong", effort: "auto", history: [] }),
    });
    const admittedRaw = await admitted.text();
    assert.equal(admitted.status, 202, admittedRaw);
    const runId = (JSON.parse(admittedRaw) as { run: { runId: string } }).run.runId;
    const deadline = Date.now() + 8000;
    let seenMid = false;
    while (Date.now() < deadline) {
      const replay = await (await fetch(`${host.baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`)).json() as { events?: Array<{ type: string }> };
      if (replay.events?.some((e) => e.type === "message_delta")) {
        seenMid = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(seenMid, true);
    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    const after = await (await fetch(`${host.baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`)).json() as {
      run: { state: string; terminalKind: string | null; failure: { code?: string } | null };
      events: Array<{ type: string }>;
    };
    assert.notEqual(after.run.state, "terminal");
    assert.equal(after.events.some((e) => e.type === "run_terminal"), false);
    assert.notEqual(after.run.failure?.code, "execution_owner_lost");
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await host.stop();
  }
});

test("host restart / unproven live owner stays interrupted", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vrt-intr-"));
  const workspace = path.join(home, "ws");
  const vendorBin = path.join(home, "vendor-bin");
  await fs.mkdir(workspace);
  await installSpawnableGrok(vendorBin, workspace);
  const port = await freePort();
  const first = await startHost({
    port,
    homeDir: home,
    env: {
      GROKFORGE_AGENT_ENTRY: fakeAgent,
      GROKFORGE_VENDOR_FIXTURE: "prompt-hang-midturn",
      XAI_API_KEY: "host-secret",
      PATH: vendorBin,
      Path: vendorBin,
    },
  });
  const sessionId = "vrt-intr";
  let runId = "";
  try {
    const opened = await fetch(first.baseUrl + "/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    const openedRaw = await opened.text();
    assert.equal(opened.status, 200, openedRaw);
    const admitted = await fetch(first.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text: "hang", effort: "auto", history: [] }),
    });
    const admittedRaw = await admitted.text();
    assert.equal(admitted.status, 202, admittedRaw);
    runId = (JSON.parse(admittedRaw) as { run: { runId: string } }).run.runId;
    const deadline = Date.now() + 8000;
    let seen = false;
    while (Date.now() < deadline) {
      const replay = await (await fetch(`${first.baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`)).json() as { events?: Array<{ type: string }> };
      if (replay.events?.some((e) => e.type === "message_delta")) {
        seen = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(seen, true);
    await first.stopProcess();
    await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 30; i++) {
      try { await fetch(`${first.baseUrl}/api/health`); await new Promise((r) => setTimeout(r, 25)); }
      catch { break; }
    }
    const second = await startHost({
      port,
      homeDir: home,
      env: {
        GROKFORGE_AGENT_ENTRY: fakeAgent,
        GROKFORGE_VENDOR_FIXTURE: "prompt-hang-midturn",
        XAI_API_KEY: "host-secret",
        PATH: vendorBin,
        Path: vendorBin,
      },
    });
    try {
      let replay: { run?: { state?: string; failure?: { code?: string } | null }; events?: Array<{ type: string }> } = {};
      for (let i = 0; i < 40; i++) {
        replay = await (await fetch(`${second.baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`)).json() as typeof replay;
        if (replay.run?.state === "terminal") break;
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(replay.run?.state, "terminal");
      assert.equal(replay.run?.failure?.code, "interrupted");
      assert.notEqual(replay.run?.failure?.code, "execution_owner_lost");
      assert.equal((replay.events ?? []).filter((e) => e.type === "run_terminal").length, 1);
    } finally {
      await second.stop();
    }
  } catch (error) {
    await first.stop();
    throw error;
  }
});
