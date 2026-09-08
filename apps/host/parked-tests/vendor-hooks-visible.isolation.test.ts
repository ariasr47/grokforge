import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentSession } from "./session.js";
import { RunCoordinator } from "./run-coordinator.js";
import { RunJournal } from "./run-journal.js";

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

const policy = {
  workspace: "",
  storedMode: null,
  effectiveMode: "review" as const,
  source: "fallback" as const,
  revision: "test",
  fallbackReason: "missing" as const,
  snapshottedAt: new Date().toISOString(),
};
const model = { requestedModel: "grok-4.6", appliedModel: "grok-4.6", selectionProvenance: "inherited" as const };

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

async function waitMembers(session: AgentSession, hookId: string, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const members = session.getState().hooks.members;
    if (members?.some((m) => m.hookId === hookId)) return members;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${hookId}: ${JSON.stringify(session.getState().hooks)}`);
}

describe("vendor-hooks-visible isolation", () => {
  it("two concurrent sessions do not share hooks rosters", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hooks-iso-"));
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
    process.env.GROKFORGE_VENDOR_FIXTURE = "hooks-multi";
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
      await waitMembers(a, "project/settings:pre_tool_use[0].hooks[0]");
      await waitMembers(a, "project/spire-path-guard:pre_tool_use[0].hooks[0]");
      await waitMembers(b, "project/settings:pre_tool_use[0].hooks[0]");
      await waitMembers(b, "project/spire-path-guard:pre_tool_use[0].hooks[0]");
      const replayA = await a.replayRun(runA.runId, "isolateA01");
      const replayB = await b.replayRun(runB.runId, "isolateB01");
      assert.equal(replayA.events.some((e) => e.sessionId === "isolateB01"), false);
      assert.equal(replayB.events.some((e) => e.sessionId === "isolateA01"), false);
      assert.notEqual(runA.runId, runB.runId);
      const idsA = (a.getState().hooks.members ?? []).map((m) => m.hookId).sort();
      const idsB = (b.getState().hooks.members ?? []).map((m) => m.hookId).sort();
      assert.deepEqual(idsA, [
        "project/settings:pre_tool_use[0].hooks[0]",
        "project/spire-path-guard:pre_tool_use[0].hooks[0]",
      ]);
      assert.deepEqual(idsB, [
        "project/settings:pre_tool_use[0].hooks[0]",
        "project/spire-path-guard:pre_tool_use[0].hooks[0]",
      ]);
      assert.notEqual(a.getState().session?.sessionId, b.getState().session?.sessionId);
    } finally {
      await a.shutdown().catch(() => undefined);
      await b.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("foreign connectionGeneration hooks frame drops before journal apply", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hooks-gen-"));
    try {
      const c = new RunCoordinator(new RunJournal(root));
      const run = await c.admit({ sessionId: "gen-s", prompt: "x", connectionGeneration: 3, policy, model });
      await assert.rejects(
        () =>
          c.appendOwnedEvent(
            run.runId,
            { kind: "hook_update", hookId: "h1", name: "PreTool", status: "idle" },
            "hook_update",
            99,
          ),
        (err: unknown) => (err as { code?: string }).code === "stale_generation" || /stale/.test(String(err)),
      );
      await c.appendOwnedEvent(
        run.runId,
        { kind: "hook_update", hookId: "h1", name: "PreTool", status: "idle" },
        "hook_update",
        3,
      );
      const events = await new RunJournal(root).replay("gen-s", run.runId);
      assert.equal(events.filter((e) => e.type === "hook_update").length, 1);
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
