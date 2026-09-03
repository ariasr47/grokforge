import test from "node:test";
import assert from "node:assert/strict";
import { GrokAcpServer, type Session } from "./server.js";

const capability = { status: "available", platform: "windows", executable: "cmd.exe", argvPrefix: [], displayName: "cmd", dialect: "cmd", pathSeparator: "\\", syntax: {}, structuredRepositoryTools: [] } as any;

function response(chunks: string[]) {
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) { if (index >= chunks.length) return controller.close(); controller.enqueue(new TextEncoder().encode(chunks[index++])); } }), { status: 200 });
}
const frame = (obj: object) => `data: ${JSON.stringify(obj)}\n`;

function harness(fetchImpl: typeof fetch) {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.XAI_API_KEY;
  globalThis.fetch = fetchImpl;
  process.env.XAI_API_KEY = "fixture";
  const server = new GrokAcpServer();
  const events: Array<{ type: string; params: Record<string, unknown> }> = [];
  (server as unknown as { notify(type: string, params: Record<string, unknown>): void }).notify = (type, params) => events.push({ type, params });
  const session: Session = { id: "session-a", messages: [], pendingEdits: new Map(), sessionWrite: false, sessionShell: false, capability };
  return {
    events,
    run: (model: string) =>
      (server as unknown as { runPrompt(session: Session, prompt: string, opts: object): Promise<void> }).runPrompt(session, "hi", {
        model,
        owner: { sessionId: "session-a", runId: "run-a", connectionGeneration: 1 },
        signal: new AbortController().signal,
      }),
    restore: () => {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = oldKey;
    },
  };
}

test("runPrompt emits a usage event with the real prompt_tokens and the catalog's context window for a known model", async () => {
  const h = harness((async () =>
    response([frame({ choices: [{ delta: { content: "hi there" } }], usage: { prompt_tokens: 555, completion_tokens: 2, total_tokens: 557 } }), frame({ choices: [{ finish_reason: "stop" }] }), "data: [DONE]\n"])
  ) as typeof fetch);
  try {
    await h.run("grok-4.6");
    const usage = h.events.find((e) => e.type === "usage");
    assert.ok(usage, "expected a usage event");
    assert.deepEqual(usage!.params, { schemaVersion: 1, type: "usage", promptTokens: 555, contextWindow: 500_000 });
  } finally {
    h.restore();
  }
});

test("runPrompt still emits usage with a null contextWindow for a model the catalog has no sourced number for", async () => {
  const h = harness((async () =>
    response([frame({ choices: [{ delta: { content: "hi there" } }], usage: { prompt_tokens: 42 } }), frame({ choices: [{ finish_reason: "stop" }] }), "data: [DONE]\n"])
  ) as typeof fetch);
  try {
    await h.run("grok-4");
    const usage = h.events.find((e) => e.type === "usage");
    assert.ok(usage, "expected a usage event");
    assert.equal(usage!.params.promptTokens, 42);
    assert.equal(usage!.params.contextWindow, null);
  } finally {
    h.restore();
  }
});

test("runPrompt never emits usage when the provider response carries none", async () => {
  const h = harness((async () =>
    response([frame({ choices: [{ delta: { content: "hi there" } }] }), frame({ choices: [{ finish_reason: "stop" }] }), "data: [DONE]\n"])
  ) as typeof fetch);
  try {
    await h.run("grok-4.6");
    assert.equal(h.events.some((e) => e.type === "usage"), false);
  } finally {
    h.restore();
  }
});
