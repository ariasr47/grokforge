// F2 (boot)/F5 (debounced engine-death band)/F6 (bounded recovery) at the
// hook level. Mocks the network boundary (fetch) and the transport boundary
// (WebSocket) only, via the same `createFakeHost`/`FakeWebSocket` fakes the
// `<App/>`-level F2/F5 tests (App.launch.test.tsx/App.engineDeath.test.tsx)
// already use — real `useEngineHealth`, real `bootApp`/`retryHost`/the
// socket-connect/health-poll effects.
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { useEngineHealth } from "./useEngineHealth";
import { setHealthPollTestScheduler } from "../lib/healthPollTestClock";
import { createFakeHost, FakeWebSocket, type FakeHost } from "./testFakeHost";
import { initialRunProjection, type RunProjection } from "../projections/runReducer";
import type { DesktopHostStatus, PublicState } from "../lib/api";
import type { RestoreIntent } from "../projections/catchUpWindows";

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;
let currentUnmount: (() => void) | null = null;

// Guarantees teardown even when a mid-test assertion throws: without this,
// a failed assertion skips a manual `unmount()` at the end of the test body,
// leaving that test's HostSocket/FakeWebSocket and (absent the scheduler
// seam below) a real setInterval running for the rest of the process's
// life — which is exactly what hung this suite the first time it was run
// (see the health-poll ordering note on installHealthScheduler below).
afterEach(() => {
  currentUnmount?.();
  currentUnmount = null;
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.reset();
  setHealthPollTestScheduler(null);
});

function noop(): void {}

type BootPhase = "booting" | "ready" | "error";

/**
 * Mirrors how App.tsx actually calls the hook: boot/launchStatus/hostOk are
 * real useState (App.tsx owns all three — see useEngineHealth.ts's own
 * params doc), refs are real useRef calls (a plain object recreated every
 * render would lose the ref's own mutations between renders, the same
 * reasoning useComposerSend.test.ts's harness comment gives for its own
 * busyRef/sendInFlightRef). onServerEvent/markDisconnectedActivity are
 * no-ops (this hook never calls the former itself — only the unmoved
 * HostSocket-connect effect's own `sock.on(...)` would, and no test here
 * pushes a server event); restoreOwnedRuns/reconcileOwnedRuns record every
 * call so a test can assert on the "back-reference" contract the brief
 * itself calls out.
 */
function useHarness() {
  const [boot, setBoot] = useState<BootPhase>("booting");
  const [, setBootMsg] = useState("");
  const [launchStatus, setLaunchStatus] = useState<DesktopHostStatus | null>(null);
  const [hostOk, setHostOk] = useState(false);

  const runProjectionRef = useRef<RunProjection>(initialRunProjection());
  const busyRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);

  const applyStateCallsRef = useRef<PublicState[]>([]);
  const restoreOwnedRunsCallsRef = useRef<RestoreIntent[]>([]);
  const reconcileOwnedRunsCallsRef = useRef(0);

  const hook = useEngineHealth({
    boot,
    setBoot,
    setBootMsg,
    launchStatus,
    setLaunchStatus,
    setHostOk,
    runProjectionRef,
    busyRef,
    sendInFlightRef,
    cancelInFlightRef,
    // A zero-parameter function is assignable to any Dispatch<SetStateAction<T>>
    // (TypeScript's own "fewer params is fine" callback-compatibility rule) —
    // no cast needed. None of these values are ever read back by the hook
    // (write-only — see useEngineHealth.ts's params doc), so a no-op is a
    // faithful stand-in for App.tsx's own setters here.
    setRunStartedAt: noop,
    setRunPhase: noop,
    setRunPhaseDetail: noop,
    setRunFooter: noop,
    setAwaitingNextTurn: noop,
    setPathInput: noop,
    setFirstRun: noop,
    setModelDraft: noop,
    setShellAllowlist: noop,
    applyState: (payload: PublicState) => {
      applyStateCallsRef.current.push(payload);
    },
    toast: { push: noop, dismiss: noop },
    onServerEvent: noop,
    restoreOwnedRuns: (intent: RestoreIntent) => {
      restoreOwnedRunsCallsRef.current.push(intent);
      return Promise.resolve({ ok: true, hasNonterminal: false });
    },
    markDisconnectedActivity: noop,
    reconcileOwnedRuns: () => {
      reconcileOwnedRunsCallsRef.current += 1;
      return Promise.resolve({ ok: true, hasNonterminal: false });
    },
  });

  return {
    ...hook,
    boot,
    hostOk,
    launchStatus,
    applyStateCalls: applyStateCallsRef.current,
    restoreOwnedRunsCalls: restoreOwnedRunsCallsRef.current,
  };
}

/**
 * Installs the healthPollTestClock seam. Must run BEFORE `mount` on every
 * test, even one that never calls the returned `trigger` — installing it
 * only after boot reaches "ready" is too late: the health-poll effect reads
 * whichever scheduler is CURRENTLY registered the instant it first mounts
 * (`installHealthPollTestScheduler`, called from inside the effect body),
 * and a `null` scheduler at that moment falls through to the production
 * path, `setInterval(pollHealth, 4000)` — a real, uncancellable-by-us timer
 * that outlives the test and (via `afterEach`'s `currentUnmount`, itself
 * only reachable once the effect's OWN cleanup runs) genuinely hung this
 * suite the first time it was run under the wrong ordering. Matches
 * App.engineDeath.test.tsx's own ordering (`setHealthPollTestScheduler`
 * before `render(<App/>)`, not after boot settles).
 */
function installHealthScheduler(): { trigger?: () => void } {
  const clock: { trigger?: () => void } = {};
  setHealthPollTestScheduler((poll) => {
    clock.trigger = poll;
    return () => {
      clock.trigger = undefined;
    };
  });
  return clock;
}

/** Installs the fetch/WebSocket fakes and renders the harness. Teardown is
 *  automatic via `afterEach`'s `currentUnmount` — the hook opens a real
 *  (fake) WebSocket and a real health-poll effect, both of which must be
 *  torn down before the next test or they leak across renders (FakeWebSocket
 *  has its own MAX_INSTANCES abort guard for exactly this hazard). */
function mount(host: FakeHost) {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const rendered = renderHook(() => useHarness());
  currentUnmount = rendered.unmount;
  return rendered;
}

describe("useEngineHealth", () => {
  it("boot reaches ready — the launcher succeeds, health confirms, state hydrates", async () => {
    installHealthScheduler();
    const host = createFakeHost({ hasApiKey: true, workspace: null });
    const { result } = mount(host);

    assert.equal(result.current.boot, "booting");

    await waitFor(() => assert.equal(result.current.boot, "ready"));
    assert.equal(result.current.hostOk, true);
    // GET /api/state was fetched and routed through applyState (F2's
    // hydration step), not skipped.
    assert.ok(result.current.applyStateCalls.length >= 1);
  });

  it("a health failure streak flips hostOk — one blip is silent, two consecutive is not (AC-U10)", async () => {
    const healthClock = installHealthScheduler();
    const host = createFakeHost({ hasApiKey: true, workspace: null });
    const { result } = mount(host);
    await waitFor(() => assert.equal(result.current.boot, "ready"));
    assert.equal(result.current.hostOk, true);
    // The health-poll effect installs the scheduler the instant it first
    // mounts (right when boot flips to "ready", above) — confirm the seam
    // is live before relying on it.
    await waitFor(() => assert.ok(healthClock.trigger));

    host.healthFail = true;
    await act(async () => {
      healthClock.trigger!();
      await Promise.resolve();
    });
    // 1 failed poll: AC-U10 forbids reacting yet.
    await waitFor(() => assert.equal(result.current.healthFailStreak, 1));
    assert.equal(result.current.hostOk, true);

    await act(async () => {
      healthClock.trigger!();
      await Promise.resolve();
    });
    // 2 CONSECUTIVE failed polls: now it reacts.
    await waitFor(() => assert.equal(result.current.healthFailStreak, 2));
    assert.equal(result.current.hostOk, false);

    // Recovery: the next poll succeeding clears the streak and hostOk.
    host.healthFail = false;
    await act(async () => {
      healthClock.trigger!();
      await Promise.resolve();
    });
    await waitFor(() => assert.equal(result.current.hostOk, true));
    assert.equal(result.current.healthFailStreak, 0);
  });

  it(
    "retryHost re-boots (error -> ready) and re-hydrates state",
    { timeout: 10000 },
    async () => {
      installHealthScheduler();
      // A cold engine: pollHostHealth's own 6-attempt/150ms budget inside
      // bootApp genuinely elapses (real wall-clock, matching
      // App.failure.test.tsx's own tolerance for this) before boot lands on
      // "error" — there is no faster, still-real path through bootApp's
      // actual retry budget.
      const host = createFakeHost({ hasApiKey: true, workspace: null });
      host.healthFail = true;
      const { result } = mount(host);

      await waitFor(() => assert.equal(result.current.boot, "error"), { timeout: 5000 });
      assert.equal(result.current.hostOk, false);
      const priorHydrations = result.current.applyStateCalls.length;

      host.healthFail = false;
      await act(async () => {
        await result.current.retryHost();
      });

      assert.equal(result.current.boot, "ready");
      assert.equal(result.current.hostOk, true);
      // Re-hydrates: a fresh GET /api/state was applied, not merely a
      // boot-phase flip with stale state left behind.
      assert.ok(result.current.applyStateCalls.length > priorHydrations);
    },
  );
});
