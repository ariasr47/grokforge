// honest-unsigned-first-run — dual-source SHA, Welcome honesty, Settings
// unsigned line. Mocks the network boundary (fetch / WebSocket) and the
// Tauri IPC seam only (spire-tech-flow-integration-tests).
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { Onboarding } from "./Onboarding";
import {
  assertNoBannedPositiveTrustClaims,
  type InstallerShaVoucher,
} from "./installerHonesty";
import {
  createFakeHost,
  FakeWebSocket,
  installTauriGlobal,
  readyStatus,
} from "./testFakeHost";
import { setDesktopBridge } from "./desktopBridge";
import { setAppVersionResolver } from "./api";
import { reloadSessionsFromDisk } from "./sessions";
import { setHealthPollTestScheduler } from "./healthPollTestClock";
import type { FirstRunState } from "./firstRun";

const HEX64 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const HEX64_B =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const LOCAL_VERSION = "0.6.6";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

const VIRGIN_FIRST_RUN: FirstRunState = {
  dismissed: false,
  openedFolder: false,
  signedIn: false,
  sentMessage: false,
  pickedMode: false,
  seenAt: "2026-01-01T00:00:00.000Z",
};

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;
const restores: Array<() => void> = [];

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  setHealthPollTestScheduler(null);
});

beforeEach(() => {
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  setDesktopBridge(null);
  setAppVersionResolver(null);
  setHealthPollTestScheduler(null);
  while (restores.length) restores.pop()?.();
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

async function eventually(check: () => void, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      last = error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
  }
  throw last instanceof Error ? last : new Error("condition not met before timeout");
}

function stubUserAgent(ua: string): () => void {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    enumerable: true,
    get: () => ua,
  });
  return () => {
    delete (window.navigator as { userAgent?: string }).userAgent;
  };
}

function dismissFirstRun(): void {
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

function virginProfile(): void {
  localStorage.clear();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

function installPackagedWindows(): void {
  restores.push(installTauriGlobal());
  restores.push(stubUserAgent(WINDOWS_UA));
  setDesktopBridge(async () => readyStatus() as unknown as never);
  setAppVersionResolver(async () => LOCAL_VERSION);
}

async function openSettings(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await screen.findByText(/Engine · (live|reconnecting)/, undefined, { timeout: 8_000 });
  const settings = screen
    .getAllByRole("button", { name: "Settings" })
    .find((button) => button.className.includes("ghost"));
  assert.ok(settings, "expected topbar Settings button");
  await user.click(settings);
  await screen.findByRole("heading", { name: "Settings" });
  const callout = document.querySelector(".callout");
  assert.ok(callout instanceof HTMLElement);
  return callout;
}

function renderWelcome(opts: {
  voucher: InstallerShaVoucher;
  packagedWindowsHonesty: boolean;
}): void {
  render(
    <Onboarding
      firstRun={VIRGIN_FIRST_RUN}
      hasWorkspace={false}
      signedIn={false}
      mode="chat"
      onOpenFolder={() => undefined}
      onOpenSettings={() => undefined}
      onDismiss={() => undefined}
      installerShaVoucher={opts.voucher}
      packagedWindowsHonesty={opts.packagedWindowsHonesty}
    />,
  );
}

describe("honest-unsigned Settings dual-source (F2/F3)", () => {
  it("local identity only (health deferred) paints Loading, not unavailable, with unsigned line", async () => {
    dismissFirstRun();
    installPackagedWindows();
    const host = createFakeHost({ mode: "chat", hasApiKey: true });
    let healthCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health")) {
        healthCalls += 1;
        if (healthCalls > 1) await gate;
      }
      return host.fetchImpl(input, init);
    }) as typeof fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const callout = await openSettings();
    await eventually(() => {
      assert.match(callout.textContent ?? "", /Loading installer SHA-256…/);
    });
    assert.doesNotMatch(callout.textContent ?? "", /Installer SHA-256 unavailable/);
    assert.doesNotMatch(callout.textContent ?? "", /[0-9a-f]{64}/);
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed\. Windows may show an unknown-publisher or SmartScreen warning\./,
    );
    assertNoBannedPositiveTrustClaims(callout.textContent ?? "");
    release();
  });

  it("health present hex paints the digest plus unsigned line", async () => {
    dismissFirstRun();
    const host = createFakeHost(
      { mode: "chat", hasApiKey: true },
      { healthInstallerSha256: HEX64 },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const callout = await openSettings();
    await eventually(() => {
      assert.match(callout.textContent ?? "", /Installer SHA-256:/);
      assert.ok((callout.textContent ?? "").includes(HEX64));
    });
    const sha = callout.querySelector("code.installer-sha");
    assert.ok(sha);
    assert.equal(sha.textContent, HEX64);
    assert.match(
      sha.getAttribute("title") ?? "",
      /Forge does not claim Windows verified this publisher/,
    );
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed/,
    );
    assertNoBannedPositiveTrustClaims(callout.textContent ?? "");
  });

  it("health null paints unavailable (not unreachable) plus unsigned line", async () => {
    dismissFirstRun();
    const host = createFakeHost(
      { mode: "chat", hasApiKey: true },
      { healthInstallerSha256: null },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const callout = await openSettings();
    await eventually(() => {
      assert.match(callout.textContent ?? "", /Installer SHA-256 unavailable/);
    });
    assert.doesNotMatch(
      callout.textContent ?? "",
      /Installer SHA-256 unreachable — host is offline/,
    );
    assert.doesNotMatch(callout.textContent ?? "", /[0-9a-f]{64}/);
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed/,
    );
    assertNoBannedPositiveTrustClaims(callout.textContent ?? "");
  });

  it("health throw after local identity clears hex, paints unreachable, keeps Version, unsigned line stays", async () => {
    dismissFirstRun();
    installPackagedWindows();
    const host = createFakeHost(
      { mode: "chat", hasApiKey: true },
      { healthInstallerSha256: HEX64 },
    );
    let healthCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      if (raw.includes("/api/health")) {
        healthCalls += 1;
        if (healthCalls > 1) throw new Error("engine unreachable");
      }
      return host.fetchImpl(input, init);
    }) as typeof fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const callout = await openSettings();
    await eventually(() => {
      assert.match(
        callout.textContent ?? "",
        /Installer SHA-256 unreachable — host is offline/,
      );
    });
    assert.equal((callout.textContent ?? "").includes(HEX64), false);
    assert.doesNotMatch(callout.textContent ?? "", /Installer SHA-256 unavailable/);
    assert.match(callout.textContent ?? "", new RegExp(LOCAL_VERSION));
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed/,
    );
    assertNoBannedPositiveTrustClaims(callout.textContent ?? "");
  });

  it("pollHealth re-vouches SHA after unreachable without remount", async () => {
    dismissFirstRun();
    const healthClock: { trigger?: () => void } = {};
    setHealthPollTestScheduler((poll) => {
      healthClock.trigger = poll;
      return () => {
        healthClock.trigger = undefined;
      };
    });
    const host = createFakeHost(
      { mode: "chat", hasApiKey: true },
      { healthInstallerSha256: HEX64 },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const callout = await openSettings();
    await eventually(() => {
      assert.ok((callout.textContent ?? "").includes(HEX64));
    });

    host.healthFail = true;
    assert.ok(healthClock.trigger);
    healthClock.trigger!();
    await eventually(() => {
      assert.match(
        callout.textContent ?? "",
        /Installer SHA-256 unreachable — host is offline/,
      );
    });
    assert.equal((callout.textContent ?? "").includes(HEX64), false);
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed/,
    );

    host.healthFail = false;
    host.healthInstallerSha256 = HEX64_B;
    healthClock.trigger!();
    await eventually(() => {
      assert.ok((callout.textContent ?? "").includes(HEX64_B));
    });
    assert.equal((callout.textContent ?? "").includes(HEX64), false);
    assert.match(callout.textContent ?? "", /Installer SHA-256:/);
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed/,
    );

    host.healthInstallerSha256 = null;
    healthClock.trigger!();
    await eventually(() => {
      assert.match(callout.textContent ?? "", /Installer SHA-256 unavailable/);
    });
    assert.equal((callout.textContent ?? "").includes(HEX64_B), false);
    assert.doesNotMatch(
      callout.textContent ?? "",
      /Installer SHA-256 unreachable — host is offline/,
    );
    assert.match(
      callout.textContent ?? "",
      /This Windows installer is not Authenticode-signed/,
    );
  });
});

describe("honest-unsigned Welcome (F4)", () => {
  it("virgin packaged Windows Welcome shows expected-warning (empty profile, not dismissed-only)", () => {
    renderWelcome({
      voucher: { status: "pending" },
      packagedWindowsHonesty: true,
    });
    assert.ok(screen.getByText("Welcome to Forge"));
    const strip = screen.getByRole("status");
    assert.match(strip.textContent ?? "", /expected/);
    assert.match(strip.textContent ?? "", /SmartScreen/);
    assert.match(strip.textContent ?? "", /unknown-publisher/);
    assert.match(strip.textContent ?? "", /not Authenticode-signed/);
    assert.match(strip.textContent ?? "", /Loading installer SHA-256…/);
    assert.equal(document.querySelectorAll(".onboarding-steps li").length, 5);
    assertNoBannedPositiveTrustClaims(strip.textContent ?? "");
  });

  it("virgin Welcome with packaged Windows false does not claim SmartScreen for this session", () => {
    renderWelcome({
      voucher: { status: "pending" },
      packagedWindowsHonesty: false,
    });
    assert.ok(screen.getByText("Welcome to Forge"));
    const region = screen.getByRole("region", { name: "Getting started" });
    assert.doesNotMatch(region.textContent ?? "", /That is expected/);
    assert.doesNotMatch(
      region.textContent ?? "",
      /unknown-publisher or SmartScreen warning\. That is expected/,
    );
    assert.match(region.textContent ?? "", /Loading installer SHA-256…/);
  });

  it("Welcome live hex shows Installer SHA-256 and compare hint", () => {
    renderWelcome({
      voucher: { status: "live", value: HEX64 },
      packagedWindowsHonesty: true,
    });
    const strip = screen.getByRole("status");
    assert.match(strip.textContent ?? "", /Installer SHA-256:/);
    assert.ok((strip.textContent ?? "").includes(HEX64));
    assert.match(
      strip.textContent ?? "",
      /Compare with the SHA-256 in the release notes for this version/,
    );
    assert.match(strip.textContent ?? "", /That is expected/);
    assertNoBannedPositiveTrustClaims(strip.textContent ?? "");
  });

  it("Welcome pending / unavailable / unreachable use exact distinct copy", () => {
    const { unmount } = render(
      <Onboarding
        firstRun={VIRGIN_FIRST_RUN}
        hasWorkspace={false}
        signedIn={false}
        mode="chat"
        onOpenFolder={() => undefined}
        onOpenSettings={() => undefined}
        onDismiss={() => undefined}
        installerShaVoucher={{ status: "live", value: null }}
        packagedWindowsHonesty={true}
      />,
    );
    let strip = screen.getByRole("status");
    assert.match(strip.textContent ?? "", /Installer SHA-256 unavailable\./);
    assert.match(strip.textContent ?? "", /Find it in Settings when available/);
    assert.doesNotMatch(strip.textContent ?? "", /unreachable/);
    unmount();

    render(
      <Onboarding
        firstRun={VIRGIN_FIRST_RUN}
        hasWorkspace={false}
        signedIn={false}
        mode="chat"
        onOpenFolder={() => undefined}
        onOpenSettings={() => undefined}
        onDismiss={() => undefined}
        installerShaVoucher={{ status: "unreachable" }}
        packagedWindowsHonesty={true}
      />,
    );
    strip = screen.getByRole("status");
    assert.match(
      strip.textContent ?? "",
      /Installer SHA-256 unreachable — host is offline/,
    );
    assert.doesNotMatch(strip.textContent ?? "", /Find it in Settings when available/);
    assert.doesNotMatch(strip.textContent ?? "", /Installer SHA-256 unavailable/);
    assert.match(strip.textContent ?? "", /That is expected/);
  });

  it("App virgin empty-profile packaged Windows Welcome is the expected-warning proof", async () => {
    virginProfile();
    installPackagedWindows();
    const host = createFakeHost(
      { mode: "chat", hasApiKey: true, workspace: null, priorConversations: false },
      { healthInstallerSha256: HEX64 },
    );
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    assert.ok(await screen.findByText("Welcome to Forge", undefined, { timeout: 8_000 }));
    await eventually(() => {
      const region = screen.getByRole("region", { name: "Getting started" });
      assert.match(region.textContent ?? "", /That is expected/);
      assert.match(region.textContent ?? "", /SmartScreen/);
      assert.match(region.textContent ?? "", /not Authenticode-signed/);
      assert.ok((region.textContent ?? "").includes(HEX64));
    });
    assertNoBannedPositiveTrustClaims(
      screen.getByRole("region", { name: "Getting started" }).textContent ?? "",
    );
  });

  it("App virgin browser session does not claim SmartScreen is expected for this session", async () => {
    virginProfile();
    restores.push(stubUserAgent(MAC_UA));
    const host = createFakeHost({
      mode: "chat",
      hasApiKey: true,
      workspace: null,
      priorConversations: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    assert.ok(await screen.findByText("Welcome to Forge", undefined, { timeout: 8_000 }));
    const region = screen.getByRole("region", { name: "Getting started" });
    assert.doesNotMatch(region.textContent ?? "", /That is expected/);
    assert.doesNotMatch(
      region.textContent ?? "",
      /unknown-publisher or SmartScreen warning\. That is expected/,
    );
  });
});
