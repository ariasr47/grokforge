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

async function setup(opts: { fixture: string }): Promise<{
  home: string;
  workspace: string;
  dataDir: string;
  session: AgentSession;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ing-"));
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
  process.env.GROKFORGE_AGENT_ENTRY = fakeAgent;
  process.env.GROKFORGE_VENDOR_FIXTURE = opts.fixture;
  await installSpawnableGrok(vendorBin, workspace);
  process.env.PATH = `${vendorBin}${path.delimiter}${emptyBin}`;
  process.env.Path = process.env.PATH;
  const session = new AgentSession("ingress01");
  await session.awaitReady();
  return { home, workspace, dataDir, session };
}

async function waitReplay(
  session: AgentSession,
  runId: string,
  sessionId: string,
  pred: (body: { events: Array<{ type: string; payload: { kind: string; [k: string]: unknown } }> }) => boolean,
  label: string,
  ms = 8000,
) {
  const deadline = Date.now() + ms;
  let last: Awaited<ReturnType<AgentSession["replayRun"]>> | null = null;
  while (Date.now() < deadline) {
    last = await session.replayRun(runId, sessionId).catch(() => last);
    if (last && pred(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last?.events?.map((e) => e.type))}`);
}

describe("vendor-mcp-visible ingress remap", () => {
  it("complete named frame → journal type/kind mcp_server_update", async () => {
    const ctx = await setup({ fixture: "mcp-server" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "mcp_server_update" && e.payload.kind === "mcp_server_update"),
        "mcp_server_update",
      );
      const hits = replay.events.filter((e) => e.type === "mcp_server_update");
      assert.ok(hits.length >= 1);
      for (const hit of hits) {
        assert.equal(hit.type, "mcp_server_update");
        assert.equal(hit.payload.kind, "mcp_server_update");
        if (hit.payload.kind !== "mcp_server_update") return;
        assert.equal(hit.payload.serverId, "railway");
        assert.equal(hit.payload.name, "railway");
        assert.equal(hit.payload.status, "connected");
      }
      const members = ctx.session.getState().mcpServers.members ?? [];
      assert.equal(members.some((m) => m.serverId === "railway" && m.status === "connected"), true);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("same MCP identity does not dual-map Skills / child / browser / thought", async () => {
    const ctx = await setup({ fixture: "mcp-server" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "mcp_server_update"),
        "mcp_server_update",
      );
      assert.equal(replay.events.some((e) => e.type === "child_agent_update"), false);
      const skills = ctx.session.getState().skillsCatalog.commands ?? [];
      assert.equal(skills.some((c) => c.name === "railway" || c.name === "/railway"), false);
      const browser = ctx.session.getState().browserWork.members ?? [];
      assert.equal(browser.some((m) => m.toolCallId === "railway" || m.title === "railway"), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("incomplete MCP frame → no member; not obtain_failed", async () => {
    const ctx = await setup({ fixture: "mcp-server-incomplete" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "run_terminal"),
        "terminal",
      );
      assert.equal((ctx.session.getState().mcpServers.members ?? []).length, 0);
      assert.notEqual(ctx.session.getState().mcpServers.disposition, "obtain_failed");
      const replay = await ctx.session.replayRun(run.runId, "ingress01");
      assert.equal(replay.events.some((e) => e.type === "mcp_server_update"), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("multi-server preserves two identities", async () => {
    const ctx = await setup({ fixture: "mcp-server-multi" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.filter((e) => e.type === "mcp_server_update").length >= 2,
        "two mcp_server_update",
      );
      const ids = (ctx.session.getState().mcpServers.members ?? []).map((m) => m.serverId).sort();
      assert.deepEqual(ids, ["chrome-devtools", "railway"]);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("first error stays error until a later frame (no coerce to connected)", async () => {
    const ctx = await setup({ fixture: "mcp-server-first-error" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "mcp_server_update"),
        "mcp_server_update",
      );
      const m = (ctx.session.getState().mcpServers.members ?? []).find((x) => x.serverId === "figma");
      assert.equal(m?.status, "error");
      assert.equal(m?.restore, "restored");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("name is vouched only; does not invent a display name", async () => {
    const ctx = await setup({ fixture: "mcp-server" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "mcp_server_update"),
        "mcp_server_update",
      );
      const m = (ctx.session.getState().mcpServers.members ?? []).find((x) => x.serverId === "railway");
      assert.equal(m?.name, "railway");
      assert.notEqual(m?.name, "Docs");
      assert.notEqual(m?.name, "MCP server");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("unmapped kind logs Unmapped vendor sessionUpdate kind and invents no members", async () => {
    const ctx = await setup({ fixture: "mcp-server-unmapped" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "run_terminal"),
        "terminal",
      );
      const logText = await fs.readFile(path.join(ctx.dataDir, "logs", "host.log"), "utf8").catch(() => "");
      assert.match(logText, /Unmapped vendor sessionUpdate kind/);
      assert.equal((ctx.session.getState().mcpServers.members ?? []).length, 0);
      const replay = await ctx.session.replayRun(run.runId, "ingress01");
      assert.equal(replay.events.some((e) => e.type === "mcp_server_update"), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("post-terminal idle/error appends and advances status", async () => {
    const ctx = await setup({ fixture: "mcp-server-late-idle" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some(
            (e) => e.type === "mcp_server_update" && e.payload.kind === "mcp_server_update" && e.payload.status === "idle",
          ),
        "post-terminal idle",
      );
      const terminalSeq = replay.events.find((e) => e.type === "run_terminal")!.eventSeq;
      const idle = replay.events.find(
        (e) => e.type === "mcp_server_update" && e.payload.kind === "mcp_server_update" && e.payload.status === "idle",
      )!;
      assert.ok(idle.eventSeq > terminalSeq);
      assert.equal(
        (ctx.session.getState().mcpServers.members ?? []).find((m) => m.serverId === "railway")?.status,
        "idle",
      );
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("cancel-while-connected then error is not frozen without an Error path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-jl-"));
    try {
      const c = new RunCoordinator(new RunJournal(root));
      const run = await c.admit({ sessionId: "s", prompt: "x", connectionGeneration: 1, policy, model });
      await c.appendOwnedEvent(
        run.runId,
        { kind: "mcp_server_update", serverId: "s1", name: "Docs", status: "connected" },
        "mcp_server_update",
        1,
      );
      const { won } = await c.finalize(run.runId, "cancelled", null);
      assert.equal(won, true);
      const late = await c.appendAfterTerminalEvent(
        run.runId,
        { kind: "mcp_server_update", serverId: "s1", name: "Docs", status: "error" },
        "mcp_server_update",
      );
      assert.equal(late.type, "mcp_server_update");
      if (late.payload.kind === "mcp_server_update") {
        assert.equal(late.payload.status, "error");
      }
      const events = await new RunJournal(root).replay("s", run.runId);
      assert.ok(events.some((e) => e.type === "run_terminal"));
      assert.ok(
        events.some(
          (e) => e.type === "mcp_server_update" && e.payload.kind === "mcp_server_update" && e.payload.status === "error",
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
