/**
 * Live-engine regression for F-2 (QA_REPORT.md bounce): the *first* completed conversation after
 * every engine/agent start must set `priorConversations: true` for its Origin. `prior-conversations
 * .test.ts` deliberately seeds `shells.json` directly (SPEC §7 marks the live read as a `review`
 * row) — that is exactly why the bug shipped: `session.ts`'s `prompt()` set `pendingPromptOrigin`
 * *before* `ensureAgent()`, and a cold client's `restartAgent()` unconditionally nulls it, so the
 * attribution never survived the very first prompt on a fresh engine.
 *
 * Mocks at the agent boundary (test-support/fake-acp-agent.mjs, wired via `GROKFORGE_AGENT_ENTRY`),
 * same as effort-fallback-retry.test.ts, so this drives the real host + session code path —
 * including the cold-start `ensureAgent()` -> `restartAgent()` branch — without a live xAI call.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { startHost, type StartedHost } from "./test-support/host-process.js";
import { ALLOWED_ORIGINS } from "./allowed-origins.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgentEntry = path.resolve(here, "./test-support/fake-acp-agent.mjs");
const ALLOWED = ALLOWED_ORIGINS[0];
const PORT = 8934;

let host: StartedHost;

before(async () => {
  host = await startHost({
    port: PORT,
    env: { GROKFORGE_AGENT_ENTRY: fakeAgentEntry },
  });
});

after(async () => {
  await host.stop();
});

async function waitForDone(baseUrl: string, origin: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState: unknown;
  while (Date.now() < deadline) {
    const s = await fetch(`${baseUrl}/api/state`, { headers: { Origin: origin } });
    const state = (await s.json()) as { busy: boolean };
    lastState = state;
    if (!state.busy) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`prompt never settled: ${JSON.stringify(lastState)}`);
}

describe("priorConversations — the live path on a genuinely fresh (never-prompted) engine", () => {
  it("the very first prompt against a cold agent still sets priorConversations true for its Origin", async () => {
    // No prior prompt has run on this host — ensureAgent() must take the cold restartAgent()
    // branch on this exact call, which is the branch that used to null pendingPromptOrigin out
    // from under the request that had just set it.
    const before = await fetch(`${host.baseUrl}/api/state`, { headers: { Origin: ALLOWED } });
    assert.equal((await before.json() as { priorConversations: boolean }).priorConversations, false);

    const promptRes = await fetch(`${host.baseUrl}/api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED },
      body: JSON.stringify({ text: "hello from the F-2 regression test" }),
    });
    assert.equal(promptRes.status, 200);
    await waitForDone(host.baseUrl, ALLOWED);

    const after = await fetch(`${host.baseUrl}/api/state`, { headers: { Origin: ALLOWED } });
    const afterBody = (await after.json()) as { priorConversations: boolean };
    assert.equal(
      afterBody.priorConversations,
      true,
      "the first completed turn on a fresh engine must be attributed to its Origin",
    );
  });
});
