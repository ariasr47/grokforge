import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession } from "./session.js";
import { RunCoordinator } from "./run-coordinator.js";
import { RunJournal } from "./run-journal.js";

const orig = {
  DATA: process.env.GROKFORGE_DATA_DIR,
  CHANNEL: process.env.GROKFORGE_CHANNEL,
};

function restoreEnv(): void {
  if (orig.DATA === undefined) delete process.env.GROKFORGE_DATA_DIR;
  else process.env.GROKFORGE_DATA_DIR = orig.DATA;
  if (orig.CHANNEL === undefined) delete process.env.GROKFORGE_CHANNEL;
  else process.env.GROKFORGE_CHANNEL = orig.CHANNEL;
}

const policy = {
  workspace: "C:\\workspace",
  storedMode: null,
  effectiveMode: "review" as const,
  source: "fallback" as const,
  revision: "r",
  fallbackReason: "missing" as const,
  snapshottedAt: new Date().toISOString(),
};

test("awaitReady restores appliedModel from the last journal run for that session", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "applied-model-hydrate-"));
  process.env.GROKFORGE_CHANNEL = "test";
  process.env.GROKFORGE_DATA_DIR = home;
  const sid = "hydrate-model-01";
  let session: AgentSession | null = null;
  try {
    const coordinator = new RunCoordinator(new RunJournal(home));
    const run = await coordinator.admit({
      sessionId: sid,
      prompt: "hello",
      connectionGeneration: 1,
      policy,
      model: {
        requestedModel: "grok-4-fast",
        appliedModel: "grok-4-fast-non-reasoning",
        selectionProvenance: "inherited",
      },
    });
    await coordinator.appendOwnedEvent(
      run.runId,
      { kind: "answer_delta", segmentId: "a", delta: "done" },
      "answer_delta",
    );
    await coordinator.finalize(run.runId, "answered");

    session = new AgentSession(sid);
    await session.awaitReady();
    assert.equal(session.getState().appliedModel, "grok-4-fast-non-reasoning");
  } finally {
    await session?.shutdown().catch(() => undefined);
    restoreEnv();
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("awaitReady does not restore another session's appliedModel", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "applied-model-hydrate-other-"));
  process.env.GROKFORGE_CHANNEL = "test";
  process.env.GROKFORGE_DATA_DIR = home;
  let session: AgentSession | null = null;
  try {
    const coordinator = new RunCoordinator(new RunJournal(home));
    const run = await coordinator.admit({
      sessionId: "hydrate-model-owner",
      prompt: "hello",
      connectionGeneration: 1,
      policy,
      model: {
        requestedModel: "grok-4-fast",
        appliedModel: "grok-4-fast-non-reasoning",
        selectionProvenance: "inherited",
      },
    });
    await coordinator.appendOwnedEvent(
      run.runId,
      { kind: "answer_delta", segmentId: "a", delta: "done" },
      "answer_delta",
    );
    await coordinator.finalize(run.runId, "answered");

    session = new AgentSession("hydrate-model-other");
    await session.awaitReady();
    assert.equal(session.getState().appliedModel, null);
  } finally {
    await session?.shutdown().catch(() => undefined);
    restoreEnv();
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
