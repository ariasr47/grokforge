import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const liveAgent = path.resolve(here, "./test-support/acp-live-streams-agent.mjs");

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function replayUntil(
  baseUrl: string,
  sessionId: string,
  runId: string,
  predicate: (body: any) => boolean,
) {
  let last: any = null;
  for (let i = 0; i < 250; i++) {
    const response = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`);
    if (response.ok) {
      last = await response.json();
      if (predicate(last)) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} did not reach expected state: ${JSON.stringify(last)}`);
}

async function admitPrompt(baseUrl: string, sessionId: string, text: string) {
  const response = await fetch(`${baseUrl}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text, effort: "auto", history: [] }),
  });
  const raw = await response.text();
  return { status: response.status, raw, body: JSON.parse(raw) as any };
}

function eventsOf(replay: any, type: string) {
  return (replay.events ?? []).filter((e: any) => e.type === type);
}

test("Chat no-thought no-tool CAS-copy sets finalAnswer from message_delta", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alschatcas";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:chat-cas-only");
    assert.equal(admitted.status, 202, admitted.raw);
    const runId = admitted.body.run.runId as string;
    const replay = await replayUntil(host.baseUrl, sessionId, runId, (body) => body.run?.state === "terminal");
    const mid = eventsOf(replay, "message_delta");
    assert.ok(mid.length > 0);
    assert.ok(mid.every((e: any) => e.type === "message_delta" && e.payload.kind === "message_delta"));
    assert.equal(eventsOf(replay, "answer_delta").length, 0);
    assert.equal(eventsOf(replay, "reasoning_delta").length, 0);
    assert.equal(eventsOf(replay, "activity_update").length, 0);
    const accumulated = mid.map((e: any) => e.payload.delta).join("");
    assert.equal(accumulated.trim(), "Chat mid-turn answer");
    assert.equal(replay.run.finalAnswer, "Chat mid-turn answer");
    assert.equal(replay.run.answerVouched, true);
    assert.equal(replay.run.terminalKind, "answered");
  } finally {
    await host.stop();
  }
});

test("whitespace-only live mid-turn is missing_final_answer", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alschatws1";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:whitespace-only");
    assert.equal(admitted.status, 202, admitted.raw);
    const runId = admitted.body.run.runId as string;
    const replay = await replayUntil(host.baseUrl, sessionId, runId, (body) => body.run?.state === "terminal");
    assert.equal(replay.run.terminalKind, "failed");
    assert.equal(replay.run.failure?.code, "missing_final_answer");
    assert.equal(replay.run.answerVouched, false);
    assert.equal(replay.run.finalAnswer, null);
    const mid = eventsOf(replay, "message_delta");
    assert.ok(mid.length > 0);
    assert.equal(eventsOf(replay, "answer_delta").length, 0);
  } finally {
    await host.stop();
  }
});

function assertNoAnswerDelta(replay: any) {
  assert.equal(eventsOf(replay, "answer_delta").length, 0);
}

function assertNoLastContentKind(replay: any) {
  for (const e of eventsOf(replay, "run_state")) {
    assert.equal("lastContentKind" in (e.payload ?? {}), false);
  }
}

function assertReachableSpine(replay: any) {
  const events = replay.events ?? [];
  assert.ok(events.some((e: any) => e.type === "reasoning_delta" && e.payload.kind === "reasoning_delta"));
  const mid = eventsOf(replay, "message_delta");
  assert.ok(mid.length > 0);
  assert.ok(mid.every((e: any) => e.type === "message_delta" && e.payload.kind === "message_delta"));
  const activities = eventsOf(replay, "activity_update");
  assert.ok(activities.length >= 2);
  const stamped = activities.find((e: any) => e.payload?.activity?.summary && e.payload?.activity?.title);
  assert.ok(stamped, "expected activity with mapped summary/title");
  assert.equal(stamped.payload.activity.summary, "Read notes.md");
  assert.equal(stamped.payload.activity.title, "Reading notes.md");
  assert.equal(stamped.payload.activity.name, "read_file");
  const ids = activities.map((e: any) => e.payload.activity.activityId);
  assert.deepEqual([...new Set(ids)], ["read-1"]);
  const terminalIdx = events.findIndex((e: any) => e.type === "activity_update" && e.payload?.activity?.lifecycle === "terminal");
  assert.ok(terminalIdx >= 0);
  const afterTerminal = events.slice(terminalIdx + 1);
  const provider = afterTerminal.find((e: any) => e.type === "run_state");
  assert.ok(provider);
  assert.equal(provider.payload.state, "running");
  assert.equal(provider.payload.liveness, "provider");
  assert.equal(replay.run.answerVouched, true);
  const accumulated = mid.map((e: any) => e.payload.delta).join("");
  assert.equal(replay.run.finalAnswer, accumulated);
  assert.ok(typeof replay.run.finalAnswer === "string" && replay.run.finalAnswer.trim().length > 0);
  assertNoAnswerDelta(replay);
  assertNoLastContentKind(replay);
}

test("reachable-state thought → message_delta → tool → provider run_state → CAS answer (Chat)", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alsreach1";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:reachable");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) => body.run?.state === "terminal");
    assertReachableSpine(replay);
  } finally {
    await host.stop();
  }
});

test("reachable-state journals the same spine in Code", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "als-code-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const opened = await fetch(`${host.baseUrl}/api/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(opened.status, 200, await opened.text());
    const sessionId = "alscode01";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:reachable");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) => body.run?.state === "terminal");
    assertReachableSpine(replay);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("long-burst tool identities do not mint a second activityId", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alsburst1";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:burst");
    assert.equal(admitted.status, 202, admitted.raw);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.body.run.runId, (body) => body.run?.state === "terminal");
    const activities = eventsOf(replay, "activity_update");
    const ids = activities.map((e: any) => e.payload.activity.activityId);
    assert.deepEqual([...new Set(ids)].sort(), ["burst-1", "burst-2", "burst-3"]);
    for (const id of ["burst-1", "burst-2", "burst-3"]) {
      const rows = activities.filter((e: any) => e.payload.activity.activityId === id);
      assert.ok(rows.some((e: any) => e.payload.activity.lifecycle === "pending"));
      assert.ok(rows.some((e: any) => e.payload.activity.lifecycle === "terminal"));
    }
    assertNoAnswerDelta(replay);
    assert.equal(replay.run.answerVouched, true);
    assert.equal(replay.run.finalAnswer, "burst done");
  } finally {
    await host.stop();
  }
});

test("cancel after unvouched message_delta keeps mid-turn and does not vouch Answer", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alscancel";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:cancel-midturn");
    assert.equal(admitted.status, 202, admitted.raw);
    const runId = admitted.body.run.runId as string;
    await replayUntil(host.baseUrl, sessionId, runId, (body) =>
      (body.events ?? []).some((e: any) => e.type === "message_delta"),
    );
    const cancel = await fetch(`${host.baseUrl}/api/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId }),
    });
    assert.ok(cancel.status === 202 || cancel.status === 200, await cancel.text());
    const replay = await replayUntil(host.baseUrl, sessionId, runId, (body) => body.run?.state === "terminal");
    const mid = eventsOf(replay, "message_delta");
    assert.ok(mid.some((e: any) => String(e.payload.delta).includes("partial words")));
    assert.equal(replay.run.answerVouched, false);
    assert.notEqual(replay.run.terminalKind, "answered");
    assertNoAnswerDelta(replay);
  } finally {
    await host.stop();
  }
});
