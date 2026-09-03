// F9 — copy invariants: banned tokens and the one noun (AC-U4, AC-U14).
// Renders each of the five surfaces named in the SPEC's vocabulary ruling
// directly (component-level — the wiring that reaches each surface is
// covered by the F2-F8 flow tests) and asserts the rendered text, minus the
// `Details` disclosure subtree (legal there), contains none of the banned
// developer tokens, and that no surface makes a claim about what Grok
// remembers/forgets across an engine restart.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";
import { LaunchFailureCard } from "./LaunchFailureCard";
import { EmptyStates } from "./EmptyStates";
import { HomeScreen } from "./HomeScreen";
import type { DesktopHostStatus, LaunchReason } from "./api";
import { CARD_COPY } from "./failureCard";
import { SETTINGS_UNSIGNED_LINE } from "./installerHonesty";
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

const BANNED = [
  "host",
  "npm",
  "Node",
  "node.exe",
  "nodejs.org",
  "port",
  "8787",
  "Origin",
  "CORS",
  "403",
  "stdio",
  "ACP",
  "GROKFORGE_ROOT",
];

/** Text outside any `.launch-details`/`details` subtree (legal there). */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((d) => d.remove());
  // GATE Z round 3 — `.textContent` concatenates across block-element
  // boundaries with no separator, so two adjacent elements' text ("…Restart
  // host" + "Auth priority…") collapse into one run ("hostAuth") that the
  // \b-anchored regex below silently fails to match. Walking text nodes and
  // joining with a space keeps every whole-word boundary real regardless of
  // how the surface is laid out — this is the gap that let the Settings
  // sweep in this same file pass while "Restart host" shipped.
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent) parts.push(node.textContent);
  }
  return parts.join(" ");
}

// Whole-app surfaces (Settings, the command palette) are wider than the five
// AC-U4 launch/degraded surfaces the base `BANNED` list was authored for:
// Settings legitimately names real executables in the shell-tool allowlist
// checkbox ("npm, git, node") and a real backend protocol in the agent
// picker ("ACP") — pre-existing, deliberate technical disclosure unrelated
// to the local-process noun AC-U14 governs, and not part of this bounce.
// "host" (the actual violation class QA found) and everything else in
// `BANNED` still applies everywhere, including Settings and the palette.
const BANNED_WHOLE_APP = BANNED.filter((t) => !["npm", "Node", "ACP"].includes(t));

function assertNoBannedTokens(
  text: string,
  label: string,
  list: string[] = BANNED,
): void {
  for (const token of list) {
    // Whole-word, case-insensitive so "host" doesn't false-positive on
    // "ghost" but does catch "Host offline".
    const re = new RegExp(`\\b${token}\\b`, "i");
    assert.equal(
      re.test(text),
      false,
      `${label}: found banned token "${token}" in rendered text: ${JSON.stringify(text)}`,
    );
  }
}

function assertNoMemoryClaim(text: string, label: string): void {
  // The sign-in surface's own "Forge remembers this on this PC." is about
  // the credential, not Grok — explicitly exempted.
  const withoutSignInLine = text.replace("Forge remembers this on this PC.", "");
  for (const phrase of ["remember", "forget", "context may be lost"]) {
    const re = new RegExp(phrase, "i");
    assert.equal(
      re.test(withoutSignInLine),
      false,
      `${label}: found a memory claim ("${phrase}") outside the sign-in credential line`,
    );
  }
}

const ALL_REASONS: Array<{ reason: LaunchReason; osError: number | null }> = [
  { reason: "entry_missing", osError: null },
  { reason: "runtime_missing", osError: 5 },
  { reason: "crashed", osError: null },
  { reason: "health_timeout", osError: null },
  { reason: "port_unavailable", osError: null },
  { reason: "origin_refused", osError: null },
];

describe("F9 — AC-U4: banned tokens absent from the starting card", () => {
  it("brand + phase line + spinner carry no developer token", async () => {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();
    const restoreTauri = installTauriGlobal();
    setDesktopBridge(() => new Promise(() => {}));
    const host = createFakeHost();
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    await screen.findByText("Forge");
    assertNoBannedTokens(visibleText(document.body), "starting card");
    restoreTauri();
  });
});

describe("F9 — AC-U4: banned tokens absent from every failure card", () => {
  for (const { reason, osError } of ALL_REASONS) {
    it(`card for reason=${reason}`, () => {
      const status: DesktopHostStatus = {
        ok: false,
        phase: "failed",
        owned: true,
        port: 8787, // present on the status object itself, but must not leak into visible copy
        pid: 4242,
        reason,
        osError,
        message: "raw launcher message",
      };
      const { container } = render(
        <LaunchFailureCard
          status={status}
          hasStoredHistory={false}
          onRetry={() => {}}
          onSaveDiagnostics={() => {}}
        />,
      );
      assertNoBannedTokens(visibleText(container), `failure card (${reason})`);
    });
  }

  it("CARD_COPY table itself carries no banned token in headline/body", () => {
    for (const [id, copy] of Object.entries(CARD_COPY)) {
      assertNoBannedTokens(`${copy.headline} ${copy.body}`, `CARD_COPY[${id}]`);
    }
  });
});

describe("F9 — AC-U4/AC-U14: EmptyStates surfaces (engine-stopped, sign-in, not-found)", () => {
  it("engine-stopped ('host-offline' kind)", () => {
    const { container } = render(
      <EmptyStates kind="host-offline" onReconnect={() => {}} />,
    );
    const text = visibleText(container);
    assertNoBannedTokens(text, "engine-stopped");
    assertNoMemoryClaim(text, "engine-stopped");
  });

  it("sign-in ('signed-out' kind) — and the withdrawn 'only once' claim stays gone", () => {
    const { container } = render(<EmptyStates kind="signed-out" onSettings={() => {}} />);
    const text = visibleText(container);
    assertNoBannedTokens(text, "sign-in");
    assertNoMemoryClaim(text, "sign-in");
    assert.equal(/only need to do this once/i.test(text), false);
    assert.match(text, /Forge remembers this on this PC\./);
  });

  it("conversations-not-found", () => {
    const { container } = render(
      <EmptyStates
        kind="conversations-not-found"
        onSaveDiagnostics={() => {}}
        onStartNewConversation={() => {}}
      />,
    );
    const text = visibleText(container);
    assertNoBannedTokens(text, "conversations-not-found");
    assertNoMemoryClaim(text, "conversations-not-found");
    // Names no cause, does not claim the data is unrecoverable.
    assert.equal(/gone|lost forever|unrecoverable|deleted permanently/i.test(text), false);
  });
});

// Task 13 — Home replaces the old "ready"/"no-workspace" EmptyStates kinds
// (docs/design/forge-next/Home.dc.html) and is itself a launch surface, so
// it must keep passing the same banned-token check the five original kinds
// get above. Rendered directly (component-level, matching this file's own
// pattern) with a fixture that exercises every text path at once: a
// Needs-you item, a Recent workspace with a branch, a Chat home with a
// preview, and a non-null installer warning + channel badge in the footer
// — the two facts the brief specifically warned could leak a banned token
// ("host"/"port"/"8787") if they were ever rendered as a raw path.
describe("F9/Task 13 — AC-U4/AC-U14: the Home screen carries no banned token", () => {
  it("every section (Needs you, Recent, Chat homes, Start, footer) is clean", () => {
    const { container } = render(
      <HomeScreen
        now={new Date(2026, 0, 1, 9, 0)}
        greetingName={null}
        needsYou={[
          { workspace: "C:\\Dev\\grokforge", id: "s1", title: "Approve a command", reason: "approve" },
        ]}
        recentWorkspaces={[
          {
            path: "C:\\Dev\\grokforge",
            name: "grokforge",
            branch: "master",
            sessionCount: 4,
            lastSessionId: "s1",
            lastTitle: "Fix typecheck in apps/shell",
            updatedAt: Date.now(),
          },
        ]}
        chatHomes={[
          { id: "home-1", title: "Family admin", preview: "Landlord email draft", updatedAt: Date.now() },
        ]}
        footer={{
          version: "0.7.0",
          installerWarning: SETTINGS_UNSIGNED_LINE,
          authLabel: "Grok · subscription",
          channel: "DEV",
          isPackagedWindows: true,
        }}
        onFieldQuery={() => {}}
        onOpenNeedsYou={() => {}}
        onOpenWorkspace={() => {}}
        onOpenChatHome={() => {}}
        onAllSessions={() => {}}
        onNewChatHome={() => {}}
        onOpenFolder={() => {}}
        onNewSession={() => {}}
        onNewChat={() => {}}
      />,
    );
    const text = visibleText(container);
    assertNoBannedTokens(text, "Home screen");
    assertNoMemoryClaim(text, "Home screen");
    // The brief's own warning, made concrete: no raw port/path leaks in
    // place of the generic "data folder" phrasing (this build renders
    // neither — the footer never mentions a data location at all).
    assert.equal(/:8787|%USERPROFILE%/i.test(text), false);
  });
});

describe("F9/GATE-Z-round-3 — AC-U14 'every surface': Settings and the command palette", () => {
  // GATE Z round 3 — the F9 sweep above only ever rendered the five AC-U4
  // surfaces named in the vocabulary ruling; it never reached the main app
  // shell at all, so "Reconnect host" / "Restart host" / "host managed
  // automatically" shipped in Settings and the command palette while this
  // file was green. AC-U14's clause is broader than AC-U4's five named
  // surfaces ("every surface"), so this block renders the real ready-state
  // App — the one tree the earlier block never mounted — and scans both.
  // Installs the Tauri IPC boundary (not just the fetch/WS boundary) so the
  // rendered branch is the one AC-U14 actually governs — the packaged app
  // (`tauri` true) — not the browser-dev fallback copy ("prefer npm run
  // desktop…") that only a developer running the Vite dev server ever sees.
  async function renderReadyApp() {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    FakeWebSocket.reset();
    const restoreTauri = installTauriGlobal();
    setDesktopBridge(async () => readyStatus() as unknown as never);
    const host = createFakeHost({ mode: "chat", recent: [], workspace: null });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    // Ready state renders the topbar's engine chip — proof boot resolved
    // past the starting card into the surfaces this block targets.
    await screen.findByText(/Grok · (live|reconnecting)/);
    return restoreTauri;
  }

  it("Settings panel carries no banned token", async () => {
    const restore = await renderReadyApp();
    // Both the topbar toggle and the sidebar view tab render an accessible
    // name of exactly "Settings" — pick the topbar one (`.btn.ghost`).
    const settingsToggle = screen
      .getAllByRole("button", { name: "Settings" })
      .find((b) => b.className.includes("ghost"));
    assert.ok(settingsToggle, "expected the topbar Settings toggle");
    settingsToggle!.click();
    await screen.findByRole("heading", { name: "Settings" });
    assertNoBannedTokens(visibleText(document.body), "Settings panel", BANNED_WHOLE_APP);
    restore();
  });

  it("command palette (all listed actions, unfiltered) carries no banned token", async () => {
    const restore = await renderReadyApp();
    screen.getByTitle("Command palette (Ctrl+K)").click();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    assertNoBannedTokens(
      visibleText(dialog as HTMLElement),
      "command palette",
      BANNED_WHOLE_APP,
    );
    restore();
  });
});

describe("F11 — AC27f: the install guide passes the same vocabulary review", () => {
  it("docs/INSTALL-GUIDE.md contains none of the AC-U4 banned tokens", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const guidePath = path.resolve(here, "..", "..", "..", "docs", "INSTALL-GUIDE.md");
    const text = fs.readFileSync(guidePath, "utf8");
    // "port"/"Origin" etc are whole-word matched — "important"/"origin" story
    // words aside, the guide must not use the developer tokens at all.
    for (const token of BANNED) {
      const re = new RegExp(`\\b${token}\\b`, "i");
      assert.equal(re.test(text), false, `INSTALL-GUIDE.md contains banned token "${token}"`);
    }
  });
});
