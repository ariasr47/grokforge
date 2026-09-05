// Task 3 (refactor/shell-structure) — `activeHome` in App.tsx currently reads
// `const activeHome = sessionId ? loadSession(sessionPartition, sessionId) : null;`
// as a bare statement in the render body, so it re-runs on every render of
// `App()` regardless of whether the active session actually changed.
// `loadSession` -> `withHomeDefaults` (sessions.ts) unconditionally spreads a
// fresh object every call, so `activeHome` gets a new identity every render
// even when nothing about the active session changed. See task-3-brief.md.
//
// Technique note — the brief's two suggested spy techniques for Step 1 were
// tried first and both dead-end in this codebase (verified empirically
// before writing this file):
//   - "Spy by wrapping the module import": `apps/shell` is real ESM
//     (`"type": "module"`, `"module": "ESNext"`). A named import like
//     `loadSession` is a live binding into `sessions.ts`'s own module
//     environment; from outside that module, both a direct
//     `namespaceObject.loadSession = fn` reassignment and `node:test`'s
//     `mock.method(namespaceObject, "loadSession", fn)` throw ("Cannot
//     assign to property … of [object Module]" / "Cannot redefine
//     property") because module namespace exports are non-configurable.
//     `mock.module` (which sidesteps this by intercepting resolution
//     instead of the namespace object) is not a function in this Node
//     build.
//   - "count reads via a fake localStorage": doesn't discriminate here.
//     `sessions.ts`'s own `loadStore()` caches the parsed store in a
//     module-level `memory` variable and only calls
//     `readDisk()`/`localStorage.getItem` once until something explicitly
//     invalidates it — so the read count is 1 whether or not `activeHome`
//     is memoized; it can't tell RED from GREEN.
//
// Instead this counts calls to `Array.prototype.find` that run over an
// array whose first element is session-shaped (has both `id` and
// `workspace`) and carries our fixture session's id. That signature is
// unique to `loadSession`'s own lookup —
// `(loadStore().byWorkspace[workspace] ?? []).find((s) => s.id === id)`
// (sessions.ts:396) — matched by id rather than by object reference because
// a real, unrelated App effect ("Reflect agent busy on active session",
// App.tsx ~3038) legitimately replaces the stored session object with a new
// one (same id) the first time `sessionId` becomes non-null, via
// `updateSessionMeta`'s `list[idx] = {...list[idx], ...patch}` — reference
// tracking breaks right there even though nothing is wrong. Every other
// `.find()` over session data in this codebase (`sessionList` state,
// `listSessions(...)` results, both used by the sidebar) is first passed
// through `withHomeDefaults`, which unconditionally spreads a **new**
// object — same id, different reference — so id-matching still can't
// confuse those with `loadSession`'s own lookup *unless* one of them also
// runs on every unrelated render. It doesn't: `sessionList.find` (App.tsx
// ~3087) only runs from an effect gated on live "needs you" transitions
// (no run/decision exists in these tests), and `listSessions(...).find`
// (App.tsx's `exportCurrentChat`) only runs when that callback is invoked
// by a click, never from typing. The patch always delegates to the real
// `find` — it only counts, never changes behavior — and is restored after
// the file runs.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { partitionKey, reloadSessionsFromDisk } from "./sessions";
import type { ChatSession } from "./sessions";
import { HOME_NAME_PLACEHOLDER } from "./chatPackComposer";
import { setHealthPollTestScheduler } from "./healthPollTestClock";

const CHAT_ROOT = "C:\\Users\\qa\\.grokforge\\chat-sandbox";
const CHAT_PART = partitionKey("chat", CHAT_ROOT);
const SESSION_ID = "session-alpha";
const TITLE = "Test Session Alpha";
const TITLE_RENAMED = "Test Session Alpha Renamed";

function isSessionShapedArrayFor(value: unknown, id: string): value is Array<{ id: unknown }> {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0] as { id?: unknown; workspace?: unknown } | null;
  if (!first || typeof first !== "object" || !("workspace" in first) || !("id" in first)) {
    return false;
  }
  return value.some((item) => (item as { id?: unknown })?.id === id);
}

type LooseFind = (...args: unknown[]) => unknown;
const arrayProto = Array.prototype as unknown as { find: LooseFind };
let originalFind: LooseFind;
let watchedId: string | null = null;
let findCallsOverWatched = 0;

before(() => {
  originalFind = arrayProto.find;
  arrayProto.find = function patchedFind(this: unknown, ...args: unknown[]): unknown {
    try {
      if (watchedId !== null && isSessionShapedArrayFor(this, watchedId)) {
        findCallsOverWatched++;
      }
    } catch {
      // Instrumentation must never affect real behavior.
    }
    return originalFind.apply(this, args);
  };
});

after(() => {
  arrayProto.find = originalFind;
});

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  setHealthPollTestScheduler(null);
});

function seedSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: SESSION_ID,
    workspace: CHAT_PART,
    title: TITLE,
    committedName: true,
    packMembers: { files: [], note: null },
    messages: [],
    updatedAt: Date.now(),
    status: "live",
    subagents: [],
    open: true,
    ...overrides,
  };
}

function resetBrowserState(session: ChatSession): void {
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
  reloadSessionsFromDisk({
    byWorkspace: { [CHAT_PART]: [session] },
    activeId: { [CHAT_PART]: session.id },
    pinned: [CHAT_PART],
    expanded: [CHAT_PART],
  });
  FakeWebSocket.reset();
}

beforeEach(() => {
  findCallsOverWatched = 0;
  watchedId = null;
  setHealthPollTestScheduler(() => () => undefined);
});

afterEach(() => {
  cleanup();
  watchedId = null;
  setHealthPollTestScheduler(null);
});

// The ChatHomeName trigger's own visible text duplicates the active
// session's title, and so, separately, does the sidebar's session-list
// entry. Scope every query to ChatHomeName's own container
// (`[data-chat-home]`, present in every one of its states) so this file
// never has to reason about whether the two collide.
function homeNameRegion(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-chat-home]");
  assert.ok(el, "ChatHomeName region not found");
  return el!;
}

async function mountApp(session: ChatSession): Promise<void> {
  resetBrowserState(session);
  watchedId = session.id;
  const host = createFakeHost({
    mode: "chat",
    workspace: null,
    busy: false,
    chatRoot: CHAT_ROOT,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByLabelText("Message to agent");
  await waitFor(() =>
    assert.ok(within(homeNameRegion()).getByRole("button", { name: TITLE })),
  );
}

test("activeHome: loadSession's lookup does not re-run on renders unrelated to the session", async () => {
  const session = seedSession();
  await mountApp(session);

  const countAfterMount = findCallsOverWatched;
  assert.ok(countAfterMount >= 1, "sanity: the active session's lookup ran at least once by mount");

  // Several re-renders unrelated to session identity: each keystroke only
  // changes App's `draft` state, never sessionPartition/sessionId/sessionList.
  const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
  const user = userEvent.setup();
  await user.type(composer, "hello there");
  assert.equal(composer.value, "hello there");

  // Behavioral: the title is still correct after those renders.
  assert.ok(within(homeNameRegion()).getByRole("button", { name: TITLE }));
  // Count-based: no additional lookups were spent getting there. Before the
  // Step 3 useMemo this grows by one per keystroke (11 extra calls here).
  assert.equal(
    findCallsOverWatched,
    countAfterMount,
    `expected no extra loadSession lookups from typing alone (baseline ${countAfterMount}, now ${findCallsOverWatched})`,
  );
});

test("activeHome: a rename (a sessionList change) still refreshes the title", async () => {
  const session = seedSession();
  await mountApp(session);

  const user = userEvent.setup();
  await user.click(within(homeNameRegion()).getByRole("button", { name: TITLE }));
  const input = within(homeNameRegion()).getByLabelText(HOME_NAME_PLACEHOLDER);
  await user.clear(input);
  await user.type(input, TITLE_RENAMED);
  await user.click(within(homeNameRegion()).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    assert.ok(within(homeNameRegion()).getByRole("button", { name: TITLE_RENAMED })),
  );
  assert.equal(
    within(homeNameRegion()).queryByRole("button", { name: TITLE }) === null,
    true,
  );
});
