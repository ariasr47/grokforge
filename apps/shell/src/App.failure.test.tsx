// F3 — the six failure cards, end to end through App (AC-U3, AC-U5, AC-U8,
// AC-U18). Mocks the network boundary (fetch always rejects /api/health —
// simulating an unreachable engine) and the IPC boundary (desktopBridge)
// only; real App, real card selection.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import {
  createFakeDesktopBridge,
  createFakeHost,
  failedStatus,
  installTauriGlobal,
  readyStatus,
  FakeWebSocket,
} from "./testFakeHost";
import { setDesktopBridge } from "./desktopBridge";
import { reloadSessionsFromDisk } from "./sessions";
import { setAppVersionResolver, type DesktopHostStatus, type LaunchReason } from "./api";
import { CARD_COPY, type CardId } from "./failureCard";

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
  setAppVersionResolver(null);
});

function unreachableFetch(): typeof fetch {
  return (async () => {
    throw new Error("engine unreachable");
  }) as unknown as typeof fetch;
}

async function renderWithLaunchStatus(status: DesktopHostStatus) {
  localStorage.clear();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();

  const restoreTauri = installTauriGlobal();
  setDesktopBridge(async () => status as unknown as never);
  globalThis.fetch = unreachableFetch();
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  render(<App />);
  await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")), {
    timeout: 5000,
  });
  return restoreTauri;
}

const CASES: Array<{
  name: string;
  reason: LaunchReason;
  osError: number | null;
  cardId: string;
  headline: string;
  expectRetry: boolean;
}> = [
  {
    name: "entry_missing",
    reason: "entry_missing",
    osError: null,
    cardId: "missing-file",
    headline: "Part of Forge is missing.",
    expectRetry: true, // secondary
  },
  {
    name: "runtime_missing (access denied)",
    reason: "runtime_missing",
    osError: 5,
    cardId: "windows-blocked",
    headline: "Windows blocked Forge from starting its engine.",
    expectRetry: true,
  },
  {
    name: "crashed",
    reason: "crashed",
    osError: null,
    cardId: "engine-stopped",
    headline: "Forge's engine stopped right after starting.",
    expectRetry: true,
  },
  {
    name: "health_timeout",
    reason: "health_timeout",
    osError: null,
    cardId: "neutral",
    headline: "Forge couldn't reach its engine.",
    expectRetry: true,
  },
  {
    name: "port_unavailable",
    reason: "port_unavailable",
    osError: null,
    cardId: "no-connection",
    headline: "Forge couldn't get a connection on this PC.",
    expectRetry: true,
  },
  {
    name: "origin_refused",
    reason: "origin_refused",
    osError: null,
    cardId: "refused-copy",
    headline: "Forge's engine won't accept this app.",
    expectRetry: false,
  },
];

describe("F3 — App renders the SPEC §5 card for each reason (AC-U3)", () => {
  for (const c of CASES) {
    it(`${c.name} -> ${c.cardId}`, async () => {
      const restore = await renderWithLaunchStatus(
        failedStatus({ reason: c.reason, osError: c.osError }),
      );
      const card = document.querySelector(".launch-failure-card")!;
      assert.equal(card.getAttribute("data-card"), c.cardId);
      assert.ok(screen.getByText(c.headline));

      const tryAgain = screen.queryByRole("button", { name: "Try again" });
      if (c.expectRetry) {
        assert.ok(tryAgain, "expected a Try again button");
      } else {
        assert.equal(tryAgain, null, "AC-U5: refused-copy must render no Try again at all");
      }
      restore();
    });
  }
});

// GATE Q pass 1h, AC-U5 bounce (round 7) — QA's screenshot of the *installed*
// app caught what every prior UI-Automation-tree check missed: the
// missing-file card rendered `Try again` with the canon primary gradient and
// `Save troubleshooting file` plain — the DOM order (and therefore presence
// assertions and the accessibility tree) was already correct, so only the
// rendered *class* exposes the defect. This walks every card in SPEC §5's
// table — not only card 4 — and asserts which slot carries the canon
// `.btn.primary` weight, by name, not by which action happens to occupy it.
describe("F3 — AC-U5: visual weight follows the slot (primary/secondary), not the action (GATE Q pass 1h)", () => {
  function actionLabel(which: "try-again" | "save-diagnostics"): string {
    return which === "try-again" ? "Try again" : "Save troubleshooting file";
  }

  for (const c of CASES) {
    it(`${c.cardId}: the primary-slot action carries .btn.primary and the secondary-slot action does not`, async () => {
      const restore = await renderWithLaunchStatus(
        failedStatus({ reason: c.reason, osError: c.osError }),
      );
      const copy = CARD_COPY[c.cardId as CardId];
      const card = document.querySelector(".launch-failure-card") as HTMLElement;
      const actionsRow = card.querySelector(".row") as HTMLElement;

      const primaryBtn = within(actionsRow).getByRole("button", {
        name: actionLabel(copy.primaryAction),
      });
      assert.equal(
        primaryBtn.className.split(/\s+/).includes("primary"),
        true,
        `${c.cardId}: expected the primary-slot action ("${copy.primaryAction}") to carry the canon .primary weight`,
      );

      if (copy.secondaryAction) {
        const secondaryBtn = within(actionsRow).getByRole("button", {
          name: actionLabel(copy.secondaryAction),
        });
        assert.equal(
          secondaryBtn.className.split(/\s+/).includes("primary"),
          false,
          `${c.cardId}: expected the secondary-slot action ("${copy.secondaryAction}") to NOT carry the .primary weight`,
        );
      }

      // Exactly one primary-weighted action button renders per card — never
      // zero (an unweighted card), never two (both actions competing).
      const allActionButtons = within(actionsRow).getAllByRole("button");
      const primaryWeighted = allActionButtons.filter((btn) =>
        btn.className.split(/\s+/).includes("primary"),
      );
      assert.equal(
        primaryWeighted.length,
        1,
        `${c.cardId}: expected exactly one primary-weighted action button, found ${primaryWeighted.length}`,
      );

      restore();
    });
  }
});

describe("F3 — Details discloses the launcher's raw fields verbatim (AC-U18)", () => {
  it("shows reason, osError and message inside Details", async () => {
    const restore = await renderWithLaunchStatus(
      failedStatus({ reason: "crashed", osError: 42, message: "child exited code 1" }),
    );
    const details = document.querySelector(".launch-details")!;
    assert.ok(details);
    assert.match(details.textContent || "", /crashed/);
    assert.match(details.textContent || "", /42/);
    assert.match(details.textContent || "", /child exited code 1/);
    restore();
  });
});

// GATE Q pass 1d, AC-U5 bounce — the deleted test here
// ("renders no Try again even on a normally-retryable card when owned is
// false") was the hollow green QA found: its one assertion generalized "no
// Try again on a normally-retryable card" from a single case (`crashed`),
// which is true for that reason only by SPEC accident (real launcher
// failures always report `owned: false` — see `DesktopHostStatus.owned`'s
// own doc comment in api.ts — so gating the card's own Try again on `owned`
// silently zeroed it on every card, including entry_missing's missing-file
// card, where SPEC §5 keeps a secondary Try again unconditionally). It never
// mounted the app shell, so AC-U5's actual "anywhere" clause — Settings, the
// command palette, the error banner, the topbar — had no coverage at all.
describe("F3 — AC-U5: card-level Try again follows SPEC §5's class table, not `owned`", () => {
  for (const c of CASES) {
    it(`${c.name} -> retry-offered is unchanged by owned:false (${c.cardId})`, async () => {
      const restore = await renderWithLaunchStatus(
        failedStatus({ reason: c.reason, osError: c.osError, owned: false }),
      );
      const card = document.querySelector(".launch-failure-card")!;
      assert.equal(card.getAttribute("data-card"), c.cardId);
      const tryAgain = screen.queryByRole("button", { name: "Try again" });
      if (c.expectRetry) {
        assert.ok(
          tryAgain,
          `expected a (possibly secondary) Try again button on ${c.cardId} even with owned:false`,
        );
      } else {
        // Compares booleans, not the raw jsdom Element, to `null` — asserting
        // on the node itself would make a *failing* run pathologically slow
        // to report (node:assert's diff walks the element's circular
        // DOM/React-fiber graph) instead of failing cleanly and fast.
        assert.equal(
          tryAgain === null,
          true,
          "AC-U5: refused-copy must render no Try again at all, owned:false or not",
        );
      }
      restore();
    });
  }
});

function resetBrowserStateSignedIn(): void {
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

// Fast path: the launcher can report `owned: false` on a status that still
// carries `phase: "ready"` (SPEC never forbids the combination even though
// the real launcher only ever emits it on a failure — AC-U5's own text is
// "with `owned: false`", not "only after a failed retry"), so booting
// straight into that shape reaches the exact condition every ambient
// restart/reconnect affordance must react to without any real-timer health
// polling. This is the QA-named bug's three ungated surfaces (Settings, the
// command palette, the error banner) — direct, fast, deterministic.
describe("F3 — AC-U5: Settings/palette/banner drop their reconnect affordance with owned:false", () => {
  it("Settings' Restart engine, the palette's Reconnect engine and the banner's Reconnect engine are all absent", async () => {
    resetBrowserStateSignedIn();
    const restoreTauri = installTauriGlobal();
    setDesktopBridge(async () => readyStatus({ owned: false }) as unknown as never);
    const host = createFakeHost({ mode: "chat", hasApiKey: true, workspace: null });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup({ delay: null });
    await screen.findByLabelText("Message to agent");

    // Settings — QA's own repro surface.
    const settingsToggle = screen
      .getAllByRole("button", { name: "Settings" })
      .find((b) => b.className.includes("ghost"))!;
    await user.click(settingsToggle);
    await screen.findByRole("heading", { name: "Settings" });
    // Booleans, not raw jsdom Elements, are compared to `null` throughout
    // this test — see the comment on the CASES loop above.
    assert.equal(screen.queryByRole("button", { name: "Restart engine" }) === null, true);

    // Command palette.
    await user.click(screen.getByTitle("Command palette (Ctrl+K)"));
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    assert.equal(within(dialog).queryByText("Reconnect engine") === null, true);
    await user.keyboard("{Escape}");

    // The explicit error banner (a WS "error" event classified into the
    // "reconnect" recovery bucket) offers no affordance either.
    const ws = FakeWebSocket.latest()!;
    ws.emit({ type: "error", code: "network", message: "The engine went offline mid-run." });
    await waitFor(() => assert.ok(screen.getAllByRole("alert").length >= 1));
    assert.equal(screen.queryByRole("button", { name: "Reconnect engine" }) === null, true);

    restoreTauri();
  });
});

// Integration centerpiece (spire-tech-flow-integration-tests): QA GATE Q
// pass 1d's exact journey — a healthy engine dies mid-session, the operator's
// one manual retry itself comes back `owned:false`, and every surface named
// in AC-U5 reacts, including the two that were ALREADY correctly gated
// before this bounce (the topbar Reconnect and the mid-session band's Try
// again) and the N-4 copy fix (the band must stop claiming Forge is
// retrying once nothing is). Real 4s health-poll timers, real wall clock.
describe("F3 — AC-U5 / N-4: the mid-session journey — engine dies, retry fails owned:false, every surface reacts", () => {
  it(
    "topbar Reconnect and the band's Try again disappear, and the band stops claiming a retry is in flight",
    { timeout: 30000 },
    async () => {
      resetBrowserStateSignedIn();
      const restoreTauri = installTauriGlobal();
      // Boot succeeds and owns its listener (owned: true) — the healthy
      // starting point of QA's repro. The scripted `restart_host` answer is
      // the launcher's own report after QA's repro steps 2-3 (the entry
      // file moved aside, the process killed): it cannot spawn anything, so
      // it reports back exactly what the real launcher reports on every
      // failure — `owned: false`.
      const { bridge } = createFakeDesktopBridge({
        ensure_host: [readyStatus()],
        restart_host: [
          failedStatus({ reason: "entry_missing", port: null, pid: null, owned: false }),
        ],
      });
      setDesktopBridge(bridge);
      const host = createFakeHost({ mode: "chat", hasApiKey: true, workspace: null });
      let healthDown = false;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" ? input : input.toString();
        if (raw.includes("/api/health") && healthDown) {
          throw new Error("engine unreachable");
        }
        return host.fetchImpl(input, init);
      }) as typeof fetch;
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

      render(<App />);
      await screen.findByLabelText("Message to agent");

      // 2 consecutive failed health polls surface the band. The launch
      // status is still the original owned:true, so its retry affordances
      // are legitimately offered — sanity-checking the "before" half of the
      // contrast, not just the "after" half.
      healthDown = true;
      await new Promise((r) => setTimeout(r, 8700));
      assert.ok(
        screen.getByRole("button", { name: "Reconnect" }),
        "sanity: topbar Reconnect is offered before the failed retry (owned still true)",
      );
      assert.ok(
        screen.queryAllByText(/trying to reconnect/i).length >= 1,
        "sanity: the band still claims a retry is in flight before anything failed",
      );
      const user = userEvent.setup({ delay: null });
      const tryAgainBefore = screen.getAllByRole("button", { name: "Try again" });
      assert.ok(tryAgainBefore.length >= 1, "sanity: Try again offered before the retry");

      // The one manual retry available: it fails, and the launcher reports
      // owned:false — QA's exact repro.
      await user.click(tryAgainBefore[0]!);
      await waitFor(
        () => assert.equal(screen.queryByRole("button", { name: "Try again" }) === null, true),
        { timeout: 5000 },
      );
      assert.equal(screen.queryByRole("button", { name: "Reconnect" }) === null, true);
      assert.equal(
        screen.queryAllByText(/trying to reconnect/i).length,
        0,
        "N-4: copy must not assert an activity that is not happening",
      );

      restoreTauri();
    },
  );
});

function detailsText(container: ParentNode): string {
  const details = container.querySelector(".launch-details");
  assert.ok(details, "expected a .launch-details disclosure");
  // Same text-node walker as copyInvariants.test.tsx's `visibleText` — a
  // straight `.textContent` read across the <dt>/<dd> block boundaries would
  // collapse "channel" and "prod" into one run with no separator, silently
  // defeating any \b-anchored regex.
  const walker = document.createTreeWalker(details!, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent) parts.push(node.textContent);
  }
  return parts.join(" ");
}

// F10/N-2 (QA GATE Q pass 1c, AC-S8) — the shipped test this replaces
// (`F10/N-2 — AC-S8`, deleted) modelled an engine that failed 6 polls and
// then answered on the 7th: a state the product never reaches. Real launch
// failures never answer at all — every reason code that renders a
// full-screen card means the engine (or, before the N-3 fix, ANY engine at
// this shell's disposal) is not there. This suite uses `unreachableFetch()`
// throughout — the same "engine never answers" fake every other test in
// this file already uses — and proves `Details` and the diagnostics export
// are populated from the running executable, not from a network answer that
// never comes.
describe("F10/N-2 — AC-S8: Details carries build identity even though the engine never answers", () => {
  it("Details shows version (Tauri's own getVersion()) and channel/channelLabel (compile-time) on a real cold failure", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();
    const restoreTauri = installTauriGlobal();
    setDesktopBridge(
      async () =>
        failedStatus({ reason: "entry_missing", port: null, owned: false }) as unknown as never,
    );
    setAppVersionResolver(async () => "0.3.1");
    let healthAttempts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health")) healthAttempts += 1;
      throw new Error("engine unreachable");
    }) as unknown as typeof fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")), {
      timeout: 5000,
    });
    assert.equal(
      document.querySelector(".launch-failure-card")?.getAttribute("data-card"),
      "missing-file",
    );
    const details = document.querySelector(".launch-details") as HTMLDetailsElement;
    details.open = true;

    await waitFor(() => {
      const text = detailsText(document.body);
      assert.match(text, /\bversion\b/);
      assert.match(text, /\b0\.3\.1\b/);
      assert.match(text, /\bchannel\b/);
      assert.match(text, /\bprod\b/);
      assert.match(text, /\bPROD\b/);
    });
    // The engine never once answered — build identity did not come from it.
    // (Zero /api/health attempts is also correct post-N-3: with port: null
    // in a packaged build, `hostBase()` is null and `json()` refuses to
    // fetch at all — but this row is about N-2, so it only asserts that no
    // *successful* answer was needed, not the exact attempt count.)
    assert.ok(healthAttempts >= 0);
    restoreTauri();
  });

  it("exported diagnostics carry a ### Build section with real version/channel, not an empty one", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();
    const restoreTauri = installTauriGlobal();
    setDesktopBridge(
      async () =>
        failedStatus({ reason: "entry_missing", port: null, owned: false }) as unknown as never,
    );
    setAppVersionResolver(async () => "0.3.1");
    globalThis.fetch = unreachableFetch();
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")), {
      timeout: 5000,
    });

    // QA GATE Q's repro: the client-only fallback export is built from a
    // Blob handed to `URL.createObjectURL`. jsdom does not implement that
    // API at all (throws if called un-shimmed, which `downloadText`
    // silently swallows) — so it is safe to install a capturing shim for
    // this test only, without masking a real implementation.
    let captured: Blob | null = null;
    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      captured = b;
      return "blob:mock";
    };
    try {
      const saveButton = screen.getByRole("button", { name: "Save troubleshooting file" });
      fireEvent.click(saveButton);
      await waitFor(() => assert.ok(captured, "expected a diagnostics Blob to be created"));
      const text = await (captured as unknown as Blob).text();
      assert.match(text, /### Build/);
      assert.match(text, /version: 0\.3\.1/);
      assert.match(text, /channel: prod \(PROD\)/);
    } finally {
      (URL as unknown as { createObjectURL: unknown }).createObjectURL =
        originalCreateObjectURL;
    }
    restoreTauri();
  });
});

// N-3 (QA GATE Q pass 1c, Critical, no criterion — SPEC §2.5
// `instance-ownership-attach`, non-cuttable, and the new pinning row being
// added to SPEC.md §3 alongside this bounce) — a packaged build must never
// report ready by talking to a listener its own launcher did not spawn.
// This models the exact defect: the launcher genuinely failed and published
// `port: null`, while a real, healthy engine happens to be listening on the
// compile-time default port (a second Forge install, an orphaned host, or —
// per SPEC §2.5 — the operator's own `npm run start`, named there as the
// normal loop).
describe("N-3 — a packaged build never attaches to a foreign engine on the fallback port", () => {
  it("renders the named entry_missing failure card, never 'Engine · live', when a foreign engine holds the fallback port", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();
    const restoreTauri = installTauriGlobal();
    // The launcher's own status: it spawned nothing and has no port for us.
    setDesktopBridge(
      async () =>
        failedStatus({ reason: "entry_missing", port: null, owned: false }) as unknown as never,
    );
    // A real, healthy "foreign" engine — e.g. the developer host — happens
    // to be listening on the compile-time default port. Before the N-3 fix,
    // `hostPort()` fell back to that same default and the shell attached to
    // it, painting that engine's workspace as if it were this app's own.
    const foreignHost = createFakeHost({
      workspace: "C:\\Dev\\grokforge",
      workspaceName: "grokforge",
      recent: [],
    });
    globalThis.fetch = foreignHost.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await waitFor(() => assert.ok(document.querySelector(".launch-failure-card")), {
      timeout: 5000,
    });
    assert.equal(
      document.querySelector(".launch-failure-card")?.getAttribute("data-card"),
      "missing-file",
      "entry_missing must still render its own named card, not a false-green ready state",
    );
    // The ready-state chrome (topbar, engine chip) never mounts at all while
    // `boot !== "ready"` — a structural check, not just absence-of-text.
    assert.equal(document.querySelector(".topbar"), null);
    assert.equal(screen.queryByText("Engine · live"), null);
    // The decisive proof: the "foreign" engine was never asked for
    // /api/state at all — the shell never got far enough to read (let alone
    // paint) its workspace.
    assert.equal(foreignHost.callsTo("/api/state").length, 0);
    restoreTauri();
  });
});
