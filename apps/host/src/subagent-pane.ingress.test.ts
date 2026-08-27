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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-ing-"));
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

describe("subagent-pane ingress remap", () => {
  it("complete fixture agent frame → journal type/kind child_agent_update", async () => {
    const ctx = await setup({ fixture: "child-agent" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "child_agent_update" && e.payload.kind === "child_agent_update"),
        "child_agent_update",
      );
      const hits = replay.events.filter((e) => e.type === "child_agent_update");
      assert.ok(hits.length >= 1);
      for (const hit of hits) {
        assert.equal(hit.type, "child_agent_update");
        assert.equal(hit.payload.kind, "child_agent_update");
        if (hit.payload.kind !== "child_agent_update") return;
        assert.equal(hit.payload.childId, "child-1");
        assert.equal(hit.payload.identityLabel, "Researcher");
        assert.ok(hit.payload.status === "running" || hit.payload.status === "done");
      }
      const dual = replay.events.filter((e) => {
        if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
        const activity = e.payload.activity as { name?: string; title?: string; summary?: string };
        const blob = `${activity.name ?? ""} ${activity.title ?? ""} ${activity.summary ?? ""}`;
        return /Researcher|child-1/.test(blob);
      });
      assert.equal(dual.length, 0);
      assert.equal(replay.events.some((e) => e.type === "reasoning_delta" && /Researcher/.test(JSON.stringify(e.payload))), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("incomplete agent frame → no journal member; log present; not obtain_failed", async () => {
    const ctx = await setup({ fixture: "child-agent-incomplete" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "run_terminal"),
        "terminal",
      );
      assert.equal(replay.events.some((e) => e.type === "child_agent_update"), false);
      const logText = await fs.readFile(path.join(ctx.dataDir, "logs", "host.log"), "utf8").catch(() => "");
      assert.match(logText, /incomplete|malformed|child/i);
      assert.notEqual(ctx.session.getState().childAgents.disposition, "obtain_failed");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("two updates same childId → one member; status advances", async () => {
    const ctx = await setup({ fixture: "child-agent" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.filter((e) => e.type === "child_agent_update").length >= 2,
        "two child updates",
      );
      const members = ctx.session.getState().childAgents.members;
      assert.equal(members?.length, 1);
      assert.equal(members?.[0]?.childId, "child-1");
      assert.equal(members?.[0]?.status, "done");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("first frame done / failed is preserved (not overwritten to running)", async () => {
    const doneCtx = await setup({ fixture: "child-agent-first-done" });
    try {
      await doneCtx.session.openWorkspace(doneCtx.workspace);
      const run = await doneCtx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        doneCtx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "child_agent_update"),
        "first-done",
      );
      assert.equal(doneCtx.session.getState().childAgents.members?.[0]?.status, "done");
    } finally {
      await doneCtx.session.shutdown().catch(() => undefined);
      await fs.rm(doneCtx.home, { recursive: true, force: true }).catch(() => undefined);
    }

    const failCtx = await setup({ fixture: "child-agent-first-failed" });
    try {
      await failCtx.session.openWorkspace(failCtx.workspace);
      const run = await failCtx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        failCtx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "child_agent_update"),
        "first-failed",
      );
      assert.equal(failCtx.session.getState().childAgents.members?.[0]?.status, "failed");
    } finally {
      await failCtx.session.shutdown().catch(() => undefined);
      await fs.rm(failCtx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("ordinary tool_call only → no child_agent_update", async () => {
    const ctx = await setup({ fixture: "emit-session-update" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "activity_update") && body.events.some((e) => e.type === "run_terminal"),
        "tool activity",
      );
      assert.equal(replay.events.some((e) => e.type === "child_agent_update"), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("after parent run_terminal, child done/failed still appends", async () => {
    const ctx = await setup({ fixture: "child-agent-late" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "run_terminal"),
        "parent terminal",
      );
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some(
            (e) => e.type === "child_agent_update" && e.payload.kind === "child_agent_update" && e.payload.status === "done",
          ),
        "post-terminal child done",
      );
      const terminalSeq = replay.events.find((e) => e.type === "run_terminal")!.eventSeq;
      const done = replay.events.find(
        (e) => e.type === "child_agent_update" && e.payload.kind === "child_agent_update" && e.payload.status === "done",
      )!;
      assert.ok(done.eventSeq > terminalSeq);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("unmapped kind logs Unmapped vendor sessionUpdate kind and invents no members", async () => {
    const ctx = await setup({ fixture: "child-agent-unmapped" });
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
      assert.equal((ctx.session.getState().childAgents.members ?? []).length, 0);
      const replay = await ctx.session.replayRun(run.runId, "ingress01");
      assert.equal(replay.events.some((e) => e.type === "child_agent_update"), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("post-terminal allowlist accepts child_agent_update; foreign generation drops", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-jl-"));
    try {
      const c = new RunCoordinator(new RunJournal(root));
      const run = await c.admit({ sessionId: "s", prompt: "x", connectionGeneration: 1, policy, model });
      await assert.rejects(
        () =>
          c.appendOwnedEvent(
            run.runId,
            { kind: "child_agent_update", childId: "c1", identityLabel: "R", status: "running" },
            "child_agent_update",
            99,
          ),
        (err: unknown) => (err as { code?: string }).code === "stale_generation" || /stale/.test(String(err)),
      );
      await c.appendOwnedEvent(
        run.runId,
        { kind: "child_agent_update", childId: "c1", identityLabel: "R", status: "running" },
        "child_agent_update",
        1,
      );
      const { won } = await c.finalize(run.runId, "answered", "ok");
      assert.equal(won, true);
      const late = await c.appendAfterTerminalEvent(
        run.runId,
        { kind: "child_agent_update", childId: "c1", identityLabel: "R", status: "done" },
        "child_agent_update",
      );
      assert.equal(late.type, "child_agent_update");
      assert.equal(late.payload.kind, "child_agent_update");
      if (late.payload.kind === "child_agent_update") {
        assert.equal(late.payload.status, "done");
      }
      const events = await new RunJournal(root).replay("s", run.runId);
      assert.ok(events.some((e) => e.type === "run_terminal"));
      assert.ok(
        events.some(
          (e) => e.type === "child_agent_update" && e.payload.kind === "child_agent_update" && e.payload.status === "done",
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
