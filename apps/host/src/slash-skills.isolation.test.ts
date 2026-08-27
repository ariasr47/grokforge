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

async function waitForCatalog(session: AgentSession, disposition: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (session.getSkillsCatalog().disposition === disposition) return session.getSkillsCatalog();
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for ${disposition}: ${JSON.stringify(session.getSkillsCatalog())}`);
}

describe("slash-skills isolation + dock", () => {
  it("two concurrent sessions do not share catalogs", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-iso-"));
    const ws1 = path.join(home, "ws1");
    const ws2 = path.join(home, "ws2");
    const dataDir = path.join(home, "data");
    const vendorBin = path.join(home, "vendor-bin");
    await fs.mkdir(ws1);
    await fs.mkdir(ws2);
    await fs.mkdir(dataDir);
    await installSpawnableGrok(vendorBin, ws1);
    await installSpawnableGrok(vendorBin, ws2);
    process.env.GROKFORGE_CHANNEL = "test";
    process.env.GROKFORGE_DATA_DIR = dataDir;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.XAI_API_KEY = "host-secret";
    process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
    process.env.GROKFORGE_VENDOR_FIXTURE = "ok";
    process.env.PATH = vendorBin;
    process.env.Path = vendorBin;
    const a = new AgentSession("isolateA01");
    const b = new AgentSession("isolateB01");
    try {
      await a.awaitReady();
      await b.awaitReady();
      await a.openWorkspace(ws1);
      await b.openWorkspace(ws2);
      await a.prompt("one", "auto", { clientSessionId: "isolateA01" });
      await b.prompt("two", "auto", { clientSessionId: "isolateB01" });
      await waitForCatalog(a, "ready");
      await waitForCatalog(b, "ready");
      const pidA = Number((await fs.readFile(path.join(ws1, "vendor-pid.txt"), "utf8")).trim());
      try { process.kill(pidA); } catch { /* already gone */ }
      await waitForCatalog(a, "awaiting_first_valid");
      assert.equal(b.getSkillsCatalog().disposition, "ready");
      assert.equal(b.getSkillsCatalog().commands?.[0]?.name, "/forge-skill-fixture");
      assert.notEqual(a.getSkillsCatalog().disposition, "ready");
    } finally {
      await a.shutdown().catch(() => undefined);
      await b.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("skill-driven Review permission still mints dock decision_request", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "slash-dock-"));
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
    process.env.GROKFORGE_VENDOR_FIXTURE = "request-permission";
    process.env.PATH = vendorBin;
    process.env.Path = vendorBin;
    const session = new AgentSession("dockskill01");
    try {
      await session.awaitReady();
      await session.openWorkspace(workspace);
      const run = await session.prompt("/forge-skill-fixture", "auto", {
        clientSessionId: "dockskill01",
        skillHandoff: { name: "/forge-skill-fixture" },
      });
      assert.equal(run.skillHandoffProvenance?.kind, "consumed");
      const deadline = Date.now() + 8000;
      let hasDock = false;
      while (Date.now() < deadline) {
        const replay = await session.replayRun(run.runId, "dockskill01");
        hasDock = replay.events.some((e) => e.type === "decision_request");
        if (hasDock) break;
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(hasDock, true);
    } finally {
      await session.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
