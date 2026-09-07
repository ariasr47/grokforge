// `assert.equal(screen.queryByRole(...), null)` is this suite's house idiom for
// "that node is gone" — ~580 call sites. It must fail READABLY when it fails.
//
// node:assert builds its failure message with
// `util.inspect(value, { depth: 1000, getters: true, customInspect: false })`,
// and React attaches the whole fiber tree to every mounted DOM node as
// enumerable `__reactFiber$*` / `__reactProps$*` own properties. Inspecting a
// single rendered element therefore walks the entire component tree, every
// hook's state and every prop — for the App tree that allocated past the RSS
// watchdog and the process was taskkilled with no output, no stack and no
// assertion text. `customInspect: false` means a `util.inspect.custom` hook on
// jsdom's Node prototype cannot help; testEnv.ts guards the assert entry
// points instead.
//
// Sibling guards in testEnv.ts: DEBUG_PRINT_LIMIT and RTL's getElementError.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./app/App";
import { createFakeHost, FakeWebSocket } from "./app/testFakeHost";
import { reloadSessionsFromDisk } from "./lib/sessions";

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

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
});

/** A real mounted element off the App tree — carries React's fiber back-pointer. */
async function mountedElement(): Promise<HTMLElement> {
  const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  return screen.findByLabelText("Message to agent");
}

function failureOf(run: () => void): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the assertion to fail, but it passed");
}

describe("testEnv — a failing assertion on a mounted DOM node stays readable", () => {
  it("reports compactly and fast instead of walking the React fiber tree", async () => {
    const composer = await mountedElement();

    const startedAt = Date.now();
    const error = failureOf(() => assert.equal(composer, null));
    const elapsedMs = Date.now() - startedAt;

    // Pre-guard this never returned at all: it allocated until the RSS
    // watchdog taskkilled the process (~7-10s, ~1.5GB, exit 1, no output).
    assert.ok(elapsedMs < 2_000, `assertion failure took ${elapsedMs}ms to build`);
    assert.ok(
      error.message.length < 1_000,
      `failure message was ${error.message.length} chars; expected a compact node summary`,
    );
    // Still says which node it was — a compact summary, not an opaque token.
    assert.ok(
      error.message.includes("<textarea"),
      `expected the tag name in the message, got: ${error.message.slice(0, 200)}`,
    );
    assert.ok(
      error.message.includes("Message to agent"),
      `expected the accessible name in the message, got: ${error.message.slice(0, 200)}`,
    );
    // No fiber internals leaked into the message.
    assert.ok(
      !error.message.includes("__reactFiber"),
      "the React fiber back-pointer must not be inspected",
    );
  });

  it("keeps identity semantics for passing assertions", async () => {
    const composer = await mountedElement();
    const other = screen.getByRole("button", { name: "Send" });

    // Same node compares equal; different nodes do not.
    assert.equal(composer, composer);
    assert.notEqual(composer, other);
    assert.notEqual(composer, null);

    const error = failureOf(() => assert.notEqual(composer, composer));
    assert.ok(error.message.length < 1_000, "notEqual failures stay compact too");
  });

  it("leaves non-DOM assertion messages untouched", () => {
    const error = failureOf(() => assert.equal(1, 2));
    assert.ok(error.message.includes("1"), error.message);
    assert.ok(error.message.includes("2"), error.message);
    const objError = failureOf(() => assert.deepEqual({ a: 1 }, { a: 2 }));
    assert.ok(objError.message.includes("a"), objError.message);
  });
});
