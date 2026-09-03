import test from "node:test";
import assert from "node:assert/strict";
import { chatCompletion, streamChatCompletion } from "./xai.js";

const capability = { status: "available", platform: "windows", executable: "cmd.exe", argvPrefix: [], displayName: "cmd", dialect: "cmd", pathSeparator: "\\", syntax: {}, structuredRepositoryTools: [] } as any;

function response(chunks: Array<string | Promise<string>>) {
  let index = 0;
  return new Response(new ReadableStream({ async pull(controller) { if (index >= chunks.length) return controller.close(); const value = await chunks[index++]; controller.enqueue(new TextEncoder().encode(value)); } }), { status: 200 });
}
function mockFetch(res: Response | ((req: { body?: unknown }) => Response)) {
  const old = globalThis.fetch;
  const seen: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    seen.push(body);
    return typeof res === "function" ? res({ body }) : res;
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = old; }, seen };
}
const frame = (obj: object) => `data: ${JSON.stringify(obj)}\n`;

test("chatCompletion returns the real prompt_tokens the provider reports", async () => {
  const { restore } = mockFetch(new Response(JSON.stringify({
    choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1234, completion_tokens: 5, total_tokens: 1239 },
  }), { status: 200 }));
  try {
    const out = await chatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.deepEqual(out.usage, { promptTokens: 1234 });
  } finally { restore(); }
});

test("chatCompletion never fabricates usage when the provider omits it", async () => {
  const { restore } = mockFetch(new Response(JSON.stringify({
    choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
  }), { status: 200 }));
  try {
    const out = await chatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.equal(out.usage, undefined);
  } finally { restore(); }
});

test("streamChatCompletion requests stream_options.include_usage", async () => {
  const { restore, seen } = mockFetch(response([frame({ choices: [{ delta: { content: "hi" } }] }), "data: [DONE]\n"]));
  try {
    await streamChatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.deepEqual(seen[0]?.stream_options, { include_usage: true });
  } finally { restore(); }
});

test("streamChatCompletion captures usage carried on a normal delta chunk (xAI's own doc shape)", async () => {
  const { restore } = mockFetch(response([
    frame({ choices: [{ delta: { content: "hi" } }], usage: { prompt_tokens: 41, completion_tokens: 1, total_tokens: 42 } }),
    "data: [DONE]\n",
  ]));
  try {
    const out = await streamChatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.deepEqual(out.usage, { promptTokens: 41 });
  } finally { restore(); }
});

test("streamChatCompletion captures usage from a dedicated final frame with empty choices (OpenAI-compatible include_usage shape)", async () => {
  const { restore } = mockFetch(response([
    frame({ choices: [{ delta: { content: "hi" } }] }),
    frame({ choices: [], usage: { prompt_tokens: 999, completion_tokens: 3, total_tokens: 1002 } }),
    "data: [DONE]\n",
  ]));
  try {
    const out = await streamChatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.equal(out.content, "hi");
    assert.deepEqual(out.usage, { promptTokens: 999 });
  } finally { restore(); }
});

test("streamChatCompletion captures usage from an unterminated tail frame", async () => {
  // Only the last frame lacks its trailing newline — mirrors the real
  // "provider closes SSE without a trailing newline" case the tail-flush
  // path exists for (see provider-stream.test.ts's equivalent content test).
  const { restore } = mockFetch(response([
    frame({ choices: [{ delta: { content: "hi" } }] }),
    Promise.resolve(frame({ choices: [], usage: { prompt_tokens: 77 } }).trim()),
  ]));
  try {
    const out = await streamChatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.equal(out.content, "hi");
    assert.deepEqual(out.usage, { promptTokens: 77 });
  } finally { restore(); }
});

test("streamChatCompletion never fabricates usage when the provider never sends one", async () => {
  const { restore } = mockFetch(response([frame({ choices: [{ delta: { content: "hi" } }] }), "data: [DONE]\n"]));
  try {
    const out = await streamChatCompletion({ apiKey: "x", model: "m", messages: [], capability });
    assert.equal(out.usage, undefined);
  } finally { restore(); }
});
