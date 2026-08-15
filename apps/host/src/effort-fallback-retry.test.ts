/**
 * Host-level test for the AC8 model-id fallback retry path (session.ts's `client.onEvent`
 * handler in `restartAgent()`), which `effort.test.ts` never exercises — that file only covers
 * `modelFallbackChain`, a pure list-builder. Per QA_REPORT.md's bounce: "only `modelFallbackChain`
 * ... is tested; the `onEvent` retry path — `api_error` 400/404 filter, `suppressNextDone`, the
 * re-prompt with the next candidate, `effort_applied` emission — has no test."
 *
 * Mocks at the agent boundary (test-support/fake-acp-agent.mjs, a stdio JSON-RPC stand-in wired
 * via `GROKFORGE_AGENT_ENTRY`) so this never makes a live xAI call, while still exercising the
 * real host + session code path end to end: HTTP prompt -> spawned "agent" -> api_error 400 ->
 * retry with next model -> success -> `effort_applied` broadcast over the real WebSocket.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { WebSocket } from "ws";
import { startHost, type StartedHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgentEntry = path.resolve(here, "./test-support/fake-acp-agent.mjs");

const PORT = 8796;
const FAIL_MODEL = "grok-bogus-model-that-xai-rejects";
const FALLBACK_MODEL = "grok-4-fake-fast-fallback";

let host: StartedHost;

type BusEvent = { type: string; [k: string]: unknown };

function connectAndCollect(baseUrl: string): {
  ws: WebSocket;
  events: BusEvent[];
  waitFor: (pred: (e: BusEvent) => boolean, timeoutMs?: number) => Promise<BusEvent>;
  close: () => void;
} {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);
  const events: BusEvent[] = [];
  const waiters: Array<{ pred: (e: BusEvent) => boolean; resolve: (e: BusEvent) => void }> = [];
  ws.on("message", (data) => {
    const ev = JSON.parse(String(data)) as BusEvent;
    events.push(ev);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(ev)) {
        waiters[i].resolve(ev);
        waiters.splice(i, 1);
      }
    }
  });
  const waitFor = (pred: (e: BusEvent) => boolean, timeoutMs = 8000): Promise<BusEvent> => {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for event")), timeoutMs);
      waiters.push({
        pred,
        resolve: (e) => {
          clearTimeout(t);
          resolve(e);
        },
      });
    });
  };
  return { ws, events, waitFor, close: () => ws.close() };
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

before(async () => {
  host = await startHost({
    port: PORT,
    env: {
      GROKFORGE_AGENT_ENTRY: fakeAgentEntry,
      FAKE_AGENT_FAIL_MODEL: FAIL_MODEL,
      GROK_FAST_MODEL: FALLBACK_MODEL,
      GROK_HEAVY_MODEL: "grok-4-fake-heavy-fallback",
    },
  });
  // Configure the base model to the one the fake agent is scripted to reject, so
  // modelFallbackChain() leads with a failing candidate and falls through to GROK_FAST_MODEL.
  const res = await fetch(`${host.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: FAIL_MODEL }),
  });
  assert.equal(res.status, 200);
  // The settings write triggers a fire-and-forget restartAgent(); wait for the fake agent to be
  // connected before the test fires a prompt, so the retry-path timing is deterministic.
  await waitForConnected(host.baseUrl);
});

async function waitForConnected(baseUrl: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${baseUrl}/api/state`);
    const s = (await r.json()) as { connected: boolean };
    if (s.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("fake agent never reached connected:true");
}

after(async () => {
  await host.stop();
});

describe("AC8 — retry interception via the agent boundary (no live xAI call)", () => {
  it("api_error 400 on the first model triggers a swallowed retry, one done, one effort_applied", async () => {
    const { ws, events, waitFor, close } = connectAndCollect(host.baseUrl);
    await waitOpen(ws);
    try {
      const promptRes = await fetch(`${host.baseUrl}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello from AC8 test" }),
      });
      assert.equal(promptRes.status, 200);

      const done = await waitFor((e) => e.type === "done");
      assert.equal(done.reason, "stop", "the turn should still finish successfully via fallback");

      // Exactly one `done` reached the client — the failed attempt's paired done (reason:"error")
      // must be swallowed by `suppressNextDone`, not just the first one observed.
      const doneEvents = events.filter((e) => e.type === "done");
      assert.equal(doneEvents.length, 1, `expected exactly one done event, got ${doneEvents.length}`);

      // No error event should have reached the client — the api_error 400 is intercepted and
      // retried, never forwarded.
      const errorEvents = events.filter((e) => e.type === "error");
      assert.equal(errorEvents.length, 0, "the intercepted api_error must not reach the client");

      // effort_applied fired with the fallback model actually used.
      const applied = events.find((e) => e.type === "effort_applied") as
        | { selected: string; applied: string; model: string }
        | undefined;
      assert.ok(applied, "expected an effort_applied event after the fallback retry");
      assert.equal(applied!.model, FALLBACK_MODEL);
      assert.equal(applied!.selected, "auto");

      // Host state reflects the model that was actually applied on the retried turn.
      const stateRes = await fetch(`${host.baseUrl}/api/state`);
      const state = (await stateRes.json()) as { appliedModel: string | null; busy: boolean };
      assert.equal(state.appliedModel, FALLBACK_MODEL);
      assert.equal(state.busy, false);
    } finally {
      close();
    }
  });
});
