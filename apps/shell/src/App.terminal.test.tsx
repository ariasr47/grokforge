// F6 — terminal failure after repeated failed recovery (AC18, AC4). Three
// failing `restart_host` calls -> no spinner in the DOM, a named card, and
// a diagnostics action still present.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import {
  createFakeDesktopBridge,
  failedStatus,
  installTauriGlobal,
  FakeWebSocket,
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

function unreachableFetch(): typeof fetch {
  return (async () => {
    throw new Error("engine unreachable");
  }) as unknown as typeof fetch;
}

describe("F6 — terminal failure state after bounded recovery attempts (AC18)", () => {
  it(
    "after 3 failing restart_host calls, no spinner appears; a named card + diagnostics stay up",
    { timeout: 20000 },
    async () => {
      localStorage.clear();
      reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
      FakeWebSocket.reset();

      const restoreTauri = installTauriGlobal();
      const { bridge, callsTo } = createFakeDesktopBridge({
        ensure_host: [failedStatus({ reason: "crashed" })],
        restart_host: [
          failedStatus({ reason: "crashed" }),
          failedStatus({ reason: "crashed" }),
          failedStatus({ reason: "crashed" }),
        ],
      });
      setDesktopBridge(bridge);
      globalThis.fetch = unreachableFetch();
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

      render(<App />);
      await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")), {
        timeout: 5000,
      });
      assert.equal(document.querySelector(".boot-spinner"), null);

      for (let i = 1; i <= 3; i++) {
        const user = userEvent.setup({ delay: null });
        const tryAgain = screen.getByRole("button", { name: "Try again" });
        await user.click(tryAgain);
        await waitFor(() => assert.equal(callsTo("restart_host"), i));
        // Let the (fast, ~900ms) shell-side health poll settle before the
        // next click.
        await new Promise((r) => setTimeout(r, 1200));
      }

      // Terminal: a named card, a diagnostics action, and — critically — no
      // spinner anywhere in the DOM (AC18 — not a repeating/indefinite one).
      assert.equal(document.querySelector(".boot-spinner"), null);
      assert.ok(document.querySelector(".launch-failure-card"));
      assert.ok(screen.getByRole("button", { name: "Save troubleshooting file" }));

      restoreTauri();
    },
  );
});
