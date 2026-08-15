// F1 — the launcher boundary: typed value, test seam, runtime port.
// Binds to INTERFACE_CONTRACT.md's launcher->shell table, never to the Rust
// implementation (spire-tech-contract-consume). Only two things are mocked
// here: the IPC boundary (this file) — no network boundary needed.
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ensureDesktopHost,
  hostBase,
  hostPort,
  localBuildIdentity,
  restartDesktopHost,
  setAppVersionResolver,
  setRuntimePort,
  wsUrl,
  type DesktopHostStatus,
} from "./api";
import { setDesktopBridge } from "./desktopBridge";

function installTauriGlobal(): () => void {
  const w = window as unknown as Record<string, unknown>;
  const had = "__TAURI_INTERNALS__" in w;
  const prev = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = {};
  return () => {
    if (had) w.__TAURI_INTERNALS__ = prev;
    else delete w.__TAURI_INTERNALS__;
  };
}

afterEach(() => {
  setDesktopBridge(null);
  setRuntimePort(null);
});

describe("F1 — desktopBridge test seam + typed DesktopHostStatus", () => {
  it("ensureDesktopHost() returns the full eight-field value from a fake bridge", async () => {
    const restoreTauri = installTauriGlobal();
    const full: DesktopHostStatus = {
      ok: true,
      phase: "ready",
      owned: true,
      port: 8801,
      pid: 4242,
      reason: null,
      osError: null,
      message: "",
    };
    setDesktopBridge(async () => full as unknown as never);

    const status = await ensureDesktopHost();
    assert.deepEqual(status, full);
    restoreTauri();
  });

  it("restartDesktopHost() also routes through the fake bridge and returns all fields", async () => {
    const restoreTauri = installTauriGlobal();
    const full: DesktopHostStatus = {
      ok: false,
      phase: "failed",
      owned: true,
      port: 8801,
      pid: null,
      reason: "crashed",
      osError: null,
      message: "child exited",
    };
    setDesktopBridge(async () => full as unknown as never);

    const status = await restartDesktopHost();
    assert.deepEqual(status, full);
    restoreTauri();
  });

  it("setRuntimePort(8801) redirects hostBase() and wsUrl() away from VITE_GROKFORGE_PORT", () => {
    setRuntimePort(8801);
    // hostBase() only returns an absolute origin under isTauri(); force that
    // branch so the assertion exercises the packaged-build path this task
    // is about, not the browser-dev Vite-proxy branch.
    const restoreTauri = installTauriGlobal();
    assert.equal(hostPort(), 8801);
    assert.equal(hostBase(), "http://127.0.0.1:8801");
    assert.equal(wsUrl(), "ws://127.0.0.1:8801/ws");
    restoreTauri();
  });

  it("a bridge invoke failure synthesizes a full DesktopHostStatus (never a partial shape)", async () => {
    const restoreTauri = installTauriGlobal();
    setDesktopBridge(async () => {
      throw new Error("ipc failed");
    });
    const status = await ensureDesktopHost();
    assert.equal(status.ok, false);
    assert.equal(status.phase, "failed");
    assert.equal(status.reason, "unknown");
    assert.equal(status.owned, false);
    assert.equal(status.port, null);
    restoreTauri();
  });
});

// QA GATE Q pass 1c, N-3 — SPEC §2.5 `instance-ownership-attach` (non-cuttable):
// a packaged build must never assume a default port when the launcher
// supplies none. A hardcoded fallback here is exactly how the shell ends up
// talking to a foreign engine (a second Forge install, an orphaned host, the
// operator's own `npm run start`) sitting on the compile-time default port.
describe("N-3 — hostPort()/hostBase()/wsUrl() never fabricate a port in a packaged build", () => {
  it("under Tauri with no launcher-published port, hostPort()/hostBase()/wsUrl() are all null", () => {
    const restoreTauri = installTauriGlobal();
    setRuntimePort(null);
    assert.equal(hostPort(), null);
    assert.equal(hostBase(), null);
    assert.equal(wsUrl(), null);
    restoreTauri();
  });

  it("a launcher failure that reports port: null clears a previously-known port", () => {
    const restoreTauri = installTauriGlobal();
    setRuntimePort(8801); // a prior successful launch
    assert.equal(hostPort(), 8801);
    setRuntimePort(null); // this launch's status.port, per ensureDesktopHost()
    assert.equal(hostPort(), null);
    assert.equal(hostBase(), null);
    restoreTauri();
  });

  it("the development-browser path (no Tauri, no launcher) is unaffected: it still falls back to the compile-time default port", () => {
    // No installTauriGlobal() here — isTauri() is false, exactly the
    // from-source dev-browser path this fix must preserve (task brief).
    setRuntimePort(null);
    assert.equal(typeof hostPort(), "number");
    assert.ok((hostPort() as number) > 0);
  });
});

// QA GATE Q pass 1c, N-2 (AC-S8) — build identity available even when the
// engine is dead (or, before the N-3 fix, when a foreign engine answers
// instead). Sourced from the running executable + compile-time constants,
// never from a fetch to `hostPort()`.
describe("N-2 — localBuildIdentity() never depends on the engine answering", () => {
  afterEach(() => setAppVersionResolver(null));

  it("under Tauri, resolves version via the injected resolver plus the compile-time channel", async () => {
    const restoreTauri = installTauriGlobal();
    setAppVersionResolver(async () => "0.3.1");
    const info = await localBuildIdentity();
    assert.equal(info.version, "0.3.1");
    assert.equal(info.channel, "prod");
    assert.equal(info.channelLabel, "PROD");
    restoreTauri();
  });

  it("under Tauri, a version-lookup failure still returns channel/channelLabel — never throws", async () => {
    const restoreTauri = installTauriGlobal();
    setAppVersionResolver(async () => {
      throw new Error("no IPC transport");
    });
    const info = await localBuildIdentity();
    assert.equal(info.version, undefined);
    assert.equal(info.channel, "prod");
    assert.equal(info.channelLabel, "PROD");
    restoreTauri();
  });

  it("outside Tauri (browser dev), no IPC is attempted — channel/channelLabel only", async () => {
    let calls = 0;
    setAppVersionResolver(async () => {
      calls += 1;
      return "0.3.1";
    });
    const info = await localBuildIdentity();
    assert.equal(calls, 0, "must not attempt the Tauri-only version lookup outside Tauri");
    assert.equal(info.version, undefined);
    assert.equal(info.channel, "prod");
  });
});
