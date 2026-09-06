import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import { useComposerSend } from "./useComposerSend";
import { endPageSend } from "../composer/composerSend";
import { initialRunProjection, type ActivityRecord, type RunProjection, type RunProjectionRun, type RunSnapshot } from "../projections/runReducer";
import type { EffortLevel, PublicState } from "../lib/api";
import type { PendingDiff, PermissionReq } from "../projections/runChangeList";
import type { SkillsPaletteProjection } from "../projections/skillsCatalogComposer";
import type { PendingPlanDecision } from "./useDecisions";
import type { ToastKind } from "../thread/Toast";

// composerSend.ts's beginPageSend/endPageSend guard a module-level latch
// ("survives App remount; render cannot clobber it") that only clears once
// a run reaches terminal — these fixtures deliberately never do (to keep
// the mocked api.runState replay a simple, silently-caught failure), so
// without this reset a send admitted in one test would leave the next
// test's admission refused. Matches composerSend.test.ts's own
// `afterEach(() => endPageSend())`.
afterEach(() => endPageSend());

// Same fixture idiom as useChangesProjections.test.ts / useDecisions.test.ts.
const SESSION_A = "session-a";
const SESSION_B = "session-b";

function snap(runId: string, sessionId = SESSION_A): RunSnapshot {
  return {
    sessionId,
    runId,
    connectionGeneration: 1,
    state: "admitted",
    acceptedPrompt: "prompt",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 0,
    policy: {},
    model: {},
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
  };
}

// A minimal PublicState — only the fields sendText's own gates read
// (hasApiKey / permissionPolicy.status / mode / workspace / planEngagement).
// Matches useDecisions.test.ts's own "cast a partial shape" idiom for this
// same type (its `{ workspace: WORKSPACE } as unknown as PublicState`).
const READY_STATE = {
  hasApiKey: true,
  permissionPolicy: { status: "confirmed" },
  mode: "chat",
} as unknown as PublicState;

function noop(): void {}
function noop1(): void {}

function fakeToast() {
  const calls: Array<{ message: string; kind?: ToastKind }> = [];
  return {
    calls,
    api: {
      push: (message: string, kind?: ToastKind) => {
        calls.push({ message, kind });
      },
      dismiss: (_id: string) => {},
    },
  };
}

type ToastLike = ReturnType<typeof fakeToast>["api"];

interface HarnessProps {
  sessionId: string | null;
  busy: boolean;
  connected?: boolean;
  codePreAcquireOk?: boolean;
  oauth?: { user_code: string; verification_uri: string } | null;
  initialPermissions?: PermissionReq[];
  initialDiffQueue?: PendingDiff[];
  pendingPlanDecision?: PendingPlanDecision | null;
  state?: PublicState | null;
  runProjection?: RunProjection;
  reportError?: (message: string, meta?: Record<string, unknown>) => void;
  toast?: ToastLike;
  initialDraft?: string;
}

// Mirrors how App.tsx actually calls the hook: draft/permissions/diffQueue
// are real useState (so setDraft("")/setPermissions/setDiffQueue calls made
// inside sendText are observable), matching useSkillsPalette.test.ts's
// draft-as-real-state idiom and useChangesProjections.test.ts's diffQueue
// one. Refs are real useRef calls (stable across rerenders, exactly like
// App.tsx's own — a plain object recreated every render, as
// useChangesProjections.test.ts's `ref()` helper does for read-only refs,
// would lose sendText's own busyRef/sendInFlightRef mutations between
// renders).
function useHarness(props: HarnessProps) {
  const [draft, setDraft] = useState(props.initialDraft ?? "");
  const [permissions, setPermissions] = useState<PermissionReq[]>(props.initialPermissions ?? []);
  const [diffQueue, setDiffQueue] = useState<PendingDiff[]>(props.initialDiffQueue ?? []);
  const [armedSkillName, setArmedSkillName] = useState<string | null>(null);

  const busyRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const messagesRef = useRef<Array<{ id: string; role: string; content: string }>>([]);
  const pendingPromptMessageIdRef = useRef<string | null>(null);
  const pendingPromptSessionIdRef = useRef<string | null>(null);
  const streamEpochRef = useRef(0);
  const cancelGenerationRef = useRef(0);
  const normalizedRunIdRef = useRef<string | null>(null);
  const applyRailEvidenceRef = useRef((_run: RunProjectionRun) => {});
  const paintEnvelopeActivityRef = useRef((_activity: ActivityRecord, _runId?: string | null) => {});
  const runProjectionRef = useRef<RunProjection>(props.runProjection ?? initialRunProjection());
  runProjectionRef.current = props.runProjection ?? initialRunProjection();

  const hook = useComposerSend({
    draft,
    setDraft,
    sessionId: props.sessionId,
    busy: props.busy,
    connected: props.connected ?? true,
    codePreAcquireOk: props.codePreAcquireOk ?? false,
    codeHardFail: false,
    vendorCode: false,
    permissions,
    setPermissions,
    diffQueue,
    setDiffQueue,
    oauth: props.oauth ?? null,
    pendingPlanDecision: props.pendingPlanDecision ?? null,
    state: props.state ?? READY_STATE,
    effortLevel: "auto" as EffortLevel,
    skillsPalette: { state: "absent" } as SkillsPaletteProjection,
    armedSkillName,
    setArmedSkillName,
    runProjection: props.runProjection ?? initialRunProjection(),
    runProjectionRef,
    busyRef,
    sendInFlightRef,
    cancelInFlightRef,
    // sendText's own type only needs a ChatMessage[]-shaped ref; the
    // harness's minimal message shape structurally satisfies it.
    messagesRef: messagesRef as unknown as RefObject<import("../surfaces/MessageList").ChatMessage[]>,
    pendingPromptMessageIdRef,
    pendingPromptSessionIdRef,
    streamEpochRef,
    cancelGenerationRef,
    normalizedRunIdRef,
    applyRailEvidenceRef,
    paintEnvelopeActivityRef,
    beginStreamRun: noop,
    bindNormalizedRun: noop1,
    commitRunProjection: noop1,
    reportError: props.reportError ?? noop1,
    toast: props.toast ?? fakeToast().api,
    uid: () => "generated-id",
    setHistIdx: noop1,
    setAtSuggestions: noop1,
    setHistory: noop1,
    setErrorBanner: noop1,
    setRecovery: noop1,
    setAwaitingNextTurn: noop1,
    setRunPhase: noop1,
    setRunPhaseDetail: noop1,
    setRunStartedAt: noop1,
    setRunFooter: noop1,
    setMessages: noop1,
    setFirstRun: noop1,
  });

  return { ...hook, permissions, diffQueue };
}

// Runs `run` with globalThis.fetch mocked per `handler`, always restoring the
// real fetch afterward (matching useChangesProjections.test.ts's save/restore
// idiom). `run` is responsible for its own `act(...)` wrapping and for
// capturing any return value it needs (e.g. `sendText`'s own boolean) into
// an outer `let` — `act()` itself does not forward a callback's return value.
async function withFetch<T>(
  handler: (url: string, body: unknown) => { status: number; body: unknown },
  run: () => Promise<T>,
): Promise<{ result: T; calls: Array<{ url: string; body: unknown }> }> {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const response = handler(url, body);
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as typeof fetch;
  try {
    const result = await run();
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("useComposerSend", () => {
  it("an idle, connected send is admitted and POSTs the composer's text", async () => {
    const { result } = renderHook(() => useHarness({ sessionId: SESSION_A, busy: false, initialDraft: "hello grok" }));

    const { result: sent, calls } = await withFetch(
      (url) => {
        if (url.endsWith("/api/prompt")) {
          return { status: 200, body: { accepted: true, run: snap("run-1") } };
        }
        return { status: 500, body: { error: "not mocked" } };
      },
      async () => {
        let sent: boolean | undefined;
        await act(async () => {
          sent = await result.current.sendText("hello grok");
        });
        return sent;
      },
    );

    assert.equal(sent, true);
    const promptCalls = calls.filter((c) => c.url.endsWith("/api/prompt"));
    assert.equal(promptCalls.length, 1);
    const body = promptCalls[0]!.body as Record<string, unknown>;
    assert.equal(body.sessionId, SESSION_A);
    assert.equal(body.conversationId, SESSION_A);
    assert.equal(body.text, "hello grok");
    assert.equal(body.effort, "auto");
    assert.equal(body.skillHandoff, null);
  });

  it("refuses (and never POSTs) while a decision gate is pending", async () => {
    const { result } = renderHook(() =>
      useHarness({
        sessionId: SESSION_A,
        busy: false,
        initialDraft: "hello",
        oauth: { user_code: "123", verification_uri: "https://x.grok.com" },
      }),
    );

    const { result: sent, calls } = await withFetch(
      () => ({ status: 200, body: { accepted: true, run: snap("run-1") } }),
      async () => {
        let sent: boolean | undefined;
        await act(async () => {
          sent = await result.current.sendText("hello");
        });
        return sent;
      },
    );

    assert.equal(sent, false, "oauth pending must refuse admission");
    assert.equal(calls.filter((c) => c.url.endsWith("/api/prompt")).length, 0);
  });

  it("queueCurrentDraft holds the draft against the current session only while busy with real text", () => {
    const { result, rerender } = renderHook<ReturnType<typeof useHarness>, HarnessProps>(
      (props) => useHarness(props),
      { initialProps: { sessionId: SESSION_A, busy: false, initialDraft: "not yet" } },
    );

    // Not busy -> queueAdmitted refuses; nothing held.
    act(() => result.current.queueCurrentDraft());
    assert.equal(result.current.queuedDraft, null);

    // Now busy, with real text -> admitted, bound to the current session,
    // and the draft is cleared the same way a live send clears it.
    // `setDraft` (not a fresh `initialProps.initialDraft`) is how this
    // changes `draft`'s value — useState's initializer argument is only
    // consulted on mount, never on a later rerender.
    act(() => result.current.setDraft("hold this"));
    rerender({ sessionId: SESSION_A, busy: true, initialDraft: "not yet" });
    act(() => result.current.queueCurrentDraft());
    assert.deepEqual(result.current.queuedDraft, { sessionId: SESSION_A, text: "hold this" });
  });

  it("cancelQueuedDraft clears the held draft unconditionally", () => {
    const { result } = renderHook<ReturnType<typeof useHarness>, HarnessProps>(
      (props) => useHarness(props),
      { initialProps: { sessionId: SESSION_A, busy: true, initialDraft: "hold this" } },
    );
    act(() => result.current.queueCurrentDraft());
    assert.notEqual(result.current.queuedDraft, null);

    act(() => result.current.cancelQueuedDraft());
    assert.equal(result.current.queuedDraft, null);
  });

  it("a queued draft bound to session A does not flush while session B is selected", async () => {
    const { result, rerender } = renderHook<ReturnType<typeof useHarness>, HarnessProps>(
      (props) => useHarness(props),
      { initialProps: { sessionId: SESSION_A, busy: true, initialDraft: "for A only" } },
    );
    act(() => result.current.queueCurrentDraft());
    assert.deepEqual(result.current.queuedDraft, { sessionId: SESSION_A, text: "for A only" });

    const { calls } = await withFetch(
      () => ({ status: 200, body: { accepted: true, run: snap("run-1") } }),
      async () => {
        // Switch to B, idle — shouldFlushQueue must refuse (wrong session).
        rerender({ sessionId: SESSION_B, busy: false });
        // Give the effect a genuine chance to run before asserting nothing fired.
        await act(async () => new Promise((r) => setTimeout(r, 20)));
      },
    );

    assert.equal(calls.filter((c) => c.url.endsWith("/api/prompt")).length, 0, "A's draft must never fire while B is selected");
    assert.deepEqual(result.current.queuedDraft, { sessionId: SESSION_A, text: "for A only" }, "must stay held, not dropped");
  });

  it("a queued draft flushes once its own session is idle and selected, then clears", async () => {
    const { result, rerender } = renderHook<ReturnType<typeof useHarness>, HarnessProps>(
      (props) => useHarness(props),
      { initialProps: { sessionId: SESSION_A, busy: true, initialDraft: "for A" } },
    );
    act(() => result.current.queueCurrentDraft());

    const { calls } = await withFetch(
      (url) => {
        if (url.endsWith("/api/prompt")) return { status: 200, body: { accepted: true, run: snap("run-1") } };
        return { status: 500, body: { error: "not mocked" } };
      },
      async () => {
        rerender({ sessionId: SESSION_A, busy: false });
        await waitFor(() => assert.equal(result.current.queuedDraft, null));
      },
    );

    const promptCalls = calls.filter((c) => c.url.endsWith("/api/prompt"));
    assert.equal(promptCalls.length, 1);
    assert.equal((promptCalls[0]!.body as Record<string, unknown>).text, "for A");
    assert.equal((promptCalls[0]!.body as Record<string, unknown>).sessionId, SESSION_A);
  });

  it("a queued draft survives a guard bail-out (engine unreachable) instead of being dropped", async () => {
    const { result, rerender } = renderHook<ReturnType<typeof useHarness>, HarnessProps>(
      (props) => useHarness(props),
      { initialProps: { sessionId: SESSION_A, busy: true, initialDraft: "offline follow-up" } },
    );
    act(() => result.current.queueCurrentDraft());
    assert.deepEqual(result.current.queuedDraft, { sessionId: SESSION_A, text: "offline follow-up" });

    const { calls } = await withFetch(
      () => ({ status: 200, body: { accepted: true, run: snap("run-1") } }),
      async () => {
        // Idle and back on its own session, but the engine is unreachable
        // (connected: false, no pre-acquire override) — sendText's own
        // guard must refuse, and the flush effect must not clear the slot.
        rerender({ sessionId: SESSION_A, busy: false, connected: false });
        await act(async () => new Promise((r) => setTimeout(r, 20)));
      },
    );

    assert.equal(calls.filter((c) => c.url.endsWith("/api/prompt")).length, 0, "must not fire while disconnected");
    assert.deepEqual(
      result.current.queuedDraft,
      { sessionId: SESSION_A, text: "offline follow-up" },
      "the queued draft must remain surfaced as waiting, not silently dropped",
    );
  });

  it("send() forwards the current draft to sendText", async () => {
    const { result } = renderHook(() => useHarness({ sessionId: SESSION_A, busy: false, initialDraft: "via send()" }));

    const { calls } = await withFetch(
      () => ({ status: 200, body: { accepted: true, run: snap("run-1") } }),
      () => act(async () => result.current.send()),
    );

    const promptCalls = calls.filter((c) => c.url.endsWith("/api/prompt"));
    assert.equal(promptCalls.length, 1);
    assert.equal((promptCalls[0]!.body as Record<string, unknown>).text, "via send()");
  });

  it("onReviewSendToGrok forwards its text to sendText", async () => {
    const { result } = renderHook(() => useHarness({ sessionId: SESSION_A, busy: false }));

    const { calls } = await withFetch(
      () => ({ status: 200, body: { accepted: true, run: snap("run-1") } }),
      () => act(async () => result.current.onReviewSendToGrok("from the review surface")),
    );

    const promptCalls = calls.filter((c) => c.url.endsWith("/api/prompt"));
    assert.equal(promptCalls.length, 1);
    assert.equal((promptCalls[0]!.body as Record<string, unknown>).text, "from the review surface");
  });
});
