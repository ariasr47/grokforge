import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
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

it("two Code sessions acquire distinct vendor children", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sga-iso-"));
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
    const runA = await a.prompt("one", "auto", { clientSessionId: "isolateA01" });
    const runB = await b.prompt("two", "auto", { clientSessionId: "isolateB01" });
    assert.notEqual(runA.runId, runB.runId);
    assert.notEqual(runA.sessionId, runB.sessionId);
    const pidA = Number((await fs.readFile(path.join(ws1, "vendor-pid.txt"), "utf8")).trim());
    const pidB = Number((await fs.readFile(path.join(ws2, "vendor-pid.txt"), "utf8")).trim());
    assert.ok(pidA > 0 && pidB > 0, "both sessions must spawn a vendor child");
    assert.notEqual(pidA, pidB);
  } finally {
    await a.shutdown().catch(() => undefined);
    await b.shutdown().catch(() => undefined);
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
