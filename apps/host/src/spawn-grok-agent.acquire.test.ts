import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function installSpawnableGrok(binDir: string, workspace: string): Promise<string> {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ type: "module" }));
  await fs.copyFile(vendorFixture, path.join(workspace, "agent.js"));
  const agentJs = path.join(workspace, "agent.js");
  if (process.platform === "win32") {
    const grokPath = path.join(binDir, "grok.cmd");
    await fs.writeFile(
      grokPath,
      `@echo off\r\n"${process.execPath}" "${agentJs}" %*\r\n`,
    );
    return grokPath;
  }
  const grokPath = path.join(binDir, "grok");
  const href = pathToFileURL(vendorFixture).href;
  await fs.writeFile(grokPath, `#!/usr/bin/env node\nimport ${JSON.stringify(href)};\n`);
  await fs.chmod(grokPath, 0o755);
  return grokPath;
}

async function setupHome(opts: {
  pathHit: "spawnable" | "empty-exe" | "miss";
  fixture?: string;
  grokAcp?: "ok" | "missing";
}): Promise<{
  home: string;
  workspace: string;
  dataDir: string;
  vendorBin: string;
  session: AgentSession;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sga-acq-"));
  const workspace = path.join(home, "ws");
  const dataDir = path.join(home, "data");
  const vendorBin = path.join(home, "vendor-bin");
  const emptyBin = path.join(home, "empty-bin");
  await fs.mkdir(workspace);
  await fs.mkdir(dataDir);
  await fs.mkdir(vendorBin);
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
  } else if (opts.pathHit === "empty-exe") {
    await fs.writeFile(path.join(vendorBin, process.platform === "win32" ? "grok.exe" : "grok"), "");
    process.env.PATH = `${vendorBin}${path.delimiter}${emptyBin}`;
    process.env.Path = process.env.PATH;
  } else {
    process.env.PATH = emptyBin;
    process.env.Path = emptyBin;
  }

  const session = new AgentSession("acquire01");
  await session.awaitReady();
  return { home, workspace, dataDir, vendorBin, session };
}

async function readVendorSpawn(dataDir: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, "vendor-spawn.json"), "utf8"));
  } catch {
    return null;
  }
}

describe("Code acquire vendor / fallback / hard_fail", () => {
  it("happy vendor uses unique tuple, default permissionMode, provenance vendor", async () => {
    const ctx = await setupHome({ pathHit: "spawnable", fixture: "ok" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      const state = ctx.session.getState();
      assert.equal(state.connected, true);
      assert.equal(state.codeAgent?.identity, "vendor");
      assert.equal(state.codeAgent?.fallbackReason, null);
      assert.equal(run.codeAgentProvenance?.identity, "vendor");
      assert.equal(run.codeAgentProvenance?.fallbackReason, null);
      const spawn = await readVendorSpawn(ctx.dataDir);
      assert.ok(spawn, "vendor child must record spawn");
      assert.equal(spawn.hasXai, false);
      const argv: string[] = (spawn.argv ?? []).map((a: unknown) => String(a));
      // grok.exe (copy of node) records argv[0]=grok.exe. A Windows grok.cmd
      // shim records node + agent.js. Either proves vendor, not grok-acp.
      assert.ok(
        argv.some((a) => /(?:^|[\\/])grok(\.exe|\.cmd)?$/i.test(a)) ||
          argv.some((a) => /(?:^|[\\/])agent\.js$/i.test(a)),
        `expected vendor grok/agent in argv, got ${JSON.stringify(argv)}`,
      );
      assert.ok(
        argv.some((a) => a === "agent" || /(^|[\\/])agent(\.js)?$/i.test(a)),
        `expected agent in argv, got ${JSON.stringify(argv)}`,
      );
      assert.ok(argv.includes("stdio"), `expected stdio in argv, got ${JSON.stringify(argv)}`);
      assert.ok(argv.includes("--cwd"), `expected --cwd in argv, got ${JSON.stringify(argv)}`);
      assert.ok(argv.includes(ctx.workspace), `expected workspace cwd in argv, got ${JSON.stringify(argv)}`);
      assert.ok(argv.includes("--rules"), `expected --rules in argv, got ${JSON.stringify(argv)}`);
      assert.ok(
        argv.some((a) => /workingDirectory/.test(a)),
        `expected workingDirectory rule in argv, got ${JSON.stringify(argv)}`,
      );
      assert.equal(spawn.cwd, ctx.workspace);
      assert.equal(spawn.initialize?.permissionMode, "default");
      assert.notEqual(spawn.initialize?.permissionMode, "always-approve");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("CLI miss selects grok-acp on same run id with cli_missing provenance", async () => {
    const ctx = await setupHome({ pathHit: "miss" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "cli_missing");
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      assert.equal(ctx.session.getState().codeAgent?.identity, "fallback");
      assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "cli_missing");
      assert.equal(run.codeAgentProvenance?.identity, "fallback");
      assert.equal(run.codeAgentProvenance?.fallbackReason, "cli_missing");
      assert.equal(run.runId, ctx.session.getActiveRunId());
      const replay = await ctx.session.replayRun(run.runId, "acquire01");
      assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 0);
      assert.equal(await readVendorSpawn(ctx.dataDir), null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("pre-live initialize fail quarantines to grok-acp on same run with spawn_failed", async () => {
    const ctx = await setupHome({ pathHit: "spawnable", fixture: "fail-initialize" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      assert.equal(ctx.session.getState().codeAgent?.identity, "fallback");
      assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "spawn_failed");
      assert.equal(run.codeAgentProvenance?.identity, "fallback");
      assert.equal(run.codeAgentProvenance?.fallbackReason, "spawn_failed");
      assert.equal(run.runId, ctx.session.getActiveRunId());
      const replay = await ctx.session.replayRun(run.runId, "acquire01");
      assert.equal(replay.events.filter((e) => e.type === "run_terminal").length, 0);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("pre-live session/new fail quarantines to grok-acp on same run with spawn_failed", async () => {
    const ctx = await setupHome({ pathHit: "spawnable", fixture: "fail-session-new" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "spawn_failed");
      assert.equal(run.codeAgentProvenance?.identity, "fallback");
      assert.equal(run.runId, ctx.session.getActiveRunId());
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("process-create fail quarantines to grok-acp with spawn_failed", async () => {
    const ctx = await setupHome({ pathHit: "empty-exe" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      assert.equal(ctx.session.getState().codeAgent?.identity, "fallback");
      assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "spawn_failed");
      assert.equal(run.codeAgentProvenance?.fallbackReason, "spawn_failed");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("acquire vendor hit overwrites eager cli_missing", async () => {
    const ctx = await setupHome({ pathHit: "miss" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      assert.equal(ctx.session.getState().codeAgent?.fallbackReason, "cli_missing");
      await installSpawnableGrok(ctx.vendorBin, ctx.workspace);
      process.env.PATH = `${ctx.vendorBin}${path.delimiter}${process.env.PATH ?? ""}`;
      process.env.Path = process.env.PATH;
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
      assert.equal(run.codeAgentProvenance?.identity, "vendor");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("vendor fail + grok-acp missing → hard_fail not fallback", async () => {
    const ctx = await setupHome({ pathHit: "empty-exe", grokAcp: "missing" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await assert.rejects(
        () => ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" }),
        /Couldn't start an agent for Code|hard_fail|Agent not connected|Failed to start/i,
      );
      const fact = ctx.session.getState().codeAgent;
      assert.equal(fact?.resolveStatus, "hard_fail");
      assert.equal(fact?.identity, "hard_fail");
      assert.equal(fact?.fallbackReason, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("Chat acquire never selects vendor; codeAgent is null", async () => {
    const ctx = await setupHome({ pathHit: "spawnable" });
    try {
      await ctx.session.setMode("chat");
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "acquire01" });
      assert.equal(ctx.session.getState().codeAgent, null);
      assert.equal(ctx.session.getState().mode, "chat");
      assert.equal(run.codeAgentProvenance ?? null, null);
      assert.equal(await exists(path.join(ctx.dataDir, "vendor-spawn.json")), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
