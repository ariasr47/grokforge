// F5 — engine death mid-session: debounced band, preserved transcript,
// labelled recovery (AC15-17, AC-U9, AC-U10). Mocks the network boundary
// (fetch/WebSocket) and the IPC boundary (desktopBridge) only — the app's
// real 4s health-poll interval runs on the real clock (no fake-timer
// interception), so this test waits slightly over 4s per poll and asserts
// directly (no nested `waitFor` after a long manual wait — the condition is
// already settled by then).
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import {
  createFakeHost,
  FakeWebSocket,
  installTauriGlobal,
  readyStatus,
} from "./testFakeHost";
import { setDesktopBridge } from "./desktopBridge";
import { reloadSessionsFromDisk } from "./sessions";

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

afterEach(() => {
  cleanup();
  setDesktopBridge(null);
});

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("F5 — debounced engine-stopped band (AC-U10, AC15-17, AC-U9)", () => {
  it(
    "1 failed poll -> no chrome; 2 consecutive -> band + disabled composer; recovery clears it, transcript preserved",
    { timeout: 30000 },
    async () => {
      resetBrowserState();

      const restoreTauri = installTauriGlobal();
      setDesktopBridge(async () => readyStatus() as unknown as never);
      const host = createFakeHost({ mode: "chat", hasApiKey: true, workspace: null });
      let healthDown = false;
      const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" ? input : input.toString();
        if (raw.includes("/api/health") && healthDown) {
          throw new Error("engine unreachable");
        }
        return host.fetchImpl(input, init);
      }) as typeof fetch;
      globalThis.fetch = wrapped;
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

      render(<App />);
      const composer = await screen.findByLabelText("Message to agent");
      const user = userEvent.setup({ delay: null });
      await user.type(composer, "hello before the engine dies");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
      const ws = FakeWebSocket.latest()!;
      ws.emit({ type: "text_delta", text: "hi there" });
      ws.emit({ type: "done", reason: "stop" });
      await waitFor(() => assert.ok(screen.getByText(/hi there/)));
      const transcriptNodeBefore = document.querySelector(".transcript");
      assert.ok(transcriptNodeBefore);

      // 1st failed poll (~4s): no chrome yet (AC-U10 — a single blip must
      // not flash scary copy).
      healthDown = true;
      await sleep(4300);
      assert.equal(document.querySelector(".transcript-offline"), null);
      assert.equal(document.querySelector(".banner-error"), null);

      // 2nd CONSECUTIVE failed poll (~8s total): band + disabled composer +
      // reason.
      await sleep(4300);
      const bandEl = document.querySelector(".transcript-offline");
      assert.ok(bandEl, "expected the engine-stopped band after 2 consecutive fails");
      const band = within(bandEl as HTMLElement);
      assert.ok(band.getByText(/Forge's engine stopped\./));
      assert.ok(screen.getByTitle("Engine offline — try again to send"));
      // Prior turns preserved — same node, not replaced by an empty state.
      assert.equal(document.querySelector(".transcript"), transcriptNodeBefore);
      assert.ok(screen.getByText(/hi there/));

      // Recovery: next poll succeeds -> band clears, transcript intact.
      healthDown = false;
      await sleep(4300);
      assert.equal(document.querySelector(".transcript-offline"), null);
      assert.equal(document.querySelector(".transcript"), transcriptNodeBefore);
      assert.ok(screen.getByText(/hi there/));

      restoreTauri();
    },
  );
});
