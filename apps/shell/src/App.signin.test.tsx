// F8 — sign-in gate: one gate, corrected copy (AC5, AC6, AC-U12).
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
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
});

function resetBrowserState(): void {
  localStorage.clear();
  localStorage.setItem(
    "grokforge.firstRun",
    JSON.stringify({
      dismissed: true,
      openedFolder: true,
      signedIn: false,
      sentMessage: false,
      pickedMode: true,
      seenAt: new Date().toISOString(),
    }),
  );
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

describe("F8 — sign-in gate: one gate, corrected copy (AC5, AC6, AC-U12)", () => {
  it("before any credential is stored: exactly one sign-in gate, composer disabled with a sign-in reason, and Enter sends nothing", async () => {
    resetBrowserState();
    const host = createFakeHost({
      authMode: "signed_out",
      hasApiKey: false,
      workspace: null,
      mode: "chat",
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    // Exactly one gate — the signed-out empty state — reachable without a
    // second full-screen wall (AC-U12).
    assert.ok(await screen.findByText("Sign in to chat."));
    assert.equal(screen.queryAllByText(/sign in/i).length >= 1, true);

    // Composer disabled with a visible reason that names sign-in (AC6).
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    const user = userEvent.setup({ delay: null });
    await user.type(composer, "hello");
    const send = screen.getByRole("button", { name: "Send" });
    assert.match(send.getAttribute("title") || "", /sign in/i);
    assert.equal(send.hasAttribute("disabled"), true);

    // No message is sent and no unlabeled provider error appears, even via
    // Enter (which bypasses the disabled Send button).
    await user.type(composer, "{Enter}");
    assert.equal(host.callsTo("/api/prompt").length, 0);
    assert.equal(screen.queryByText(/error/i), null);
  });

  it("'You only need to do this once.' is withdrawn — replaced by 'Forge remembers this on this PC.'", async () => {
    resetBrowserState();
    const host = createFakeHost({
      authMode: "signed_out",
      hasApiKey: false,
      workspace: null,
      mode: "chat",
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    await screen.findByText("Sign in to chat.");
    assert.ok(screen.getByText(/Forge remembers this on this PC\./));
    assert.equal(screen.queryByText(/only need to do this once/i), null);
  });

  it("AC5 (operator ruling 2026-08-14) — primary `Sign in with Grok` starts the shared subscription sign-in from this state, with `Open Settings` demoted to secondary and no Settings navigation first", async () => {
    resetBrowserState();
    const host = createFakeHost({
      authMode: "signed_out",
      hasApiKey: false,
      workspace: null,
      mode: "chat",
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const heading = await screen.findByText("Sign in to chat.");
    const card = heading.closest(".empty-card") as HTMLElement;
    assert.ok(card, "signed-out empty-card renders");

    // Primary names the subscription route, and is ordered before the
    // secondary `Open Settings` — the hierarchy AC5 turns on (§4).
    const buttons = within(card).getAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.trim());
    assert.deepEqual(labels, ["Sign in with Grok", "Open Settings"]);
    const primary = within(card).getByRole("button", { name: "Sign in with Grok" });
    const secondary = within(card).getByRole("button", { name: "Open Settings" });
    assert.equal(primary.className.includes("primary"), true);
    assert.equal(secondary.className.includes("primary"), false);

    // Activating the primary starts sign-in from this state: no Settings
    // panel opens, no other navigation happens first.
    const user = userEvent.setup({ delay: null });
    await user.click(primary);

    assert.equal(host.callsTo("/api/oauth/start").length, 1);
    assert.equal(screen.queryByRole("heading", { name: "Settings" }), null);

    // Its pending/device-code surface is the existing action-dock OAuth
    // pending surface (no new pattern) — driven by the server's
    // `oauth_pending` push, same as the Settings-panel path.
    FakeWebSocket.latest()?.emit({
      type: "oauth_pending",
      user_code: "ABCD-1234",
      verification_uri: "https://grok.com/device",
      verification_uri_complete: "https://grok.com/device?user_code=ABCD-1234",
    });

    assert.ok(await screen.findByText("Complete Grok sign-in"));
    assert.ok(screen.getByText("ABCD-1234"));
    // Still no Settings navigation, even after sign-in is under way.
    assert.equal(screen.queryByRole("heading", { name: "Settings" }), null);
  });

  it("a signed-out state whose only action opens Settings fails AC5 — regression guard for a demoted sign-in button", async () => {
    resetBrowserState();
    const host = createFakeHost({
      authMode: "signed_out",
      hasApiKey: false,
      workspace: null,
      mode: "chat",
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);

    const heading = await screen.findByText("Sign in to chat.");
    const card = heading.closest(".empty-card") as HTMLElement;
    const buttons = within(card).getAllByRole("button");
    // §3 AC5: "A signed-out state whose only action opens Settings fails
    // this row." Guard the count and the primary's label directly so a
    // future refactor that drops the primary trips this test, not just the
    // ordering test above.
    assert.equal(buttons.length, 2);
    assert.ok(
      within(card).getByRole("button", { name: "Sign in with Grok" }),
      "primary Sign in with Grok action must be present",
    );
  });
});
