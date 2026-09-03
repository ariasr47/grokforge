// Forward layer: proves the whole chain — fake grok-acp emits a raw "usage"
// JSON-RPC notification over stdio, the real @grokforge/acp-client parses it,
// session.ts translates it onto the active run, and the host's HTTP replay
// exposes it as a `type: "usage"` run event — mirrors
// project-instructions.integration.test.ts's shape for the same class of
// additive session update.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";

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
  assert.equal(response.status, 202, raw);
  return JSON.parse(raw) as { run: { runId: string; executionPhase: string } };
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

test("usage notification from the agent forwards as a run event of kind usage with the real prompt count and catalog window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-int-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "usage-included", XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "usagehost1";
    const admitted = await admit(host.baseUrl, sessionId, "how much context");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      (body.events ?? []).some((event: any) => event.type === "run_terminal"),
    );
    const usageEvents = (replay.events ?? []).filter((event: any) => event.type === "usage");
    assert.equal(usageEvents.length, 1);
    assert.equal(usageEvents[0].payload.kind, "usage");
    assert.equal(usageEvents[0].payload.promptTokens, 4200);
    assert.equal(usageEvents[0].payload.contextWindow, 500000);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("usage notification with an unmapped model's window forwards contextWindow null — never invented downstream", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-int-null-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, GROKFORGE_FIXTURE: "usage-unknown-window", XAI_API_KEY: "fixture" },
  });
  try {
    await openWorkspace(host.baseUrl, root);
    const sessionId = "usagehost2";
    const admitted = await admit(host.baseUrl, sessionId, "how much context");
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      (body.events ?? []).some((event: any) => event.type === "run_terminal"),
    );
    const usageEvents = (replay.events ?? []).filter((event: any) => event.type === "usage");
    assert.equal(usageEvents.length, 1);
    assert.equal(usageEvents[0].payload.promptTokens, 900);
    assert.equal(usageEvents[0].payload.contextWindow, null);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
