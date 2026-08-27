import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActionDock } from "./ActionDock";
import {
  FILE_CHANGES_DIFF_UNAVAILABLE,
  FILE_CHANGES_HEADER,
  FILE_CHANGES_LOAD_FAILURE,
  FILE_CHANGES_LOADING,
  FILE_CHANGES_PENDING_HELPER,
} from "./FileChangesSection";
import { mergePendingDiffs, pendingDiffsFromRun } from "./runChangeList";
import type { ActivityRecord, DecisionRequest, RunProjectionRun, RunSnapshot } from "./runReducer";
import { RunSurface } from "./RunSurface";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a",
  runId: "run-a",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "edit several files",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 4,
  policy: { effectiveMode: "trusted_workspace" },
  model: { id: "grok-4.6" },
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  failure: null,
};

const run = (overrides: Partial<RunProjectionRun> = {}): RunProjectionRun => ({
  ...snapshot,
  reasoning: {},
  answer: {},
  message: {},
  activities: {},
  decisions: {},
  seenEventSeq: new Set([1]),
  terminalEventSeq: null,
  ...overrides,
});

function writeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
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
    diff: "--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+A",
    path: "a.txt",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e1",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function reviewActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return writeActivity({
    autoApplied: false,
    automaticEligibility: "not_eligible",
    recovery: null,
    ...overrides,
  });
}

function diffDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "req-1",
    invocationId: "i1",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "a.txt",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

const trustedThree = (): RunProjectionRun =>
  run({
    activities: {
      a1: writeActivity({ activityId: "a1", invocationId: "i1", path: "a.txt", editId: "e1", diff: "--- a/a.txt\n+++ b/a.txt\n+A" }),
      a2: writeActivity({ activityId: "a2", invocationId: "i2", path: "b.txt", editId: "e2", diff: "--- a/b.txt\n+++ b/b.txt\n+B" }),
      a3: writeActivity({ activityId: "a3", invocationId: "i3", path: "c.txt", editId: "e3", diff: "--- a/c.txt\n+++ b/c.txt\n+C" }),
    },
  });

test("ready list names three Trusted paths, Applied chips, no Pending (AC-01/02)", () => {
  render(<RunSurface run={trustedThree()} />);
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("a.txt"));
  assert.ok(within(section).getByText("b.txt"));
  assert.ok(within(section).getByText("c.txt"));
  assert.equal(within(section).getAllByText("Applied").length, 3);
  assert.equal(within(section).queryByText("Pending"), null);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
});

test("View diff matches activity.diff for the same editId (AC-03/17)", () => {
  const body = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n keep\n+A";
  const fixture = run({
    activities: { a1: writeActivity({ diff: body }) },
  });
  render(<RunSurface run={fixture} />);
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  fireEvent.click(within(section).getByRole("button", { name: "View diff" }));
  assert.ok(within(section).getByLabelText("Stored diff").textContent?.includes("+A"));
  const activity = screen.getByLabelText("Activity");
  const activityDiffButtons = within(activity).getAllByRole("button", { name: "View diff" });
  fireEvent.click(activityDiffButtons[activityDiffButtons.length - 1]!);
  const activityDiff = activity.querySelector("pre");
  assert.equal(activityDiff?.textContent, body);
  assert.equal(fixture.activities.a1.diff, body);
  assert.ok((within(section).getByLabelText("Stored diff").textContent ?? "").includes("+A"));
});

test("Rejected retains View diff body (AC-08)", () => {
  const proposed = "--- a/r1.txt\n+++ b/r1.txt\n+one";
  render(
    <RunSurface
      run={run({
        activities: {
          a1: reviewActivity({
            path: "r1.txt",
            editId: "edit-r1",
            invocationId: "inv-r1",
            diff: proposed,
          }),
        },
        decisions: {
          req: diffDecision({ requestId: "req", invocationId: "inv-r1", status: "declined" }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("Rejected"));
  assert.equal(within(section).queryByText("Pending"), null);
  fireEvent.click(within(section).getByRole("button", { name: "View diff" }));
  assert.ok(within(section).getByLabelText("Stored diff").textContent?.includes("+one"));
});

test("complete zero members → no File changes section (AC-09)", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          r: writeActivity({
            activityId: "r",
            name: "read_file",
            path: null,
            editId: null,
            diff: null,
            autoApplied: false,
            automaticEligibility: "read",
            recovery: null,
          }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByText(FILE_CHANGES_LOADING), null);
});

test("singleton one-entry list is not suppressed (AC-19)", () => {
  render(<RunSurface run={run({ activities: { a1: writeActivity() } })} />);
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("a.txt"));
  assert.ok(within(section).getByLabelText("1 file changes"));
});

test("mixed list Diff unavailable does not become whole-list error (AC-20)", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          a1: writeActivity({ path: "kept.ts", editId: "e1" }),
          a2: writeActivity({
            activityId: "a2",
            invocationId: "i2",
            path: "missing.ts",
            editId: "e2",
            diff: null,
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("kept.ts"));
  assert.ok(within(section).getByText("missing.ts"));
  assert.ok(within(section).getByText(FILE_CHANGES_DIFF_UNAVAILABLE));
  assert.equal(screen.queryByText(FILE_CHANGES_LOAD_FAILURE), null);
});

test("catch-up open shows Loading file changes… not absent (AC-21)", () => {
  render(<RunSurface run={run()} catchUp={{ phase: "open" }} />);
  assert.ok(screen.getByText(FILE_CHANGES_LOADING));
  assert.equal(screen.queryByText("0"), null);
});

test("health-poll closed catch-up does not open Loading over a ready list (W3)", () => {
  const { rerender } = render(<RunSurface run={trustedThree()} catchUp={{ phase: "closed" }} />);
  assert.ok(screen.getByRole("region", { name: FILE_CHANGES_HEADER }));
  assert.equal(screen.queryByText(FILE_CHANGES_LOADING), null);
  rerender(<RunSurface run={trustedThree()} catchUp={{ phase: "closed" }} />);
  assert.ok(within(screen.getByRole("region", { name: FILE_CHANGES_HEADER })).getByText("a.txt"));
  assert.equal(screen.queryByText(FILE_CHANGES_LOADING), null);
});

test("catch-up failed shows load-failure copy, not empty (AC-23)", () => {
  render(
    <RunSurface
      run={trustedThree()}
      catchUp={{ phase: "failed", message: FILE_CHANGES_LOAD_FAILURE }}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.equal(within(section).getByRole("alert").textContent, FILE_CHANGES_LOAD_FAILURE);
  assert.equal(within(section).queryByText("a.txt"), null);
});

test("Bypass activity is excluded from File changes (AC-22)", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          b: writeActivity({
            path: "bypass.txt",
            editId: "e-bypass",
            automaticEligibility: "bypass",
            autoApplied: true,
          }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
});

test("Reverted is not Applied and Revert is not offered (AC-26)", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          a1: writeActivity({
            autoApplied: true,
            recovery: { kind: "guarded_revert", available: true, status: "reverted" },
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("Reverted"));
  assert.equal(within(section).queryByText("Applied"), null);
  assert.equal(within(section).queryByRole("button", { name: "Revert edit" }), null);
});

test("conflict chrome is Edit not reverted with View diff (AC-05)", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          a1: writeActivity({
            recovery: { kind: "guarded_revert", available: true, status: "conflict" },
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("Edit not reverted"));
  assert.ok(within(section).getByRole("button", { name: "View diff" }));
  assert.equal(within(section).queryByRole("button", { name: "Revert edit" }), null);
});

test("pending helper copy and no list-only Accept (AC-07)", () => {
  render(
    <RunSurface
      run={run({
        policy: { effectiveMode: "review" },
        activities: {
          a1: reviewActivity({ path: "r1.txt", editId: "edit-r1", invocationId: "inv-r1" }),
          a2: reviewActivity({
            activityId: "a2",
            path: "r2.txt",
            editId: "edit-r2",
            invocationId: "inv-r2",
            diff: "--- a/r2.txt\n+++ b/r2.txt\n+two",
          }),
        },
        decisions: {
          req1: diffDecision({ requestId: "req1", invocationId: "inv-r1" }),
          req2: diffDecision({ requestId: "req2", invocationId: "inv-r2" }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.equal(within(section).getAllByText("Pending").length, 2);
  assert.equal(within(section).getAllByText(FILE_CHANGES_PENDING_HELPER).length, 2);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
  assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
});

test("File changes sits after reasoning and before the activity stack (AC-18 hierarchy)", () => {
  render(
    <RunSurface
      run={run({
        reasoning: { seg: "private reasoning" },
        activities: { a1: writeActivity() },
      })}
    />,
  );
  const surface = screen.getByRole("article", { name: "Run edit several files" });
  const text = surface.textContent ?? "";
  const reasoningAt = Math.max(text.indexOf("Thought…"), text.indexOf("Thought"));
  const fileChangesAt = text.indexOf(FILE_CHANGES_HEADER);
  const activityAt = Math.max(text.indexOf("write_file"), text.indexOf("write file"));
  assert.ok(reasoningAt >= 0 && fileChangesAt > reasoningAt && activityAt > fileChangesAt);
});

test("opening and collapsing the list does not call recovery or settle (AC-14)", () => {
  let recovered = 0;
  const original = (globalThis as { fetch?: typeof fetch }).fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    recovered += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    render(<RunSurface run={trustedThree()} />);
    const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
    fireEvent.click(within(section).getAllByRole("button", { name: "View diff" })[0]!);
    fireEvent.click(within(section).getByRole("button", { name: "Hide diff" }));
    const first = section.querySelector("summary");
    if (first) fireEvent.click(first);
    assert.equal(recovered, 0);
  } finally {
    if (original) (globalThis as { fetch: typeof fetch }).fetch = original;
    else delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

test("DiffPanel rebuilds pending from durable decision + activity without live file_edit (AC-25)", () => {
  const fixture = run({
    activities: {
      a1: reviewActivity({
        path: "r1.txt",
        editId: "edit-r1",
        invocationId: "inv-r1",
        diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
      }),
    },
    decisions: {
      req1: diffDecision({ requestId: "req1", invocationId: "inv-r1" }),
    },
  });
  const rebuilt = mergePendingDiffs([], fixture);
  assert.deepEqual(rebuilt, pendingDiffsFromRun(fixture));
  let accepted: string | null = null;
  render(
    <ActionDock
      permissions={[]}
      diffQueue={rebuilt}
      activeDiffId="req1"
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={(id) => {
        accepted = id;
      }}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
    />,
  );
  const dock = screen.getByRole("region", { name: "Pending file edits (1)" });
  assert.ok(within(dock).getAllByText("r1.txt").length >= 1);
  fireEvent.click(within(dock).getByRole("button", { name: "Accept" }));
  assert.equal(accepted, "req1");
});

test("live-growing Trusted list adds the second path without a second activity hunt (AC-13)", () => {
  const first = run({ activities: { a1: writeActivity() } });
  const { rerender } = render(<RunSurface run={first} />);
  const firstSection = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(firstSection).getByText("a.txt"));
  assert.equal(within(firstSection).queryByText("b.txt"), null);
  rerender(
    <RunSurface
      run={run({
        activities: {
          a1: writeActivity(),
          a2: writeActivity({
            activityId: "a2",
            invocationId: "i2",
            path: "b.txt",
            editId: "e2",
            diff: "--- a/b.txt\n+++ b/b.txt\n+B",
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("a.txt"));
  assert.ok(within(section).getByText("b.txt"));
  assert.ok(within(section).getByText("Updating as edits land…"));
});
