import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { RefObject } from "react";
import { useChangesProjections } from "./useChangesProjections";
import {
  initialRunProjection,
  reduceRunEvent,
  type ActivityRecord,
  type RunEventEnvelope,
  type RunProjection,
  type RunSnapshot,
} from "../projections/runReducer";
import type { PendingDiff } from "../projections/runChangeList";
import type { ProductMode } from "../lib/api";
import type { ToastKind } from "../thread/Toast";

// Same fixture idiom as runChangeList.test.ts / useArtifactBinding.test.ts
// (snap -> run_started -> reduce; activity() with per-field overrides).
const SESSION = "sess-a";

function snap(runId: string): RunSnapshot {
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

function activityEvent(runId: string, activityRecord: ActivityRecord, seq: number): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "activity_update",
    sessionId: SESSION,
    runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload: { kind: "activity_update", activity: activityRecord },
  };
}

// Matches runChangeList.test.ts's activity() helper defaults exactly.
function activity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a1",
    invocationId: "i1",
    name: "write_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: "--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+hi",
    path: "x.ts",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e1",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

// A file-change member: keeps activity()'s default editId/diff/path shape,
// just tagged uniquely per run so the two runs' members are distinguishable.
function fileActivity(tag: string): ActivityRecord {
  return activity({
    activityId: `file-${tag}`,
    invocationId: `file-${tag}`,
    path: `${tag}.txt`,
    editId: `edit-${tag}`,
    diff: `--- a/${tag}.txt\n+++ b/${tag}.txt\n+hi`,
  });
}

// A verify-command member (isVerifyCommand("npm test") === true): nulled
// editId/diff/path so it does not also qualify as a file-change member.
function verifyActivity(tag: string): ActivityRecord {
  return activity({
    activityId: `verify-${tag}`,
    invocationId: `verify-${tag}`,
    command: "npm test",
    path: null,
    diff: null,
    editId: null,
    automaticEligibility: "not_eligible",
    autoApplied: false,
    recovery: null,
  });
}

// A git-review member — same "not a file change" nulling as verifyActivity.
function gitActivity(tag: string): ActivityRecord {
  return activity({
    activityId: `git-${tag}`,
    invocationId: `git-${tag}`,
    command: "git status",
    path: null,
    diff: null,
    editId: null,
    automaticEligibility: "not_eligible",
    autoApplied: false,
    recovery: null,
  });
}

function ref<T>(value: T): RefObject<T> {
  return { current: value };
}

function noop(): void {}

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

// Mirrors how App.tsx actually calls the hook: diffQueue is real useState (so
// acceptDiff/rejectDiff's setDiffQueue(...) calls are observable), matching
// useSkillsPalette.test.ts's useHarness idiom (draft as real useState there).
function useHarness(props: {
  runProjection: RunProjection;
  runProjectionRef: RefObject<RunProjection>;
  productMode: ProductMode;
  sessionId: string | null;
  initialDiffQueue: PendingDiff[];
  changesOpen: boolean;
  view: "chat" | "settings" | "review";
  onError: (message: string) => void;
  toast: ToastLike;
}) {
  const [diffQueue, setDiffQueue] = useState(props.initialDiffQueue);
  const hook = useChangesProjections({
    runProjection: props.runProjection,
    runProjectionRef: props.runProjectionRef,
    catchUpByRunId: {},
    productMode: props.productMode,
    sessionId: props.sessionId,
    diffQueue,
    setDiffQueue,
    changesOpen: props.changesOpen,
    view: props.view,
    onError: props.onError,
    toast: props.toast,
  });
  return { ...hook, diffQueue, setDiffQueue };
}

describe("useChangesProjections", () => {
  it("the three dock projections (and their activity maps) flatten across runs", () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap("r1")));
    state = reduceRunEvent(state, activityEvent("r1", fileActivity("r1"), 2));
    state = reduceRunEvent(state, activityEvent("r1", verifyActivity("r1"), 3));
    state = reduceRunEvent(state, activityEvent("r1", gitActivity("r1"), 4));
    state = reduceRunEvent(state, startedEvent(snap("r2")));
    state = reduceRunEvent(state, activityEvent("r2", fileActivity("r2"), 2));
    state = reduceRunEvent(state, activityEvent("r2", verifyActivity("r2"), 3));
    state = reduceRunEvent(state, activityEvent("r2", gitActivity("r2"), 4));

    const { result } = renderHook(() =>
      useHarness({
        runProjection: state,
        runProjectionRef: ref(state),
        productMode: "code",
        sessionId: SESSION,
        initialDiffQueue: [],
        changesOpen: false,
        view: "chat",
        onError: noop,
        toast: fakeToast().api,
      }),
    );

    const { changesDockFiles, changesDockVerify, changesDockGit } = result.current;
    assert.equal(changesDockFiles.state, "ready");
    assert.equal(changesDockVerify.state, "ready");
    assert.equal(changesDockGit.state, "ready");
    if (changesDockFiles.state !== "ready" || changesDockVerify.state !== "ready" || changesDockGit.state !== "ready") {
      return;
    }
    // Files carry a runId tag per member (App.tsx's own aggregation adds
    // it) — both runs' single file each show up, not just one.
    assert.deepEqual(
      changesDockFiles.members.map((m) => m.runId).sort(),
      ["r1", "r2"],
    );
    assert.deepEqual(
      changesDockFiles.members.map((m) => m.path).sort(),
      ["r1.txt", "r2.txt"],
    );
    // Verify/git aggregate without a runId tag (matching the pre-move
    // source exactly) — both runs' one member each are still both present.
    assert.equal(changesDockVerify.members.length, 2);
    assert.equal(changesDockGit.members.length, 2);

    // The three activity maps (status/lifecycle/output) flatten the same
    // way: 2 runs x 3 activities = 6 entries, not 3.
    assert.equal(result.current.changesActivityStatusById.size, 6);
    assert.equal(result.current.changesActivityLifecycleById.size, 6);
    assert.equal(result.current.changesActivityOutputById.size, 6);
  });

  it("follow-up run on the same path keeps one Changes row (latest wins) — G2", () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap("r1")));
    state = reduceRunEvent(state, activityEvent("r1", fileActivity("keep"), 2));
    state = reduceRunEvent(state, activityEvent("r1", fileActivity("shared"), 3));
    state = reduceRunEvent(state, startedEvent(snap("r2")));
    state = reduceRunEvent(
      state,
      activityEvent(
        "r2",
        activity({
          activityId: "file-shared-2",
          invocationId: "file-shared-2",
          path: "shared.txt",
          editId: "edit-shared-2",
          diff: "--- a/shared.txt\n+++ b/shared.txt\n+later",
        }),
        2,
      ),
    );

    const { result } = renderHook(() =>
      useHarness({
        runProjection: state,
        runProjectionRef: ref(state),
        productMode: "code",
        sessionId: SESSION,
        initialDiffQueue: [],
        changesOpen: false,
        view: "chat",
        onError: noop,
        toast: fakeToast().api,
      }),
    );

    const { changesDockFiles } = result.current;
    assert.equal(changesDockFiles.state, "ready");
    if (changesDockFiles.state !== "ready") return;
    assert.deepEqual(
      changesDockFiles.members.map((m) => m.path),
      ["keep.txt", "shared.txt"],
    );
    const shared = changesDockFiles.members.find((m) => m.path === "shared.txt");
    assert.equal(shared?.runId, "r2");
    assert.match(shared?.diff ?? "", /later/);
  });

  it("same path with mixed slashes still collapses to one Changes row", () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap("r1")));
    state = reduceRunEvent(
      state,
      activityEvent(
        "r1",
        activity({
          activityId: "a-slash",
          invocationId: "a-slash",
          path: "docs/dogfood/acp-code/g1-fold/tokenize.js",
          editId: "e-slash-1",
          diff: "+first",
        }),
        2,
      ),
    );
    state = reduceRunEvent(state, startedEvent(snap("r2")));
    state = reduceRunEvent(
      state,
      activityEvent(
        "r2",
        activity({
          activityId: "b-slash",
          invocationId: "b-slash",
          path: "docs\\dogfood\\acp-code\\g1-fold\\tokenize.js",
          editId: "e-slash-2",
          diff: "+second",
        }),
        2,
      ),
    );

    const { result } = renderHook(() =>
      useHarness({
        runProjection: state,
        runProjectionRef: ref(state),
        productMode: "code",
        sessionId: SESSION,
        initialDiffQueue: [],
        changesOpen: false,
        view: "chat",
        onError: noop,
        toast: fakeToast().api,
      }),
    );

    const { changesDockFiles } = result.current;
    assert.equal(changesDockFiles.state, "ready");
    if (changesDockFiles.state !== "ready") return;
    assert.equal(changesDockFiles.members.length, 1);
    assert.match(changesDockFiles.members[0].diff ?? "", /second/);
    assert.equal(changesDockFiles.members[0].runId, "r2");
  });

  it("runLive is true while any run is still live, false once every run is terminal", () => {
    let state = initialRunProjection();
    state = reduceRunEvent(state, startedEvent(snap("r1")));
    state = reduceRunEvent(state, activityEvent("r1", verifyActivity("r1"), 2));
    state = reduceRunEvent(state, terminalEvent("r1", 3));
    state = reduceRunEvent(state, startedEvent(snap("r2")));
    state = reduceRunEvent(state, activityEvent("r2", verifyActivity("r2"), 2));
    // r2 stays open — no run_terminal event.

    const { result, rerender } = renderHook(
      (props: { projection: RunProjection }) =>
        useHarness({
          runProjection: props.projection,
          runProjectionRef: ref(props.projection),
          productMode: "code",
          sessionId: SESSION,
          initialDiffQueue: [],
          changesOpen: false,
          view: "chat",
          onError: noop,
          toast: fakeToast().api,
        }),
      { initialProps: { projection: state } },
    );

    assert.equal(result.current.changesDockVerify.state, "ready");
    if (result.current.changesDockVerify.state === "ready") {
      assert.equal(result.current.changesDockVerify.runLive, true, "r2 is still open");
    }

    const settled = reduceRunEvent(state, terminalEvent("r2", 3));
    rerender({ projection: settled });

    assert.equal(result.current.changesDockVerify.state, "ready");
    if (result.current.changesDockVerify.state === "ready") {
      assert.equal(result.current.changesDockVerify.runLive, false, "both runs are now terminal");
    }
  });

  it("accept and reject both route through settleOwnedDiff to the same api call shape", async () => {
    const emptyProjection = initialRunProjection();
    const toast = fakeToast();
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() =>
        useHarness({
          runProjection: emptyProjection,
          runProjectionRef: ref(emptyProjection),
          productMode: "code",
          sessionId: SESSION,
          initialDiffQueue: [
            { id: "diff-1", path: "a.txt", diff: "d1" },
            { id: "diff-2", path: "b.txt", diff: "d2" },
          ],
          changesOpen: false,
          view: "chat",
          onError: noop,
          toast: toast.api,
        }),
      );

      // Neither diff has a matching owner/decision in an empty projection,
      // so settleOwnedDiff's fallback (api.diff) is what both go through —
      // the "same settle path" this test is pinning.
      await act(async () => {
        await result.current.acceptDiff("diff-1");
      });
      await act(async () => {
        await result.current.rejectDiff("diff-2");
      });

      assert.equal(calls.length, 2);
      assert.ok(calls[0]!.url.endsWith("/api/diff"), calls[0]!.url);
      assert.ok(calls[1]!.url.endsWith("/api/diff"), calls[1]!.url);
      assert.deepEqual(calls[0]!.body, { id: "diff-1", action: "accept" });
      assert.deepEqual(calls[1]!.body, { id: "diff-2", action: "reject" });

      assert.deepEqual(result.current.diffQueue.map((d) => d.id), []);
      assert.deepEqual(toast.calls.map((c) => c.message), ["File accepted", "File rejected"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
