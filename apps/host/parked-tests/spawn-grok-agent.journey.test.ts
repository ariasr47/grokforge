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

it("CLI present → unique tuple → session/update kinds journal → Review docks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sga-journey-"));
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
  process.env.GROKFORGE_VENDOR_FIXTURE = "journey";
  process.env.PATH = vendorBin;
  process.env.Path = vendorBin;
  const session = new AgentSession("journey01");
  try {
    await session.awaitReady();
    await session.openWorkspace(workspace);
    const run = await session.prompt("go", "auto", { clientSessionId: "journey01" });
    assert.equal(session.getState().codeAgent?.identity, "vendor");
    assert.equal(run.codeAgentProvenance?.identity, "vendor");
    const spawn = JSON.parse(await fs.readFile(path.join(dataDir, "vendor-spawn.json"), "utf8"));
    assert.match(String(spawn.argv[0]), /grok(\.exe)?$/i);
    assert.ok(spawn.argv.includes("stdio"));
    assert.equal(spawn.initialize?.permissionMode, "default");
    assert.equal(spawn.hasXai, false);

    const deadline = Date.now() + 8000;
    let kinds: string[] = [];
    while (Date.now() < deadline) {
      const replay = await session.replayRun(run.runId, "journey01");
      kinds = replay.events.map((e) => e.type);
      const hasThought = kinds.includes("reasoning_delta");
      const hasMessage = kinds.includes("message_delta");
      const hasTool = kinds.includes("activity_update");
      const hasDock = kinds.includes("decision_request");
      if (hasThought && hasMessage && hasTool && hasDock) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(kinds.includes("reasoning_delta"), `missing reasoning_delta in ${kinds.join(",")}`);
    assert.ok(kinds.includes("message_delta"), `missing message_delta in ${kinds.join(",")}`);
    assert.ok(kinds.includes("activity_update"), `missing activity_update in ${kinds.join(",")}`);
    assert.ok(kinds.includes("decision_request"), `missing decision_request in ${kinds.join(",")}`);
    assert.equal(kinds.includes("answer_delta"), false);
    assert.equal(kinds.includes("session/update"), false);
  } finally {
    await session.shutdown().catch(() => undefined);
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
