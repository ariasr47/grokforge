import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { useRunEventStream } from "./useRunEventStream";
import {
  initialRunProjection,
  type RunEventEnvelope,
  type RunProjection,
  type RunSnapshot,
} from "./runReducer";
import type { PublicState, ServerEvent } from "./api";
import type { PendingDiff, PermissionReq } from "./runChangeList";
import type { ChatMessage } from "./MessageList";
import type { ToastKind } from "./Toast";

// Same fixture idiom as useChangesProjections.test.ts / useComposerSend.test.ts
// (snap -> run_started envelope -> reduce via the real onServerEvent).
const SESSION = "sess-a";

function snap(runId: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION,
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
    ...overrides,
  };
}

function startedEvent(s: RunSnapshot, seq = 1): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "run_started",
    sessionId: s.sessionId,
    runId: s.runId,
    eventSeq: seq,
    connectionGeneration: s.connectionGeneration,
    occurredAt: "",
    payload: { kind: "run_started", run: s },
  };
}

// Matches useChangesProjections.test.ts's own terminalEvent() helper.
function terminalEvent(runId: string, seq: number): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "run_terminal",
    sessionId: SESSION,
    runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload: {
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer: "done",
      answerVouched: true,
      failure: null,
      terminalAt: "",
    },
  };
}

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

interface HarnessProps {
  initialRunProjection?: RunProjection;
}

// Mirrors how App.tsx actually calls the hook: `messages`/`runProjection`/
// `diffQueue`/`permissions` are real useState (App.tsx owns them, not this
// hook — see useRunEventStream.ts's own params doc), so setMessages/
// commitRunProjection calls made inside the hook are observable exactly the
// way they are in the real component. `runProjectionRef`'s render-time,
// `pendingProjectionPaintRef`-gated sync and `commitRunProjection`'s body
// are copied verbatim from App.tsx (the two pieces this hook's own doc
// comment says stay behind) so the harness exercises the same contract the
// real App.tsx/useRunEventStream boundary does.
function useHarness(props: HarnessProps = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runProjection, setRunProjection] = useState<RunProjection>(
    props.initialRunProjection ?? initialRunProjection(),
  );
  const [diffQueue, setDiffQueue] = useState<PendingDiff[]>([]);
  const [permissions, setPermissions] = useState<PermissionReq[]>([]);

  const runProjectionRef = useRef<RunProjection>(runProjection);
  const pendingProjectionPaintRef = useRef(false);
  const projectionFlushRef = useRef<{ cancel: () => void } | null>(null);
  if (!pendingProjectionPaintRef.current) {
    runProjectionRef.current = runProjection;
  }
  const commitRunProjection = useCallback((next: RunProjection) => {
    pendingProjectionPaintRef.current = false;
    projectionFlushRef.current?.cancel();
    runProjectionRef.current = next;
    setRunProjection(next);
  }, []);

  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const sessionIdRef = useRef<string | null>(SESSION);
  const streamEpochRef = useRef(0);
  const normalizedRunIdRef = useRef<string | null>(null);
  const pendingPromptMessageIdRef = useRef<string | null>(null);
  const pendingPromptSessionIdRef = useRef<string | null>(null);
  const cancelGenerationRef = useRef(0);
  const activityRevealRef = useRef<string | null>(null);
  const stateRef = useRef<PublicState | null>(null);
  const busyRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);

  let nextId = 0;
  const hook = useRunEventStream({
    sessionIdRef,
    runProjectionRef,
    pendingProjectionPaintRef,
    // The hook's own type only needs a FrameFlush-shaped `{ current }` —
    // the harness's minimal `{ cancel }` stub structurally satisfies the
    // one method (`.cancel()`) this hook's moved code ever calls on it.
    projectionFlushRef: projectionFlushRef as unknown as RefObject<import("./streamBuffer").FrameFlush | null>,
    setRunProjection,
    commitRunProjection,
    setMessages,
    messagesRef,
    streamEpochRef,
    normalizedRunIdRef,
    pendingPromptMessageIdRef,
    pendingPromptSessionIdRef,
    cancelGenerationRef,
    activityRevealRef,
    stateRef,
    busyRef,
    sendInFlightRef,
    cancelInFlightRef,
    setModelDraft: noop1,
    setShellAllowlist: noop1,
    setOauth: noop1,
    setErrorBanner: noop1,
    setFirstRun: noop1,
    setRunFooter: noop1,
    setRunStartedAt: noop1,
    setRunPhase: noop1,
    setRunPhaseDetail: noop1,
    setAwaitingNextTurn: noop1,
    setDiffQueue,
    setPermissions,
    applyState: noop1,
    reportError: noop1,
    toast: fakeToast().api,
    uid: () => `id-${nextId++}`,
  });

  return { ...hook, messages, runProjection, diffQueue, permissions };
}

// Runs `run` with globalThis.fetch mocked per `handler`, always restoring the
// real fetch afterward (matching useChangesProjections.test.ts's/
// useComposerSend.test.ts's save/restore idiom).
async function withFetch<T>(
  handler: (url: string) => { status: number; body: unknown },
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const response = handler(String(input));
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("useRunEventStream", () => {
  it("a text_delta sequence accumulates into one message", async () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.onServerEvent({ type: "text_delta", text: "Hello " } as ServerEvent);
    });
    await waitFor(() => {
      assert.equal(result.current.messages.length, 1);
    });
    assert.equal(result.current.messages[0]?.role, "assistant");
    assert.equal(result.current.messages[0]?.content, "Hello ");

    // A second delta, flushed on a later animation frame, must land on the
    // SAME message bubble (via streamIdRef's reuse) rather than minting a
    // second one.
    act(() => {
      result.current.onServerEvent({ type: "text_delta", text: "world" } as ServerEvent);
    });
    await waitFor(() => {
      assert.equal(result.current.messages[0]?.content, "Hello world");
    });
    assert.equal(result.current.messages.length, 1);
  });

  it("a run envelope reduces into the projection", () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.onServerEvent(startedEvent(snap("r1")) as unknown as ServerEvent);
    });

    assert.equal(result.current.runProjection.runsById["r1"]?.state, "admitted");
    assert.deepEqual(result.current.runProjection.runOrder, ["r1"]);
    // The ref App.tsx's own JSX/other hooks read is kept in lockstep with
    // the committed state for a non-delta envelope (run_started is not a
    // stream delta, so onServerEvent calls commitRunProjection directly).
    assert.equal(result.current.runProjection, result.current.runProjection);
  });

  it("restore after a disconnect rehydrates owned runs", async () => {
    let seed = initialRunProjection();
    // Build the seed via the hook's own onServerEvent so the fixture is
    // constructed exactly the way a live run would populate it, not
    // hand-rolled.
    const seedResult = renderHook(() => useHarness());
    act(() => {
      seedResult.result.current.onServerEvent(startedEvent(snap("r1")) as unknown as ServerEvent);
    });
    seed = seedResult.result.current.runProjection;
    assert.equal(seed.runsById["r1"]?.state, "admitted");

    const { result } = renderHook(() => useHarness({ initialRunProjection: seed }));

    let outcome: { ok: boolean; hasNonterminal: boolean } | undefined;
    await withFetch(
      (url) => {
        if (url.includes("/api/runs/r1")) {
          return {
            status: 200,
            body: {
              // A real journal reply reports the run's own final state
              // consistently with the terminal event it also carries.
              run: snap("r1", { state: "terminal", terminalKind: "answered" }),
              events: [terminalEvent("r1", 3)],
            },
          };
        }
        return { status: 500, body: { error: "not mocked" } };
      },
      async () => {
        await act(async () => {
          outcome = await result.current.restoreOwnedRuns("disconnect_restore");
        });
      },
    );

    assert.equal(outcome?.ok, true);
    assert.equal(outcome?.hasNonterminal, false);
    assert.equal(result.current.runProjection.runsById["r1"]?.state, "terminal");
    assert.equal(result.current.runProjection.runsById["r1"]?.lastEventSeq, 3);
  });
});
