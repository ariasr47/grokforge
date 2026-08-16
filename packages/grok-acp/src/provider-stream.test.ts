import test from "node:test";
import assert from "node:assert/strict";
import { streamChatCompletion, streamTextCompletion } from "./xai.js";
import { GrokAcpServer, type Session } from "./server.js";

const capability = { status: "available", platform: "windows", executable: "cmd.exe", argvPrefix: [], displayName: "cmd", dialect: "cmd", pathSeparator: "\\", syntax: {}, structuredRepositoryTools: [] } as any;

function response(chunks: Array<string | Promise<string>>) {
  let index = 0;
  return new Response(new ReadableStream({ async pull(controller) { if (index >= chunks.length) return controller.close(); const value = await chunks[index++]; controller.enqueue(new TextEncoder().encode(value)); } }), { status: 200 });
}
function mockFetch(res: Response) { const old = globalThis.fetch; globalThis.fetch = (async () => res) as typeof fetch; return () => { globalThis.fetch = old; }; }
const frame = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n`;

test("chat stream decodes delayed chunks and flushes unterminated tail", async () => {
  const restore = mockFetch(response([frame({ content: "hel" }), Promise.resolve(frame({ content: "lo" }).trim())]));
  try { const seen: string[] = []; const out = await streamChatCompletion({ apiKey: "x", model: "m", messages: [], capability, onTextDelta: x => seen.push(x) }); assert.equal(out.content, "hello"); assert.deepEqual(seen, ["hel", "lo"]); } finally { restore(); }
});

test("text stream flushes unterminated reasoning and answer tail", async () => {
  const restore = mockFetch(response([frame({ reasoning_content: "think" }), frame({ content: "answer" }).trim()]));
  try { const parts: string[] = [], thoughts: string[] = []; const out = await streamTextCompletion({ apiKey: "x", model: "m", messages: [], handlers: { onTextDelta: x => parts.push(x), onThinkingDelta: x => thoughts.push(x) } }); assert.equal(out, "answer"); assert.deepEqual(thoughts, ["think"]); } finally { restore(); }
});

test("silent provider transport aborts at the configured idle deadline", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200, body: new ReadableStream({ pull() {} }) })) as unknown as typeof fetch;
  try { await assert.rejects(() => streamTextCompletion({ apiKey: "x", model: "m", messages: [], idleTimeoutMs: 15, handlers: { onTextDelta() {} } }), (e: any) => e.code === "provider_liveness_timeout"); } finally { globalThis.fetch = old; }
});

test("same-run liveness recovery does not repeat already-visible answer deltas", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.XAI_API_KEY;
  const oldIdle = process.env.GROKFORGE_PROVIDER_IDLE_MS;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame({ content: "prefix " }))); } }), { status: 200 });
    return response([frame({ content: "prefix " }), frame({ content: "finish" }), "data: [DONE]\n"]);
  }) as typeof fetch;
  process.env.XAI_API_KEY = "fixture";
  process.env.GROKFORGE_PROVIDER_IDLE_MS = "15";
  const server = new GrokAcpServer();
  const events: Array<{ type: string; params: Record<string, unknown> }> = [];
  (server as unknown as { notify(type: string, params: Record<string, unknown>): void }).notify = (type, params) => events.push({ type, params });
  const session: Session = { id: "session-a", messages: [], pendingEdits: new Map(), sessionWrite: false, sessionShell: false, capability };
  try {
    await (server as unknown as { runPrompt(session: Session, prompt: string, opts: object): Promise<void> }).runPrompt(session, "answer", { model: "m", owner: { sessionId: "session-a", runId: "run-a", connectionGeneration: 1 }, signal: new AbortController().signal });
    assert.equal(events.filter(event => event.type === "text_delta").map(event => String(event.params.text ?? "")).join(""), "prefix finish");
    assert.equal(events.filter(event => event.type === "done").at(-1)?.params.reason, "stop");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = oldKey;
    if (oldIdle === undefined) delete process.env.GROKFORGE_PROVIDER_IDLE_MS; else process.env.GROKFORGE_PROVIDER_IDLE_MS = oldIdle;
  }
});
