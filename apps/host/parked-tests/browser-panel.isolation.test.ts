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

async function waitMembers(session: AgentSession, toolCallId: string, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const members = session.getState().browserWork.members;
    if (members?.some((m) => m.toolCallId === toolCallId)) return members;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${toolCallId}: ${JSON.stringify(session.getState().browserWork)}`);
}

describe("browser-panel isolation", () => {
  it("two concurrent sessions do not share browser-work sets", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "browser-iso-"));
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
    process.env.GROKFORGE_VENDOR_FIXTURE = "browser-fetch-multi";
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
      await waitMembers(a, "fetch-a");
      await waitMembers(a, "fetch-b");
      await waitMembers(b, "fetch-a");
      await waitMembers(b, "fetch-b");
      const replayA = await a.replayRun(runA.runId, "isolateA01");
      const replayB = await b.replayRun(runB.runId, "isolateB01");
      assert.equal(replayA.events.some((e) => e.sessionId === "isolateB01"), false);
      assert.equal(replayB.events.some((e) => e.sessionId === "isolateA01"), false);
      assert.notEqual(runA.runId, runB.runId);
      const idsA = (a.getState().browserWork.members ?? []).map((m) => m.toolCallId).sort();
      const idsB = (b.getState().browserWork.members ?? []).map((m) => m.toolCallId).sort();
      assert.deepEqual(idsA, ["fetch-a", "fetch-b"]);
      assert.deepEqual(idsB, ["fetch-a", "fetch-b"]);
      assert.notEqual(a.getState().session?.sessionId, b.getState().session?.sessionId);
    } finally {
      await a.shutdown().catch(() => undefined);
      await b.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("foreign connectionGeneration fetch frame drops before journal apply", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-gen-"));
    try {
      const c = new RunCoordinator(new RunJournal(root));
      const run = await c.admit({ sessionId: "gen-s", prompt: "x", connectionGeneration: 3, policy, model });
      await assert.rejects(
        () =>
          c.appendOwnedEvent(
            run.runId,
            {
              kind: "activity_update",
              activity: {
                activityId: "foreign",
                invocationId: "foreign",
                name: "fetch",
                lifecycle: "pending",
                execution: null,
                status: "running",
                input: null,
                output: null,
                error: null,
                diff: null,
                path: null,
                kind: null,
                fromPath: null,
                toPath: null,
                policy,
                automaticEligibility: "not_eligible",
                autoApplied: false,
                command: null,
                editId: null,
                recovery: null,
                summary: null,
                title: "Nope",
                acpToolKind: "fetch",
                url: "https://evil.example",
                snapshotJournaled: false,
              },
            },
            "activity_update",
            1,
          ),
        (err: unknown) => (err as { code?: string }).code === "stale_generation",
      );
      const events = await new RunJournal(root).replay("gen-s", run.runId);
      assert.equal(
        events.some((e) => {
          if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
          return (e.payload.activity as { invocationId?: string }).invocationId === "foreign";
        }),
        false,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("fetch-caused Review permission ask still uses existing dock decision_request", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "browser-perm-"));
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
      const run = await session.prompt("go", "auto", { clientSessionId: "perm01" });
      const deadline = Date.now() + 8000;
      let replay: Awaited<ReturnType<AgentSession["replayRun"]>> | null = null;
      while (Date.now() < deadline) {
        replay = await session.replayRun(run.runId, "perm01").catch(() => replay);
        if (replay?.events.some((e) => e.type === "decision_request")) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(replay?.events.some((e) => e.type === "decision_request"));
      const decision = replay!.events.find((e) => e.type === "decision_request");
      assert.equal(decision?.payload.kind, "decision_request");
      if (decision?.payload.kind === "decision_request") {
        assert.equal(decision.payload.request.kind, "permission");
      }
      assert.equal(replay!.events.some((e) => e.type === "child_agent_update"), false);
    } finally {
      await session.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
