import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

async function setup(fixture = "ok"): Promise<{
  home: string;
  workspace: string;
  dataDir: string;
  session: AgentSession;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-hand-"));
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
  const session = new AgentSession("handoff01");
  await session.awaitReady();
  await session.openWorkspace(workspace);
  return { home, workspace, dataDir, session };
}

async function readSpawn(dataDir: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, "vendor-spawn.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("slash-skills skillHandoff consume / refuse", () => {
  it("armed accept stamps consumed and delivers /forge-skill-fixture text", async () => {
    const ctx = await setup("ok");
    try {
      const run = await ctx.session.prompt("/forge-skill-fixture", "auto", {
        clientSessionId: "handoff01",
        skillHandoff: { name: "/forge-skill-fixture" },
      });
      assert.equal(run.skillHandoffProvenance?.kind, "consumed");
      assert.equal(run.skillHandoffProvenance?.name, "/forge-skill-fixture");
      const spawn = await readSpawn(ctx.dataDir);
      assert.equal(spawn?.lastPrompt, "/forge-skill-fixture");
      const deadline = Date.now() + 4000;
      let thought = false;
      while (Date.now() < deadline) {
        const replay = await ctx.session.replayRun(run.runId, "handoff01");
        thought = replay.events.some(
          (e) =>
            e.type === "reasoning_delta" &&
            e.payload.kind === "reasoning_delta" &&
            e.payload.delta.includes("FORGE_SKILL_FIXTURE_ACTIVATED"),
        );
        if (thought) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(thought, true);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("same slash text with skillHandoff omitted → provenance none (host does not guess)", async () => {
    const ctx = await setup("ok");
    try {
      const run = await ctx.session.prompt("/forge-skill-fixture", "auto", {
        clientSessionId: "handoff01",
      });
      assert.equal(run.skillHandoffProvenance?.kind, "none");
      assert.equal(run.skillHandoffProvenance?.name, null);
      const spawn = await readSpawn(ctx.dataDir);
      assert.equal(spawn?.lastPrompt, "/forge-skill-fixture");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("armed missing from catalog → skill_handoff_unavailable, no session/prompt, no consumed", async () => {
    const ctx = await setup("ok");
    try {
      let caught: { code?: string; message?: string } | null = null;
      try {
        await ctx.session.prompt("/gone", "auto", {
          clientSessionId: "handoff01",
          skillHandoff: { name: "/gone" },
        });
      } catch (e) {
        caught = e as { code?: string; message?: string };
      }
      assert.equal(caught?.code, "skill_handoff_unavailable");
      assert.equal(caught?.message, "Skill no longer available.");
      assert.equal(ctx.session.getActiveRunId(), null);
      const spawn = await readSpawn(ctx.dataDir);
      assert.equal(spawn?.lastPrompt, undefined);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("unarmed unmatched slash text → provenance none", async () => {
    const ctx = await setup("ok");
    try {
      const run = await ctx.session.prompt("/not-a-listed-skill", "auto", {
        clientSessionId: "handoff01",
        skillHandoff: null,
      });
      assert.equal(run.skillHandoffProvenance?.kind, "none");
      assert.equal(run.skillHandoffProvenance?.name, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("Chat armed send refuses without guessing", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-hand-chat-"));
    process.env.GROKFORGE_CHANNEL = "test";
    process.env.GROKFORGE_DATA_DIR = path.join(home, "data");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
    process.env.XAI_API_KEY = "host-secret";
    const session = new AgentSession("handoffchat");
    try {
      await session.awaitReady();
      let caught: { code?: string } | null = null;
      try {
        await session.prompt("/forge-skill-fixture", "auto", {
          clientSessionId: "handoffchat",
          skillHandoff: { name: "/forge-skill-fixture" },
        });
      } catch (e) {
        caught = e as { code?: string };
      }
      assert.equal(caught?.code, "skill_handoff_unavailable");
      assert.equal(session.getState().skillsCatalog.disposition, "absent_non_vendor");
    } finally {
      await session.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("HTTP POST /api/prompt consume is 202 consumed; missing name is 409", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-hand-http-"));
    const workspace = path.join(home, "ws");
    const vendorBin = path.join(home, "vendor-bin");
    await fs.mkdir(workspace);
    await installSpawnableGrok(vendorBin, workspace);
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const host = await startHost({
      port,
      homeDir: home,
      env: {
        GROKFORGE_AGENT_ENTRY: fakeAgent,
        GROKFORGE_VENDOR_FIXTURE: "ok",
        XAI_API_KEY: "host-secret",
        PATH: vendorBin,
        Path: vendorBin,
      },
    });
    try {
      const opened = await fetch(`${host.baseUrl}/api/workspace`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: workspace }),
      });
      assert.equal(opened.status, 200, await opened.text());
      const accepted = await fetch(`${host.baseUrl}/api/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "handoffhttp01",
          text: "/forge-skill-fixture",
          skillHandoff: { name: "/forge-skill-fixture" },
        }),
      });
      const acceptedRaw = await accepted.text();
      assert.equal(accepted.status, 202, acceptedRaw);
      const acceptedBody = JSON.parse(acceptedRaw) as {
        run: { skillHandoffProvenance?: { kind?: string; name?: string | null } };
      };
      assert.equal(acceptedBody.run.skillHandoffProvenance?.kind, "consumed");
      assert.equal(acceptedBody.run.skillHandoffProvenance?.name, "/forge-skill-fixture");

      const refused = await fetch(`${host.baseUrl}/api/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "handoffhttp02",
          text: "/gone",
          skillHandoff: { name: "/gone" },
        }),
      });
      const refusedRaw = await refused.text();
      assert.equal(refused.status, 409, refusedRaw);
      const refusedBody = JSON.parse(refusedRaw) as { code?: string; error?: string };
      assert.equal(refusedBody.code, "skill_handoff_unavailable");
      assert.equal(refusedBody.error, "Skill no longer available.");
    } finally {
      await host.stop();
    }
  });
});
