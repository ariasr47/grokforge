import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { RunJournal } from "./run-journal.js";
import { RunCoordinator } from "./run-coordinator.js";
import { startHost } from "./test-support/host-process.js";
import { activityRecordFromToolRun } from "./session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");
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

async function admitPrompt(baseUrl: string, sessionId: string, text: string) {
  const response = await fetch(`${baseUrl}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text, effort: "auto", history: [] }),
  });
  const raw = await response.text();
  return { status: response.status, raw, body: JSON.parse(raw) as any };
}

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

test("message_delta accumulates for CAS and stays message_delta on journal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "als-msg-"));
  try {
    const c = new RunCoordinator(new RunJournal(root));
    const run = await c.admit({ sessionId: "s", prompt: "hi", connectionGeneration: 1, policy, model });
    await c.appendOwnedEvent(run.runId, { kind: "message_delta", segmentId: "m1", delta: "Hello " }, "message_delta");
    await c.appendOwnedEvent(run.runId, { kind: "message_delta", segmentId: "m1", delta: "world" }, "message_delta");
    const { won, run: terminal } = await c.finalize(run.runId, "answered");
    assert.equal(won, true);
    assert.equal(terminal?.finalAnswer, "Hello world");
    assert.equal(terminal?.answerVouched, true);
    const events = await new RunJournal(root).replay("s", run.runId);
    assert.ok(events.every((e) => e.type !== "answer_delta"));
    assert.ok(events.some((e) => e.type === "message_delta" && e.payload.kind === "message_delta"));
    const mid = events.filter((e) => e.type === "message_delta");
    assert.equal(mid.length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("whitespace-only message_delta is not usable → missing_final_answer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "als-ws-"));
  try {
    const c = new RunCoordinator(new RunJournal(root));
    const run = await c.admit({ sessionId: "s", prompt: "hi", connectionGeneration: 1, policy, model });
    await c.appendOwnedEvent(run.runId, { kind: "message_delta", segmentId: "m1", delta: "   \n" }, "message_delta");
    const { run: terminal } = await c.finalize(run.runId, "answered");
    assert.equal(terminal?.terminalKind, "failed");
    assert.equal(terminal?.failure?.code, "missing_final_answer");
    assert.equal(terminal?.answerVouched, false);
    assert.equal(terminal?.finalAnswer, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("type/kind mismatch on message_delta is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "als-mismatch-"));
  try {
    const c = new RunCoordinator(new RunJournal(root));
    const run = await c.admit({ sessionId: "s", prompt: "hi", connectionGeneration: 1, policy, model });
    await assert.rejects(
      () =>
        c.appendOwnedEvent(
          run.runId,
          { kind: "message_delta", segmentId: "m1", delta: "x" } as any,
          "answer_delta" as any,
        ),
      /journal_unavailable|type/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("live text_delta journals as message_delta never answer_delta", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alstext01";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "say hello");
    assert.equal(admitted.status, 202, admitted.raw);
    const runId = admitted.body.run.runId as string;
    const replay = await replayUntil(host.baseUrl, sessionId, runId, (body) =>
      body.run?.state === "terminal",
    );
    const events = replay.events ?? [];
    const mid = events.filter((e: any) => e.type === "message_delta");
    assert.ok(mid.length > 0, "expected journaled message_delta from child text_delta");
    assert.ok(mid.every((e: any) => e.type === "message_delta" && e.payload.kind === "message_delta"));
    assert.equal(events.filter((e: any) => e.type === "answer_delta").length, 0);
    const accumulated = mid.map((e: any) => e.payload.delta).join("");
    assert.equal(replay.run.finalAnswer, accumulated);
    assert.equal(replay.run.answerVouched, true);
  } finally {
    await host.stop();
  }
});

test("activityRecordFromToolRun maps summary/name/title", () => {
  const activity = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "a1",
      toolCallId: "t1",
      lifecycle: "pending",
      execution: null,
      status: "running",
      name: "read_file",
      input: { path: "a.ts" },
      summary: "Read a.ts",
      command: null,
      output: null,
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      title: "Reading a.ts",
    } as any,
    policy,
  );
  assert.equal(activity.name, "read_file");
  assert.equal(activity.summary, "Read a.ts");
  assert.equal(activity.title, "Reading a.ts");
});

test("null summary/title stay null — no invented headline", () => {
  const activity = activityRecordFromToolRun(
    {
      type: "tool_run",
      schemaVersion: 2,
      activityId: "a2",
      toolCallId: "t2",
      lifecycle: "pending",
      execution: null,
      status: "running",
      name: null,
      input: null,
      summary: null,
      command: null,
      output: null,
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
    } as any,
    policy,
  );
  assert.equal(activity.summary, null);
  assert.equal(activity.title, null);
  assert.equal(activity.name, "tool");
});

test("tool-terminal without pending decision appends run_state running+provider", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alsprov01";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:post-tool-provider");
    assert.equal(admitted.status, 202, admitted.raw);
    const runId = admitted.body.run.runId as string;
    const replay = await replayUntil(host.baseUrl, sessionId, runId, (body) => {
      const events = body.events ?? [];
      return events.some((e: any) => e.type === "activity_update" && e.payload?.activity?.lifecycle === "terminal")
        && events.some((e: any) => e.type === "run_state" && e.payload?.liveness === "provider" && e.payload?.state === "running");
    });
    const events = replay.events ?? [];
    const terminalIdx = events.findIndex((e: any) => e.type === "activity_update" && e.payload?.activity?.lifecycle === "terminal");
    assert.ok(terminalIdx >= 0);
    const after = events.slice(terminalIdx);
    const provider = after.find((e: any) => e.type === "run_state");
    assert.ok(provider, "expected run_state after tool-terminal");
    assert.equal(provider.payload.state, "running");
    assert.equal(provider.payload.liveness, "provider");
    assert.equal(
      events.some((e: any) => e.payload?.liveness === "provider" && e.payload?.state === "waiting_for_decision"),
      false,
    );
  } finally {
    await host.stop();
  }
});

test("tool-terminal with pending decision appends run_state waiting_for_decision+decision", async () => {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: liveAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const sessionId = "alsdecn01";
    const admitted = await admitPrompt(host.baseUrl, sessionId, "fixture:post-tool-decision");
    assert.equal(admitted.status, 202, admitted.raw);
    const runId = admitted.body.run.runId as string;
    const replay = await replayUntil(host.baseUrl, sessionId, runId, (body) =>
      (body.events ?? []).some((e: any) => e.type === "run_state" && e.payload?.liveness === "decision"),
    );
    const events = replay.events ?? [];
    const decision = events.find((e: any) => e.type === "run_state" && e.payload?.liveness === "decision");
    assert.ok(decision);
    assert.equal(decision.payload.state, "waiting_for_decision");
    assert.equal(decision.payload.liveness, "decision");
    assert.equal(
      events.some((e: any) => e.payload?.liveness === "provider" && e.payload?.state === "waiting_for_decision"),
      false,
    );
  } finally {
    await host.stop();
  }
});
