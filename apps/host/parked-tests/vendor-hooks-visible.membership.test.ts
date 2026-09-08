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
  grokAcp?: "ok" | "missing";
  sessionId?: string;
}): Promise<{ home: string; workspace: string; dataDir: string; session: AgentSession }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "hooks-mem-"));
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
  process.env.GROKFORGE_VENDOR_FIXTURE = opts.fixture;
  if (opts.grokAcp === "missing") {
    process.env.GROKFORGE_ROOT = path.join(home, "no-repo");
    process.env.GROKFORGE_AGENT_ENTRY = path.join(home, "missing-agent.mjs");
  } else {
    process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
    delete process.env.GROKFORGE_ROOT;
  }
  if (opts.pathHit === false) {
    process.env.PATH = emptyBin;
    process.env.Path = emptyBin;
  } else {
    await installSpawnableGrok(vendorBin, workspace);
    process.env.PATH = `${vendorBin}${path.delimiter}${emptyBin}`;
    process.env.Path = process.env.PATH;
  }
  const session = new AgentSession(opts.sessionId ?? "member01");
  await session.awaitReady();
  return { home, workspace, dataDir, session };
}

async function waitHooks(
  session: AgentSession,
  pred: (fact: ReturnType<AgentSession["getState"]>["hooks"]) => boolean,
  label: string,
  ms = 8000,
) {
  const deadline = Date.now() + ms;
  let last = session.getState().hooks;
  while (Date.now() < deadline) {
    last = session.getState().hooks;
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last)}`);
}

describe("vendor-hooks-visible membership dispositions", () => {
  it("Chat session → absent_for_non_code_or_non_vendor, members null, codeAgent null", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hooks-chat-"));
    process.env.GROKFORGE_CHANNEL = "test";
    process.env.GROKFORGE_DATA_DIR = path.join(home, "data");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const session = new AgentSession("chatmem01");
    try {
      await session.awaitReady();
      const state = session.getState();
      assert.equal(state.mode, "chat");
      assert.equal(state.codeAgent, null);
      assert.equal(state.hooks.disposition, "absent_for_non_code_or_non_vendor");
      assert.equal(state.hooks.members, null);
    } finally {
      await session.shutdown().catch(() => undefined);
      await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("Code fallback / hard_fail → absent; prior vendor members not projected live", async () => {
    const vendor = await setup({ fixture: "hooks" });
    try {
      await vendor.session.openWorkspace(vendor.workspace);
      const run = await vendor.session.prompt("go", "auto", { clientSessionId: "member01" });
      await waitHooks(
        vendor.session,
        (c) => c.disposition === "ready" && (c.members?.length ?? 0) > 0,
        "vendor ready members",
      );
      await vendor.session.replayRun(run.runId, "member01");
    } finally {
      await vendor.session.shutdown().catch(() => undefined);
    }

    const fallback = await setup({ fixture: "ok", pathHit: false });
    try {
      await fallback.session.openWorkspace(fallback.workspace);
      await fallback.session.prompt("go", "auto", { clientSessionId: "member01" }).catch(() => undefined);
      const state = fallback.session.getState();
      assert.ok(state.codeAgent?.identity === "fallback" || state.codeAgent?.identity === "hard_fail");
      assert.equal(state.hooks.disposition, "absent_for_non_code_or_non_vendor");
      assert.equal(state.hooks.members, null);
    } finally {
      await fallback.session.shutdown().catch(() => undefined);
      await fs.rm(fallback.home, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(vendor.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("hard_fail → absent_for_non_code_or_non_vendor", async () => {
    const ctx = await setup({ fixture: "ok", pathHit: false, grokAcp: "missing" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await assert.rejects(() => ctx.session.prompt("go", "auto", { clientSessionId: "member01" }));
      const state = ctx.session.getState();
      assert.equal(state.codeAgent?.identity, "hard_fail");
      assert.equal(state.hooks.disposition, "absent_for_non_code_or_non_vendor");
      assert.equal(state.hooks.members, null);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("Code+vendor catch-up in flight → hydrating; prior ready members retained", async () => {
    const ctx = await setup({ fixture: "hooks" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const first = await ctx.session.prompt("one", "auto", { clientSessionId: "member01" });
      await waitHooks(
        ctx.session,
        (c) => c.disposition === "ready" && c.members?.some((m) => m.hookId === "project/spire-path-guard:pre_tool_use[0].hooks[0]") === true,
        "first ready",
      );
      const idleDeadline = Date.now() + 8000;
      while (Date.now() < idleDeadline) {
        const replay = await ctx.session.replayRun(first.runId, "member01").catch(() => null);
        if (replay?.run.state === "terminal" && !ctx.session.getState().busy) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.equal(ctx.session.getState().busy, false);
      const hydrating: Array<{ disposition: string; members: unknown }> = [];
      ctx.session.on((ev) => {
        if (ev.type === "state" && ev.state.hooks.disposition === "hydrating") {
          hydrating.push({
            disposition: ev.state.hooks.disposition,
            members: ev.state.hooks.members,
          });
        }
      });
      await ctx.session.prompt("two", "auto", { clientSessionId: "member01" });
      assert.ok(
        hydrating.some((h) =>
          Array.isArray(h.members) &&
          (h.members as Array<{ hookId: string }>).some((m) => m.hookId === "project/spire-path-guard:pre_tool_use[0].hooks[0]"),
        ),
        `expected hydrating keep-last-ready, saw ${JSON.stringify(hydrating)}`,
      );
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("ready + zero hooks → ready + []", async () => {
    const ctx = await setup({ fixture: "ok" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const connectedBefore = ctx.session.getState().connected;
      assert.equal(connectedBefore, false);
      assert.equal(ctx.session.getState().codeAgent?.identity, "vendor");
      assert.notEqual(ctx.session.getState().hooks.disposition, "absent_for_non_code_or_non_vendor");
      await ctx.session.prompt("hi", "auto", { clientSessionId: "member01" });
      const cat = await waitHooks(
        ctx.session,
        (c) => c.disposition === "ready" && Array.isArray(c.members) && c.members.length === 0,
        "ready empty",
      );
      assert.equal(cat.disposition, "ready");
      assert.deepEqual(cat.members, []);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("Idle is a member under ready — not quiet empty", async () => {
    const ctx = await setup({ fixture: "hooks" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("go", "auto", { clientSessionId: "member01" });
      const cat = await waitHooks(
        ctx.session,
        (c) => c.disposition === "ready" && (c.members?.length ?? 0) >= 1,
        "idle or later member",
      );
      assert.ok((cat.members?.length ?? 0) >= 1);
      assert.notEqual(cat.disposition, "absent_for_non_code_or_non_vendor");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("journal obtain failure → obtain_failed keeps last-ready members", async () => {
    const ctx = await setup({ fixture: "hooks" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("hi", "auto", { clientSessionId: "member01" });
      await waitHooks(
        ctx.session,
        (c) => c.disposition === "ready" && (c.members?.length ?? 0) > 0,
        "ready before corrupt",
      );
      const priorId = ctx.session.getState().hooks.members?.[0]?.hookId;
      const eventsFile = path.join(ctx.dataDir, "runs", "member01", run.runId, "events.jsonl");
      await fs.writeFile(eventsFile, "{bad}\n", "utf8");
      await assert.rejects(() => ctx.session.replayRun(run.runId, "member01"));
      assert.equal(ctx.session.getState().hooks.disposition, "obtain_failed");
      assert.equal(ctx.session.getState().hooks.members?.length, 1);
      assert.equal(ctx.session.getState().hooks.members?.[0]?.hookId, priorId);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("malformed individual hooks frame does not flip obtain_failed", async () => {
    const ctx = await setup({ fixture: "hooks-incomplete" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "member01" });
      await waitHooks(
        ctx.session,
        (c) => c.disposition === "ready" || c.disposition === "hydrating",
        "journal applied",
      );
      await ctx.session.replayRun(run.runId, "member01");
      assert.notEqual(ctx.session.getState().hooks.disposition, "obtain_failed");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("reload/replay restores journaled identities + vouched Idle/Done/Failed", async () => {
    const ctx = await setup({ fixture: "hooks-first-done", sessionId: "reload01" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "reload01" });
      await waitHooks(
        ctx.session,
        (c) => c.members?.some((m) => m.hookId === "project/settings:pre_tool_use[0].hooks[0]" && m.status === "done") === true,
        "journaled done",
      );
      await ctx.session.shutdown().catch(() => undefined);

      const session2 = new AgentSession("reload01");
      try {
        await session2.awaitReady();
        await session2.openWorkspace(ctx.workspace);
        const restored = await waitHooks(
          session2,
          (c) => c.disposition === "ready" && c.members?.some((m) => m.hookId === "project/settings:pre_tool_use[0].hooks[0]" && m.status === "done") === true,
          "restored members",
        );
        assert.equal(restored.members?.length, 1);
        const replay = await session2.replayRun(run.runId, "reload01");
        assert.ok(replay.events.some((e) => e.type === "hook_update" && e.payload.kind === "hook_update"));
      } finally {
        await session2.shutdown().catch(() => undefined);
      }
    } finally {
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("disk / Skills / MCP / installer-hooks catalog alone does not invent hooks members", async () => {
    const ctx = await setup({ fixture: "ok" });
    try {
      await fs.mkdir(path.join(ctx.home, ".grok", "hooks"), { recursive: true });
      await fs.writeFile(
        path.join(ctx.home, ".grok", "hooks", "ghost.json"),
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo" }] }] } }),
        "utf8",
      );
      await ctx.session.openWorkspace(ctx.workspace);
      await ctx.session.prompt("hi", "auto", { clientSessionId: "member01" });
      const cat = await waitHooks(
        ctx.session,
        (c) => c.disposition === "ready" && Array.isArray(c.members),
        "ready after disk config",
      );
      assert.deepEqual(cat.members, []);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
