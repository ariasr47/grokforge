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

async function setup(opts: { fixture: string }): Promise<{
  home: string;
  workspace: string;
  dataDir: string;
  session: AgentSession;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "browser-ing-"));
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

async function waitBrowser(
  session: AgentSession,
  pred: (fact: ReturnType<AgentSession["getState"]>["browserWork"]) => boolean,
  label: string,
  ms = 8000,
) {
  const deadline = Date.now() + ms;
  let last = session.getState().browserWork;
  while (Date.now() < deadline) {
    last = session.getState().browserWork;
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last)}`);
}

describe("browser-panel ingress remap", () => {
  it("fixture fetch retains acpToolKind fetch on activity_update and elevates members", async () => {
    const ctx = await setup({ fixture: "browser-fetch" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some((e) => {
            if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
            const activity = e.payload.activity as { acpToolKind?: string; invocationId?: string };
            return activity.acpToolKind === "fetch" && activity.invocationId === "fetch-1";
          }),
        "fetch-class activity",
      );
      const hits = replay.events.filter((e) => e.type === "activity_update" && e.payload.kind === "activity_update");
      const fetchHits = hits.filter((e) => {
        const activity = "activity" in e.payload ? e.payload.activity : null;
        return activity?.acpToolKind === "fetch" && activity.invocationId === "fetch-1";
      });
      assert.ok(fetchHits.length >= 1);
      for (const hit of fetchHits) {
        const activity = ("activity" in hit.payload ? hit.payload.activity : null) as {
          acpToolKind?: string;
          invocationId?: string;
          name?: string;
          title?: string | null;
          url?: string | null;
        } | null;
        assert.ok(activity);
        assert.equal(activity.acpToolKind, "fetch");
        assert.notEqual(activity.acpToolKind, activity.name);
        assert.equal(activity.invocationId, "fetch-1");
        assert.equal(activity.url, "https://docs.x.ai");
        assert.equal(activity.title, "Open docs");
      }
      assert.equal(replay.events.some((e) => e.type === "child_agent_update"), false);
      const members = await waitBrowser(
        ctx.session,
        (b) => (b.members ?? []).some((m) => m.toolCallId === "fetch-1" && m.acpToolKind === "fetch" && m.status === "done"),
        "elevated fetch member",
      );
      const member = members.members?.find((m) => m.toolCallId === "fetch-1");
      assert.equal(member?.acpToolKind, "fetch");
      assert.equal(member?.url, "https://docs.x.ai");
      assert.equal(member?.title, "Open docs");
      assert.equal(member?.status, "done");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("title-only / other / execute do not elevate; ToolKind class seam log; not Unmapped", async () => {
    for (const fixture of ["browser-toolkind-other", "browser-toolkind-execute", "browser-title-only"] as const) {
      const ctx = await setup({ fixture });
      try {
        await ctx.session.openWorkspace(ctx.workspace);
        const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
        const replay = await waitReplay(
          ctx.session,
          run.runId,
          "ingress01",
          (body) => body.events.some((e) => e.type === "activity_update") && body.events.some((e) => e.type === "run_terminal"),
          `${fixture} tool activity`,
        );
        assert.equal(replay.events.some((e) => e.type === "activity_update"), true);
        assert.equal(
          replay.events.some((e) => {
            if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
            return (e.payload.activity as { acpToolKind?: string }).acpToolKind === "fetch";
          }),
          false,
        );
        assert.equal(replay.events.some((e) => e.type === "child_agent_update"), false);
        assert.equal((ctx.session.getState().browserWork.members ?? []).length, 0);
        const logText = await fs.readFile(path.join(ctx.dataDir, "logs", "host.log"), "utf8").catch(() => "");
        assert.match(logText, /ToolKind class seam:/);
        assert.doesNotMatch(logText, /Unmapped vendor sessionUpdate kind/);
      } finally {
        await ctx.session.shutdown().catch(() => undefined);
        await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  it("ordinary read journals with no Browser member and no ToolKind-seam spam", async () => {
    const ctx = await setup({ fixture: "emit-session-update" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) => body.events.some((e) => e.type === "activity_update") && body.events.some((e) => e.type === "run_terminal"),
        "ordinary tool",
      );
      assert.equal(replay.events.some((e) => e.type === "activity_update"), true);
      assert.equal((ctx.session.getState().browserWork.members ?? []).length, 0);
      const logText = await fs.readFile(path.join(ctx.dataDir, "logs", "host.log"), "utf8").catch(() => "");
      assert.doesNotMatch(logText, /ToolKind class seam:/);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("incomplete fetch without toolCallId → no member; ignore+log; not obtain_failed", async () => {
    const ctx = await setup({ fixture: "browser-fetch-incomplete" });
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
      assert.equal(
        replay.events.some((e) => {
          if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
          return (e.payload.activity as { acpToolKind?: string }).acpToolKind === "fetch";
        }),
        false,
      );
      assert.equal((ctx.session.getState().browserWork.members ?? []).length, 0);
      const logText = await fs.readFile(path.join(ctx.dataDir, "logs", "host.log"), "utf8").catch(() => "");
      assert.match(logText, /missing toolCallId|malformed/i);
      assert.notEqual(ctx.session.getState().browserWork.disposition, "obtain_failed");
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("first frame completed / failed is preserved (not coerced to running)", async () => {
    const doneCtx = await setup({ fixture: "browser-fetch-first-done" });
    try {
      await doneCtx.session.openWorkspace(doneCtx.workspace);
      const run = await doneCtx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        doneCtx.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some((e) => {
            if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
            const a = e.payload.activity as { acpToolKind?: string };
            return a.acpToolKind === "fetch";
          }),
        "first-done",
      );
      const members = await waitBrowser(
        doneCtx.session,
        (b) => b.members?.some((m) => m.toolCallId === "fetch-2" && m.status === "done") === true,
        "first-done member",
      );
      assert.equal(members.members?.[0]?.status, "done");
    } finally {
      await doneCtx.session.shutdown().catch(() => undefined);
      await fs.rm(doneCtx.home, { recursive: true, force: true }).catch(() => undefined);
    }

    const failCtx = await setup({ fixture: "browser-fetch-first-failed" });
    try {
      await failCtx.session.openWorkspace(failCtx.workspace);
      const run = await failCtx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        failCtx.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some((e) => {
            if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
            return (e.payload.activity as { acpToolKind?: string }).acpToolKind === "fetch";
          }),
        "first-failed",
      );
      const members = await waitBrowser(
        failCtx.session,
        (b) => b.members?.some((m) => m.toolCallId === "fetch-boom" && m.status === "failed") === true,
        "first-failed member",
      );
      assert.equal(members.members?.[0]?.status, "failed");
    } finally {
      await failCtx.session.shutdown().catch(() => undefined);
      await fs.rm(failCtx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("rejected / not_executed withholds Browser row; tool rail still journals", async () => {
    const ctx = await setup({ fixture: "browser-fetch-rejected" });
    try {
      await ctx.session.openWorkspace(ctx.workspace);
      const run = await ctx.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        ctx.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some((e) => {
            if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
            const a = e.payload.activity as { acpToolKind?: string; status?: string; execution?: string };
            return a.acpToolKind === "fetch" && a.status === "rejected" && a.execution === "not_executed";
          }),
        "rejected fetch activity",
      );
      assert.equal(
        replay.events.some((e) => {
          if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
          const a = e.payload.activity as { invocationId?: string; acpToolKind?: string };
          return a.invocationId === "fetch-deny" && a.acpToolKind === "fetch";
        }),
        true,
      );
      await waitReplay(ctx.session, run.runId, "ingress01", (body) => body.events.some((e) => e.type === "run_terminal"), "terminal");
      assert.equal((ctx.session.getState().browserWork.members ?? []).some((m) => m.toolCallId === "fetch-deny"), false);
    } finally {
      await ctx.session.shutdown().catch(() => undefined);
      await fs.rm(ctx.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("identity merge; multi-fetch preserves both ids", async () => {
    const one = await setup({ fixture: "browser-fetch" });
    try {
      await one.session.openWorkspace(one.workspace);
      const run = await one.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      await waitReplay(
        one.session,
        run.runId,
        "ingress01",
        (body) => body.events.filter((e) => e.type === "activity_update").length >= 2,
        "two fetch updates",
      );
      const members = await waitBrowser(
        one.session,
        (b) => (b.members?.length ?? 0) === 1 && b.members?.[0]?.toolCallId === "fetch-1" && b.members?.[0]?.status === "done",
        "merged one member",
      );
      assert.equal(members.members?.length, 1);
    } finally {
      await one.session.shutdown().catch(() => undefined);
      await fs.rm(one.home, { recursive: true, force: true }).catch(() => undefined);
    }

    const multi = await setup({ fixture: "browser-fetch-multi" });
    try {
      await multi.session.openWorkspace(multi.workspace);
      await multi.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const members = await waitBrowser(
        multi.session,
        (b) =>
          (b.members ?? []).some((m) => m.toolCallId === "fetch-a" && m.status === "done") &&
          (b.members ?? []).some((m) => m.toolCallId === "fetch-b"),
        "two fetch members",
      );
      const ids = (members.members ?? []).map((m) => m.toolCallId).sort();
      assert.deepEqual(ids, ["fetch-a", "fetch-b"]);
      assert.equal(members.members?.find((m) => m.toolCallId === "fetch-a")?.status, "done");
      assert.equal(members.members?.find((m) => m.toolCallId === "fetch-b")?.status, "failed");
    } finally {
      await multi.session.shutdown().catch(() => undefined);
      await fs.rm(multi.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("absent URL/title stay null; snapshotJournaled true only with image content", async () => {
    const plain = await setup({ fixture: "browser-no-url-title" });
    try {
      await plain.session.openWorkspace(plain.workspace);
      await plain.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const members = await waitBrowser(
        plain.session,
        (b) => b.members?.some((m) => m.toolCallId === "fetch-plain") === true,
        "plain fetch",
      );
      const m = members.members?.find((x) => x.toolCallId === "fetch-plain");
      assert.equal(m?.url, null);
      assert.equal(m?.title, null);
      assert.equal(m?.snapshotJournaled, false);
    } finally {
      await plain.session.shutdown().catch(() => undefined);
      await fs.rm(plain.home, { recursive: true, force: true }).catch(() => undefined);
    }

    const shot = await setup({ fixture: "browser-fetch-snapshot" });
    try {
      await shot.session.openWorkspace(shot.workspace);
      const run = await shot.session.prompt("go", "auto", { clientSessionId: "ingress01" });
      const replay = await waitReplay(
        shot.session,
        run.runId,
        "ingress01",
        (body) =>
          body.events.some((e) => {
            if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
            const a = e.payload.activity as { snapshotJournaled?: boolean; invocationId?: string };
            return a.invocationId === "fetch-3" && a.snapshotJournaled === true;
          }),
        "snapshot activity",
      );
      const snapEvent = replay.events.find((e) => {
        if (e.type !== "activity_update" || e.payload.kind !== "activity_update") return false;
        return (e.payload.activity as { invocationId?: string }).invocationId === "fetch-3"
          && (e.payload.activity as { snapshotJournaled?: boolean }).snapshotJournaled === true;
      });
      assert.ok(snapEvent);
      const activity = (snapEvent as { payload: { activity: { output?: unknown } } }).payload.activity;
      assert.equal(JSON.stringify(activity.output ?? null).includes("aaa"), false);
      const members = await waitBrowser(
        shot.session,
        (b) => b.members?.some((m) => m.toolCallId === "fetch-3" && m.snapshotJournaled === true) === true,
        "snapshot member",
      );
      assert.equal(members.members?.[0]?.snapshotJournaled, true);
    } finally {
      await shot.session.shutdown().catch(() => undefined);
      await fs.rm(shot.home, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
