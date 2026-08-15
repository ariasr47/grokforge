// AC12g / AC12h (INTERFACE_CONTRACT.md §"Which surfaces carry it", SPEC.md
// §2.8 property 4, GATE Q pass 1j finding N-8) — the choice AC12b/AC12f make
// at LAUNCH must survive the SESSION. Four consecutive GATE Q passes and a
// four-mutant probe missed N-8 precisely because AC12b/AC12f both bind a
// launch: every launch was correct and the regression happened on the click
// after it (QA_REPORT.md, "the hole"). So every test below mounts already
// showing the not-found alarm (or an intact-store empty state), performs an
// in-session action, and asserts what is on screen AFTER the action — never
// only at mount.
//
// The fake host is driven with `omitPriorConversationsOnMutatingResponses:
// true` throughout: this reproduces the exact wire shape QA read off the
// packaged engine (POST /api/mode et al. answering 200 with a state-shaped
// body that does not carry `priorConversations`) BEFORE the backend lane
// stamps those responses. INTERFACE_CONTRACT.md is explicit that a consumer
// may assume nothing from an absent field, so the shell's fix must hold
// against exactly this shape — it must not depend on the engine half having
// landed (SPEC.md: "Do not write a fix whose correctness depends on the
// other lane having landed" carries the same rule forward from the amendment
// itself). A run against a fully-stamped host (the suite's default) would
// not exercise the bug at all.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { mergeState, type PublicState } from "./api";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { createSession, saveSessionMessages, reloadSessionsFromDisk } from "./sessions";

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
      signedIn: true,
      sentMessage: true,
      pickedMode: true,
      seenAt: new Date().toISOString(),
    }),
  );
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

const NOT_FOUND_COPY = "Forge didn't find your earlier conversations.";
const WELCOME_COPY = "Welcome to Forge";

describe("AC12g — in-session persistence of the not-found alarm (GATE Q N-8)", () => {
  it("mode switch, folder open, effort change and a settings change all leave the alarm exactly as the launch rendered it", async () => {
    resetBrowserState();
    const host = createFakeHost(
      { mode: "code", hasApiKey: true, workspace: null, priorConversations: true },
      {
        // The regression shape: every state-returning POST below omits the
        // field, same as the real engine before the host lane's fix lands.
        omitPriorConversationsOnMutatingResponses: true,
        pickFolderPath: "C:\\qa-ac12g",
      },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Launch: the not-found state, exactly as AC12b already covers.
    assert.ok(await screen.findByText(NOT_FOUND_COPY));
    assert.equal(screen.queryByText(WELCOME_COPY), null);

    // Action 1 — switch product mode (the exact N-8 repro step).
    await user.click(screen.getByRole("radio", { name: "Chat" }));
    await waitFor(() => assert.ok(host.callsTo("/api/mode").length >= 1));
    assert.ok(
      await screen.findByText(NOT_FOUND_COPY),
      "alarm must survive a mode switch whose POST response omits the field",
    );
    assert.equal(screen.queryByText(WELCOME_COPY), null);

    // Switch back, so the folder-open action below is offered (Code-only).
    await user.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() => assert.ok(host.callsTo("/api/mode").length >= 2));
    assert.ok(await screen.findByText(NOT_FOUND_COPY));
    assert.equal(screen.queryByText(WELCOME_COPY), null);

    // Action 2 — open a folder (POST /api/workspace, also unstamped).
    await user.click(screen.getByRole("button", { name: "Open folder…" }));
    await waitFor(() => assert.ok(host.callsTo("/api/workspace").length >= 1));
    assert.ok(
      await screen.findByText(NOT_FOUND_COPY),
      "alarm must survive opening a folder whose POST response omits the field",
    );
    assert.equal(screen.queryByText(WELCOME_COPY), null);

    // Action 3 — change the effort level (POST /api/effort, also unstamped).
    await user.click(screen.getByRole("radio", { name: "Expert" }));
    await waitFor(() => assert.ok(host.callsTo("/api/effort").length >= 1));
    assert.ok(
      await screen.findByText(NOT_FOUND_COPY),
      "alarm must survive an effort change whose POST response omits the field",
    );
    assert.equal(screen.queryByText(WELCOME_COPY), null);

    // Action 4 — change a setting (POST /api/settings, also unstamped),
    // round-tripping through the Settings panel and back.
    const settingsToggle = screen
      .getAllByRole("button", { name: "Settings" })
      .find((b) => b.className.includes("ghost"))!;
    await user.click(settingsToggle);
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("button", { name: "Clear saved key" }));
    await waitFor(() => assert.ok(host.callsTo("/api/settings").length >= 1));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    assert.ok(
      await screen.findByText(NOT_FOUND_COPY),
      "alarm must survive a settings change whose POST response omits the field",
    );
    assert.equal(screen.queryByText(WELCOME_COPY), null);

    // SPEC §4 flow 5 / AC12g: it does not self-heal or decay with time
    // either — nothing in the app holds a timer that re-derives this from
    // anything but the held `priorConversations` value, so the state above
    // is not a transient render; a further tick changes nothing.
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(screen.getByText(NOT_FOUND_COPY));
    assert.equal(screen.queryByText(WELCOME_COPY), null);
  });

  it("mirror direction: an intact store raises no alarm through the same actions, even when responses omit the field", async () => {
    resetBrowserState();
    const chatPartition = "chat:__sandbox__";
    const s = createSession(chatPartition, "Earlier chat");
    saveSessionMessages(chatPartition, s.id, [
      { id: "u1", role: "user", content: "already have history" },
    ]);
    const host = createFakeHost(
      { mode: "code", hasApiKey: true, workspace: null, priorConversations: true },
      {
        omitPriorConversationsOnMutatingResponses: true,
        pickFolderPath: "C:\\qa-ac12g-mirror",
      },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Launch: Code's ordinary empty state — nothing was lost.
    assert.ok(await screen.findByText("Open a project"));
    assert.equal(screen.queryByText(NOT_FOUND_COPY), null);

    await user.click(screen.getByRole("radio", { name: "Chat" }));
    await waitFor(() => assert.ok(host.callsTo("/api/mode").length >= 1));
    assert.equal(screen.queryByText(NOT_FOUND_COPY), null);

    await user.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() => assert.ok(host.callsTo("/api/mode").length >= 2));
    assert.equal(screen.queryByText(NOT_FOUND_COPY), null);

    // Two "Open folder…" buttons are on screen here (the sidebar's own
    // primary action AND the "no-workspace" empty state's own button, since
    // — unlike the not-found alarm — this ordinary empty state does not
    // suppress it); the sidebar one is unambiguous via its own class.
    const openFolderBtn = screen
      .getAllByRole("button", { name: "Open folder…" })
      .find((b) => b.className.includes("open-folder-btn"))!;
    await user.click(openFolderBtn);
    await waitFor(() => assert.ok(host.callsTo("/api/workspace").length >= 1));
    assert.equal(screen.queryByText(NOT_FOUND_COPY), null);

    await user.click(screen.getByRole("radio", { name: "Expert" }));
    await waitFor(() => assert.ok(host.callsTo("/api/effort").length >= 1));
    assert.equal(screen.queryByText(NOT_FOUND_COPY), null);
  });
});

// Structural oracle (SPEC.md §7's own warning: "seven patched call sites is
// a list, and the eighth endpoint... re-opens the identical defect with
// nothing to catch it"). The behavioural tests above enumerate today's four
// in-session actions; this test instead makes it IMPOSSIBLE to add a ninth
// (or a ninetieth) call site that updates `state` from a response without
// going through `applyState`/`mergeState` — the App.tsx source is scanned
// for the raw setter, and the only occurrence allowed is the one inside
// `applyState`'s own body. A future site that writes the raw setter call
// directly turns this red without needing to know the new endpoint's name.
describe("Structural oracle — every response that updates `state` routes through the merge (SPEC.md §7)", () => {
  it("App.tsx calls the raw state setter exactly once, from inside applyState", () => {
    const appTsxPath = fileURLToPath(new URL("./App.tsx", import.meta.url));
    const src = readFileSync(appTsxPath, "utf8");
    const rawSetStateCalls = src.match(/\bsetState\(/g) ?? [];
    assert.equal(
      rawSetStateCalls.length,
      1,
      "every OTHER call site must update state via applyState(...), not a raw setState(...) call " +
        "— a new one bypasses SPEC §2.8 property 4's merge rule and can silently re-open N-8",
    );
  });
});

// Unit coverage of the merge primitive itself (api.ts `mergeState`) — the
// one function every call site above is required to route through.
describe("mergeState — SPEC.md §2.8 property 4 / INTERFACE_CONTRACT.md merge rule", () => {
  const FULL: PublicState = {
    workspace: null,
    workspaceName: null,
    authMode: "sub_pool",
    hasApiKey: true,
    authSource: "oauth",
    model: "grok-4",
    connected: true,
    busy: false,
    sessionId: null,
    recent: [],
    mode: "code",
    priorConversations: true,
  };

  it("a payload that omits a field (JSON.parse never materialized the key) leaves the held value untouched", () => {
    const payload = { ...FULL };
    delete (payload as Partial<PublicState>).priorConversations;
    const merged = mergeState(FULL, payload);
    assert.equal(merged.priorConversations, true);
  });

  it("a payload that explicitly carries `undefined` for a field is treated the same as an omitted key", () => {
    const payload = { ...FULL, priorConversations: undefined };
    const merged = mergeState(FULL, payload);
    assert.equal(merged.priorConversations, true);
  });

  it("a payload that DOES carry the field overwrites the held value — a real true->false or false->true transition is not swallowed", () => {
    const merged = mergeState(FULL, { ...FULL, priorConversations: false });
    assert.equal(merged.priorConversations, false);
  });

  it("is a generic object merge, not special-cased to priorConversations — any omitted field is preserved", () => {
    const payload = { ...FULL };
    delete (payload as Partial<PublicState>).workspaceName;
    const merged = mergeState({ ...FULL, workspaceName: "kept" }, payload);
    assert.equal(merged.workspaceName, "kept");
  });

  it("prev == null (nothing held yet) has nothing to preserve, so the payload is returned as-is", () => {
    const merged = mergeState(null, FULL);
    assert.deepEqual(merged, FULL);
  });
});
