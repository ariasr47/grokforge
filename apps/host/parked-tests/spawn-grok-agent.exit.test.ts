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

it("post-live vendor exit is agent_exited with no grok-acp swap", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sga-exit-"));
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
  process.env.GROKFORGE_VENDOR_FIXTURE = "exit-after-live";
  process.env.PATH = vendorBin;
  process.env.Path = vendorBin;
  const session = new AgentSession("exit01");
  try {
    await session.awaitReady();
    await session.openWorkspace(workspace);
    const grokStarts: string[] = [];
    session.on((ev) => {
      if (ev.type === "agent_log" && /starting agent|fake-session-1/.test(ev.message)) grokStarts.push(ev.message);
    });
    const run = await session.prompt("hi", "auto", { clientSessionId: "exit01" });
    assert.equal(session.getState().codeAgent?.identity, "vendor");
    let terminal: { failure?: { code?: string } | null; terminalKind?: string | null } | undefined;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const replay = await session.replayRun(run.runId, "exit01");
      if (replay.run.state === "terminal") {
        terminal = replay.run;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(terminal?.terminalKind, "failed");
    assert.equal(terminal?.failure?.code, "agent_exited");
    assert.equal(session.getState().codeAgent?.identity, "vendor");
    assert.equal(session.getState().codeAgent?.identity, "vendor");
    const replay = await session.replayRun(run.runId, "exit01");
    assert.ok(replay.events.some((e) => e.type === "run_terminal" && e.payload.kind === "run_terminal" && e.payload.failure?.code === "agent_exited"));
    assert.equal(session.getState().codeAgent?.fallbackReason, null);
  } finally {
    await session.shutdown().catch(() => undefined);
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
