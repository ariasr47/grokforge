import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";
import { PROJECT_INSTRUCTIONS_MAX_BYTES } from "./project-instructions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function openWorkspace(baseUrl: string, root: string) {
  const opened = await fetch(baseUrl + "/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: root }),
  });
  assert.equal(opened.status, 200, await opened.text());
}

async function admit(baseUrl: string, sessionId: string, text: string) {
  const response = await fetch(baseUrl + "/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text, effort: "auto", history: [] }),
  });
  const raw = await response.text();
  return { status: response.status, raw, body: JSON.parse(raw) as any };
}

async function replayUntil(baseUrl: string, sessionId: string, runId: string, predicate: (body: any) => boolean) {
  for (let i = 0; i < 250; i++) {
    const response = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`);
    if (response.ok) {
      const body = await response.json();
      if (predicate(body)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} did not reach expected state`);
}

function inclusionEvents(body: any) {
  return (body.events ?? []).filter((event: any) => event.type === "project_instructions");
}

test("ACP project_instructions included → journal type+kind project_instructions with path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-j-inc-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "project-instructions-included", XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
    await openWorkspace(host.baseUrl, root);
    const sessionId = "pinclhost01";
    const admitted = await admit(host.baseUrl, sessionId, "use recipe");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) =>
      inclusionEvents(body).length > 0 && (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    const events = inclusionEvents(replay);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "project_instructions");
    assert.equal(events[0].payload.kind, "project_instructions");
    assert.equal(events[0].payload.projectInstructions.inclusion, "included");
    assert.equal(events[0].payload.projectInstructions.path, "CLAUDE.md");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("inclusion failed restores as failed — never collapsed to not_included", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-j-fail-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "project-instructions-failed", XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "pifailhost1";
    const admitted = await admit(host.baseUrl, sessionId, "failed recipe");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) =>
      inclusionEvents(body).length > 0 && (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    const events = inclusionEvents(replay);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.projectInstructions.inclusion, "failed");
    assert.notEqual(events[0].payload.projectInstructions.inclusion, "not_included");
    assert.equal(events[0].payload.projectInstructions.path, "AGENTS.md");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("host does not re-probe disk for journal path (TOCTOU)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-j-toc-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "project-instructions-included", XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "presence winner\n", "utf8");
    await openWorkspace(host.baseUrl, root);
    const state = await (await fetch(host.baseUrl + "/api/state")).json() as any;
    assert.equal(state.projectInstructions.status, "present");
    assert.equal(state.projectInstructions.path, "AGENTS.md");
    const sessionId = "pitocuhost1";
    const admitted = await admit(host.baseUrl, sessionId, "toctou");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) =>
      inclusionEvents(body).length > 0,
    );
    const voucher = inclusionEvents(replay)[0].payload.projectInstructions;
    assert.equal(voucher.path, "CLAUDE.md");
    assert.notEqual(voucher.path, "AGENTS.md");
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Chat prompt produces no project_instructions journal event", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "pichathost1";
    const admitted = await admit(host.baseUrl, sessionId, "chat hello");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) =>
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    assert.equal(inclusionEvents(replay).length, 0);
  } finally {
    await host.stop();
  }
});

test("absent/failed presence does not refuse POST /api/prompt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-j-admit-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "project-instructions-absent", XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const absent = await admit(host.baseUrl, "piadmit01", "absent recipe");
    assert.equal(absent.status, 202, absent.raw);
    await replayUntil(host.baseUrl, "piadmit01", absent.body.run.runId, (body) =>
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );

    await fs.writeFile(path.join(root, "AGENTS.md"), " ".repeat(PROJECT_INSTRUCTIONS_MAX_BYTES), "utf8");
    const state = await (await fetch(host.baseUrl + "/api/state")).json() as any;
    assert.equal(state.projectInstructions.status, "failed");
    const failed = await admit(host.baseUrl, "piadmit02", "failed recipe");
    assert.equal(failed.status, 202, failed.raw);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
