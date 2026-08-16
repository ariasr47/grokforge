// F5 — engine death mid-session: debounced band, preserved transcript,
// labelled recovery (AC15-17, AC-U9, AC-U10). Mocks the network boundary
// (fetch/WebSocket) and the IPC boundary (desktopBridge) only — the app's
// injects a short deterministic cadence through App's health-poll seam while
// keeping the real fetch/WebSocket boundaries and the two-failure debounce.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";
import {
  createFakeHost,
  FakeWebSocket,
  installTauriGlobal,
  readyStatus,
} from "./testFakeHost";
import { setDesktopBridge } from "./desktopBridge";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  setHealthPollTestScheduler(null);
});

afterEach(() => {
  cleanup();
  setDesktopBridge(null);
});

async function eventually(check: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try { check(); return; } catch (error) { last = error; }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw last instanceof Error ? last : new Error("condition not met before timeout");
}

function resetBrowserState(): void {
  localStorage.clear();
  localStorage.setItem(
    "grokforge.firstRun",
    JSON.stringify({
      dismissed: true,
      openedFolder: true,
      signedIn: true,
      sentMessage: true,
      pickedMode: true,
      seenAt: new Date().toISOString(),
    }),
  );
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

describe("F5 — debounced engine-stopped band (AC-U10, AC15-17, AC-U9)", () => {
  it(
    "1 failed poll -> no chrome; 2 consecutive -> band + disabled composer; recovery clears it, transcript preserved",
    { timeout: 30000 },
    async () => {
      resetBrowserState();
      const partition = "chat:__sandbox__";
      const storedSessionId = "engine-death-session";
      reloadSessionsFromDisk({
        byWorkspace: {
          [partition]: [{
            id: storedSessionId,
            workspace: partition,
            title: "Conversation before engine death",
            messages: [
              { id: "prior-user", role: "user", content: "hello before the engine dies" },
              { id: "prior-assistant", role: "assistant", content: "hi there" },
            ],
            updatedAt: Date.now(),
            status: "idle",
            subagents: [],
            open: true,
          }],
        },
        activeId: { [partition]: storedSessionId },
        pinned: [partition],
        expanded: [partition],
      });
      const healthClock: { trigger?: () => void } = {};
      setHealthPollTestScheduler((poll) => { healthClock.trigger = poll; return () => { healthClock.trigger = undefined; }; });

      const restoreTauri = installTauriGlobal();
      setDesktopBridge(async () => readyStatus() as unknown as never);
      const host = createFakeHost({ mode: "chat", hasApiKey: true, workspace: null });
      let healthDown = false;
      let failedHealthPolls = 0;
      let healthyHealthPolls = 0;
      const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" ? input : input.toString();
        if (raw.includes("/api/health") && healthDown) {
          failedHealthPolls += 1;
          throw new Error("engine unreachable");
        }
        if (raw.includes("/api/health")) healthyHealthPolls += 1;
        return host.fetchImpl(input, init);
      }) as typeof fetch;
      globalThis.fetch = wrapped;
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

      render(<App />);
      await screen.findByLabelText("Message to agent");
      await screen.findByText("hi there");
      const transcriptNodeBefore = document.querySelector(".transcript");
      assert.ok(transcriptNodeBefore);

      // 1st failed poll (~4s): no chrome yet (AC-U10 — a single blip must
      // not flash scary copy).
      healthDown = true;
      assert.ok(healthClock.trigger);
      healthClock.trigger!();
      await eventually(() => assert.ok(failedHealthPolls >= 1));
      assert.equal(document.querySelector(".transcript-offline"), null);
      assert.equal(document.querySelector(".banner-error"), null);

      // 2nd CONSECUTIVE failed poll (~8s total): band + disabled composer +
      // reason.
      healthClock.trigger!();
      await eventually(() => assert.ok(failedHealthPolls >= 2));
      await eventually(() => assert.ok(document.querySelector(".transcript-offline")));
      const bandEl = document.querySelector(".transcript-offline");
      assert.ok(bandEl, "expected the engine-stopped band after 2 consecutive fails");
      assert.match(bandEl.textContent ?? "", /Forge's engine stopped\./);
      const disabledComposer = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Message to agent"]',
      );
      assert.ok(disabledComposer);
      assert.equal(disabledComposer.disabled, true);
      // Prior turns preserved — same node, not replaced by an empty state.
      assert.ok(document.querySelector(".transcript") === transcriptNodeBefore);
      assert.match(transcriptNodeBefore.textContent ?? "", /hi there/);

      // Recovery: next poll succeeds -> band clears, transcript intact.
      healthDown = false;
      healthClock.trigger!();
      await eventually(() => assert.ok(healthyHealthPolls >= 1));
      await eventually(() => assert.ok(document.querySelector(".transcript-offline") === null));
      assert.ok(document.querySelector(".transcript-offline") === null);
      assert.ok(document.querySelector(".transcript") === transcriptNodeBefore);
      assert.match(transcriptNodeBefore.textContent ?? "", /hi there/);

      restoreTauri();
    },
  );
});
