import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentSession } from "./session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");

const orig = {
  PATH: process.env.PATH,
  Path: process.env.Path,
  DATA: process.env.GROKFORGE_DATA_DIR,
  AGENT: process.env.GROKFORGE_AGENT_ENTRY,
  MARK: process.env.GROKFORGE_SPAWN_MARK,
  KEY: process.env.XAI_API_KEY,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  CHANNEL: process.env.GROKFORGE_CHANNEL,
};

async function isolate(opts: { pathDirs: string[]; mark: string; home: string }) {
  process.env.GROKFORGE_CHANNEL = "test";
  process.env.GROKFORGE_DATA_DIR = path.join(opts.home, "data");
  process.env.HOME = opts.home;
  process.env.USERPROFILE = opts.home;
  process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
  process.env.GROKFORGE_SPAWN_MARK = opts.mark;
  process.env.XAI_API_KEY = "fixture-key";
  const joined = opts.pathDirs.join(path.delimiter);
  process.env.PATH = joined;
  process.env.Path = joined;
}

async function restore() {
  for (const [k, v] of Object.entries(orig)) {
    const envKey =
      k === "PATH" ? "PATH" :
      k === "Path" ? "Path" :
      k === "DATA" ? "GROKFORGE_DATA_DIR" :
      k === "AGENT" ? "GROKFORGE_AGENT_ENTRY" :
      k === "MARK" ? "GROKFORGE_SPAWN_MARK" :
      k === "KEY" ? "XAI_API_KEY" :
      k === "HOME" ? "HOME" :
      k === "USERPROFILE" ? "USERPROFILE" :
      "GROKFORGE_CHANNEL";
    if (v === undefined) delete process.env[envKey];
    else process.env[envKey] = v;
  }
}

afterEach(async () => {
  await restore();
});

async function withSession<T>(
  pathHit: boolean,
  fn: (s: AgentSession, ctx: { workspace: string; mark: string; home: string }) => Promise<T>,
): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sga-eager-"));
  const workspace = path.join(home, "ws");
  const emptyBin = path.join(home, "empty-bin");
  const vendorBin = path.join(home, "vendor-bin");
  const mark = path.join(home, "spawned.mark");
  await fs.mkdir(workspace);
  await fs.mkdir(emptyBin);
  await fs.mkdir(vendorBin);
  if (pathHit) {
    await fs.writeFile(path.join(vendorBin, process.platform === "win32" ? "grok.exe" : "grok"), "");
  }
  const markerAgent = path.join(home, "marker-agent.mjs");
  await fs.writeFile(
    markerAgent,
    `import fs from "node:fs";
if (process.env.GROKFORGE_SPAWN_MARK) fs.writeFileSync(process.env.GROKFORGE_SPAWN_MARK, "spawned");
await import(${JSON.stringify(pathToFileURL(fakeAgent).href)});
`,
    "utf8",
  );
  await isolate({
    pathDirs: pathHit ? [vendorBin, emptyBin] : [emptyBin],
    mark,
    home,
  });
  process.env.GROKFORGE_AGENT_ENTRY = markerAgent;
  const s = new AgentSession("eagertest01");
  try {
    await s.awaitReady();
    return await fn(s, { workspace, mark, home });
  } finally {
    await s.shutdown().catch(() => undefined);
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
}

describe("eager Code codeAgent without spawn", () => {
  it("PATH miss stamps house, connected false, no child", async () => {
    await withSession(false, async (s, ctx) => {
      const state = await s.openWorkspace(ctx.workspace);
      assert.equal(state.mode, "code");
      assert.deepEqual(state.codeAgent, {
        resolveStatus: "ready",
        identity: "house",
        fallbackReason: null,
      });
      assert.equal(state.connected, false);
      assert.equal(state.sessionId, null);
      await assert.equal(await exists(ctx.mark), false);
    });
  });

  it("PATH grok.exe still stamps house, connected false, no vendor spawn", async () => {
    await withSession(true, async (s, ctx) => {
      const state = await s.openWorkspace(ctx.workspace);
      assert.equal(state.mode, "code");
      assert.deepEqual(state.codeAgent, {
        resolveStatus: "ready",
        identity: "house",
        fallbackReason: null,
      });
      assert.equal(state.connected, false);
      assert.equal(state.sessionId, null);
      await assert.equal(await exists(ctx.mark), false);
    });
  });

  it("Chat setMode clears codeAgent and still spawns grok-acp", async () => {
    await withSession(true, async (s, ctx) => {
      await s.openWorkspace(ctx.workspace);
      const chat = await s.setMode("chat");
      assert.equal(chat.codeAgent, null);
      assert.equal(chat.mode, "chat");
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (s.getState().connected && (await exists(ctx.mark))) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(s.getState().codeAgent, null);
      assert.equal(s.getState().connected, true);
      assert.equal(await exists(ctx.mark), true);
    });
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
