import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { useArtifactBinding } from "./useArtifactBinding";
import {
  initialRunProjection,
  reduceRunEvent,
  type RunEventEnvelope,
  type RunProjection,
  type RunSnapshot,
} from "./runReducer";
import type { ChatMessage } from "./messageBlocks";

// Same fixture idiom as runChangeList.test.ts (snap -> run_started -> reduce)
// and App.artifacts-panel.test.tsx's prose() helper for long-markdown-eligible
// text (>= artifactEligibility.ts's LONG_MARKDOWN_T, 1500 chars).
function prose(n: number, ch = "a"): string {
  return ch.repeat(n);
}

const SESSION_A = "sess-a";
const SESSION_B = "sess-b";
const RUN_ID = "run-1";
const MSG_ID = "msg-1";

function snap(sessionId: string, runId: string): RunSnapshot {
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

function terminalEvent(sessionId: string, runId: string, finalAnswer: string, seq = 2): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "run_terminal",
    sessionId,
    runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload: {
      kind: "run_terminal",
      terminalKind: "answered",
      finalAnswer,
      answerVouched: true,
      failure: null,
      terminalAt: "",
    },
  };
}

/** A RunProjection with one terminal, artifact-eligible (long-markdown) run under SESSION_A. */
function projectionWithEligibleRun(): RunProjection {
  let state = reduceRunEvent(initialRunProjection(), startedEvent(snap(SESSION_A, RUN_ID)));
  state = reduceRunEvent(state, terminalEvent(SESSION_A, RUN_ID, prose(1500, "r")));
  return state;
}

function eligibleMessage(): ChatMessage {
  return { id: MSG_ID, role: "assistant", content: prose(1500, "m") };
}

function ref<T>(value: T): RefObject<T> {
  return { current: value };
}

describe("useArtifactBinding", () => {
  it("opening a run artifact binds it", () => {
    const projection = projectionWithEligibleRun();
    const runProjectionRef = ref(projection);
    const messagesRef = ref<ChatMessage[]>([]);
    const { result } = renderHook(() =>
      useArtifactBinding({
        sessionId: SESSION_A,
        runProjection: projection,
        messages: [],
        runProjectionRef,
        messagesRef,
      }),
    );

    assert.equal(result.current.artifactOpenBinding, null);

    act(() => {
      result.current.openRunArtifact(RUN_ID);
    });

    assert.deepEqual(result.current.artifactOpenBinding, {
      conversationId: SESSION_A,
      turn: { surface: "run", id: RUN_ID },
      contentKind: "long-markdown",
    });
    assert.equal(result.current.artifactAnnounce, "Artifact opened");
    assert.equal(result.current.boundArtifact?.contentKind, "long-markdown");
  });

  it("opening a message artifact binds it", () => {
    const message = eligibleMessage();
    const emptyProjection = initialRunProjection();
    const runProjectionRef = ref(emptyProjection);
    const messagesRef = ref([message]);
    const { result } = renderHook(() =>
      useArtifactBinding({
        sessionId: SESSION_A,
        runProjection: emptyProjection,
        messages: [message],
        runProjectionRef,
        messagesRef,
      }),
    );

    assert.equal(result.current.artifactOpenBinding, null);

    act(() => {
      result.current.openMessageArtifact(MSG_ID);
    });

    assert.deepEqual(result.current.artifactOpenBinding, {
      conversationId: SESSION_A,
      turn: { surface: "message", id: MSG_ID },
      contentKind: "long-markdown",
    });
    assert.equal(result.current.artifactAnnounce, "Artifact opened");
    assert.equal(result.current.boundArtifact?.contentKind, "long-markdown");
  });

  it("a session change clears the binding", async () => {
    const projection = projectionWithEligibleRun();
    const runProjectionRef = ref(projection);
    const messagesRef = ref<ChatMessage[]>([]);
    const { result, rerender } = renderHook(
      (props: { sessionId: string }) =>
        useArtifactBinding({
          sessionId: props.sessionId,
          runProjection: projection,
          messages: [],
          runProjectionRef,
          messagesRef,
        }),
      { initialProps: { sessionId: SESSION_A } },
    );

    act(() => {
      result.current.openRunArtifact(RUN_ID);
    });
    assert.ok(result.current.artifactOpenBinding, "precondition: an artifact is bound");

    rerender({ sessionId: SESSION_B });

    await waitFor(() => {
      assert.equal(result.current.artifactOpenBinding, null);
    });
    // Switching sessions is an implicit clear — never the explicit-close announce.
    assert.notEqual(result.current.artifactAnnounce, "Artifact closed");
  });

  it("closeArtifact sets the announce string and clears the binding", () => {
    const projection = projectionWithEligibleRun();
    const runProjectionRef = ref(projection);
    const messagesRef = ref<ChatMessage[]>([]);
    const { result } = renderHook(() =>
      useArtifactBinding({
        sessionId: SESSION_A,
        runProjection: projection,
        messages: [],
        runProjectionRef,
        messagesRef,
      }),
    );

    act(() => {
      result.current.openRunArtifact(RUN_ID);
    });
    assert.ok(result.current.artifactOpenBinding, "precondition: an artifact is bound");

    act(() => {
      result.current.closeArtifact();
    });

    assert.equal(result.current.artifactOpenBinding, null);
    assert.equal(result.current.artifactAnnounce, "Artifact closed");

    // Guard in the moved code (`if (prev) setArtifactAnnounce(...)`): closing
    // again with nothing bound must not re-fire the announce.
    act(() => {
      result.current.closeArtifact();
    });
    assert.equal(result.current.artifactAnnounce, "Artifact closed");
  });
});
