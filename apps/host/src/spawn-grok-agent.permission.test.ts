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

it("Review vendor session/request_permission docks and Allow replies ACP result", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sga-perm-"));
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
  const session = new AgentSession("perm01");
  try {
    await session.awaitReady();
    await session.openWorkspace(workspace);
    const run = await session.prompt("mutate", "auto", { clientSessionId: "perm01" });
    let decision: { requestId: string; invocationId: string } | undefined;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const replay = await session.replayRun(run.runId, "perm01");
      const pending = replay.events.find((e) => e.type === "decision_request" && e.payload.kind === "decision_request" && e.payload.request.status === "pending");
      if (pending && pending.payload.kind === "decision_request") {
        decision = { requestId: pending.payload.request.requestId, invocationId: pending.payload.request.invocationId };
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(decision, "Review must mint decision_request for vendor permission ask");
    const settled = await session.permission(
      decision.requestId,
      "allow_once",
      { sessionId: "perm01", runId: run.runId, connectionGeneration: run.connectionGeneration },
      decision.invocationId,
    );
    assert.equal(settled, "accepted");
    let result: { id?: unknown; result?: { outcome?: { outcome?: string; optionId?: string } }; method?: string } | undefined;
    const wait = Date.now() + 8000;
    while (Date.now() < wait) {
      try {
        const rec = JSON.parse(await fs.readFile(path.join(dataDir, "vendor-spawn.json"), "utf8"));
        if (rec.permissionResult) {
          result = rec.permissionResult;
          break;
        }
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(result, "child must receive JSON-RPC result");
    assert.equal(result.id, 7);
    assert.equal(result.method, undefined);
    assert.equal(result.result?.outcome?.outcome, "selected");
    assert.equal(result.result?.outcome?.optionId, "allow_once");
  } finally {
    await session.shutdown().catch(() => undefined);
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
