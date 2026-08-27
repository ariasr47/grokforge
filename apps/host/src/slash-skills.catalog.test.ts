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
  fixture: string;
  pathHit?: boolean;
  timeoutMs?: number;
}): Promise<{ home: string; workspace: string; dataDir: string; session: AgentSession }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-cat-"));
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
  process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
  process.env.GROKFORGE_VENDOR_FIXTURE = opts.fixture;
  if (opts.pathHit === false) {
    process.env.PATH = emptyBin;
    process.env.Path = emptyBin;
  } else {
    await installSpawnableGrok(vendorBin, workspace);
    process.env.PATH = `${vendorBin}${path.delimiter}${emptyBin}`;
    process.env.Path = process.env.PATH;
  }
  const session = new AgentSession("catalog01", {
    skillsCatalogObtainTimeoutMs: opts.timeoutMs,
  });
  await session.awaitReady();
  return { home, workspace, dataDir, session };
}

async function waitForCatalog(
  session: AgentSession,
  pred: (cat: ReturnType<AgentSession["getSkillsCatalog"]>) => boolean,
  label: string,
  ms = 5000,
) {
  const deadline = Date.now() + ms;
  let last = session.getSkillsCatalog();
  while (Date.now() < deadline) {
    last = session.getSkillsCatalog();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last)}`);
}

describe("slash-skills catalog on PublicState", () => {
  it("Chat state → absent_non_vendor / commands null", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-chat-"));
    process.env.GROKFORGE_CHANNEL = "test";
    process.env.GROKFORGE_DATA_DIR = path.join(home, "data");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const session = new AgentSession("chatcat01");
    try {
      await session.awaitReady();
      const state = session.getState();
      assert.equal(state.mode, "chat");
      assert.equal(state.codeAgent, null);
      assert.equal(state.skillsCatalog.disposition, "absent_non_vendor");
      assert.equal(state.skillsCatalog.commands, null);
    } finally {
      await session.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("pre-acquire vendor + connected false does not invent catalog loss", async () => {
    const ctx = await setup({ fixture: "ok" });
    try {
      const state = await ctx.session.openWorkspace(ctx.workspace);
      assert.equal(state.codeAgent?.identity, "vendor");
      assert.equal(state.connected, false);
      assert.equal(state.skillsCatalog.disposition, "absent_non_vendor");
      assert.equal(state.skillsCatalog.commands, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("vendor live, no ad yet → awaiting_first_valid", async () => {
    const ctx = await setup({ fixture: "skills-silent" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      const cat = await waitForCatalog(
        ctx.session,
        (c) => c.disposition === "awaiting_first_valid" || c.disposition === "obtain_failed",
        "awaiting or failed",
      );
      assert.equal(cat.disposition, "awaiting_first_valid");
      assert.equal(cat.commands, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("valid ad with /forge-skill-fixture → ready + that name only", async () => {
    const ctx = await setup({ fixture: "ok" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      const cat = await waitForCatalog(ctx.session, (c) => c.disposition === "ready", "ready");
      assert.deepEqual(cat.commands, [
        { name: "/forge-skill-fixture", description: "Forge skill fixture" },
      ]);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("valid empty → ready + []", async () => {
    const ctx = await setup({ fixture: "skills-empty" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      const cat = await waitForCatalog(
        ctx.session,
        (c) => c.disposition === "ready" && Array.isArray(c.commands) && c.commands.length === 0,
        "ready empty",
      );
      assert.equal(cat.disposition, "ready");
      assert.deepEqual(cat.commands, []);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("malformed with prior → keep ready", async () => {
    const ctx = await setup({ fixture: "skills-malformed-after-valid" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      const cat = await waitForCatalog(ctx.session, (c) => c.disposition === "ready", "keep ready");
      assert.deepEqual(cat.commands, [
        { name: "/forge-skill-fixture", description: "Forge skill fixture" },
      ]);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("malformed with no prior → obtain_failed", async () => {
    const ctx = await setup({ fixture: "skills-malformed" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      const cat = await waitForCatalog(ctx.session, (c) => c.disposition === "obtain_failed", "obtain_failed");
      assert.equal(cat.commands, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("timer with no prior → obtain_failed", async () => {
    const ctx = await setup({ fixture: "skills-silent", timeoutMs: 40 });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      const cat = await waitForCatalog(
        ctx.session,
        (c) => c.disposition === "obtain_failed",
        "timeout obtain_failed",
        3000,
      );
      assert.equal(cat.commands, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("timer with prior → keep ready", async () => {
    const ctx = await setup({ fixture: "ok", timeoutMs: 80 });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      await waitForCatalog(ctx.session, (c) => c.disposition === "ready", "ready before timer");
      await new Promise((r) => setTimeout(r, 150));
      const cat = ctx.session.getSkillsCatalog();
      assert.equal(cat.disposition, "ready");
      assert.equal(cat.commands?.[0]?.name, "/forge-skill-fixture");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("child dispose while identity still vendor → awaiting_first_valid", async () => {
    const ctx = await setup({ fixture: "ok" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      await waitForCatalog(ctx.session, (c) => c.disposition === "ready", "ready before kill");
      const pid = Number((await fs.readFile(path.join(ctx.workspace, "vendor-pid.txt"), "utf8")).trim());
      assert.ok(pid > 0);
      try { process.kill(pid); } catch { /* already gone */ }
      const cat = await waitForCatalog(
        ctx.session,
        (c) => c.disposition === "awaiting_first_valid",
        "awaiting after disconnect",
      );
      assert.equal(cat.commands, null);
      assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("fallback stamp → absent_non_vendor", async () => {
    const ctx = await setup({ fixture: "ok" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "catalog01" });
      await waitForCatalog(ctx.session, (c) => c.disposition === "ready", "ready before fallback");
      const pid = Number((await fs.readFile(path.join(ctx.workspace, "vendor-pid.txt"), "utf8")).trim());
      try { process.kill(pid); } catch { /* already gone */ }
      await waitForCatalog(ctx.session, (c) => c.disposition === "awaiting_first_valid", "withhold after death");
      const emptyBin = path.join(ctx.home, "empty-bin");
      process.env.PATH = emptyBin;
      process.env.Path = emptyBin;
      await ctx.session.prompt("again", "auto", { clientSessionId: "catalog01" });
      assert.equal(ctx.session.getState().codeAgent?.identity, "fallback");
      assert.equal(ctx.session.getSkillsCatalog().disposition, "absent_non_vendor");
      assert.equal(ctx.session.getSkillsCatalog().commands, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
