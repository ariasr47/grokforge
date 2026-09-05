import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { api } from "./api";
import {
  CHANGES_DOCK_LABEL,
  ChangesDock,
  FILE_CHANGES_KIND_DELETED,
  FILE_CHANGES_KIND_RENAMED,
  type ChangesDockMember,
} from "./ChangesDock";
import { mergePendingDiffs, projectRunChangeList, type CatchUpSignal } from "./runChangeList";
import type { ActivityRecord, DecisionRequest, RunProjectionRun, RunSnapshot } from "./runReducer";
import { RunSurface } from "./RunSurface";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a",
  runId: "run-a",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "delete and rename",
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

function deleteActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-del",
    invocationId: "i-del",
    name: "delete_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { path: "gone.txt" },
    output: null,
    error: null,
    diff: null,
    path: "gone.txt",
    kind: "delete",
    fromPath: null,
    toPath: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e-del",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function renameActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-ren",
    invocationId: "i-ren",
    name: "rename_file",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { fromPath: "from.txt", toPath: "to.txt" },
    output: null,
    error: null,
    diff: null,
    path: "to.txt",
    kind: "rename",
    fromPath: "from.txt",
    toPath: "to.txt",
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "text_edit",
    autoApplied: true,
    command: null,
    editId: "e-ren",
    recovery: { kind: "guarded_revert", available: true, status: "available" },
    ...overrides,
  };
}

function reviewDelete(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return deleteActivity({
    autoApplied: false,
    automaticEligibility: "not_eligible",
    recovery: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  });
}

function reviewRename(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return renameActivity({
    path: "from.txt",
    autoApplied: false,
    automaticEligibility: "not_eligible",
    recovery: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  });
}

function diffDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "req-1",
    invocationId: "i-del",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "gone.txt",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

/** File changes moved from RunSurface into the Changes dock (Task 9). */
function renderChanges(
  fixture: RunProjectionRun,
  opts: { catchUp?: CatchUpSignal; onRevert?: (member: ChangesDockMember) => void } = {},
) {
  const catchUp = opts.catchUp ?? { phase: "closed" };
  const projection = projectRunChangeList(fixture, catchUp);
  const files =
    projection.state === "ready"
      ? { state: "ready" as const, members: projection.members.map((m) => ({ ...m, runId: fixture.runId })) }
      : projection.state === "loading"
        ? { state: "loading" as const }
        : projection.state === "error"
          ? { state: "error" as const, message: projection.message }
          : { state: "ready" as const, members: [] };
  render(
    <ChangesDock
      files={files}
      verify={{ state: "ready", runLive: false, members: [] }}
      git={{ state: "ready", members: [] }}
      diffQueue={mergePendingDiffs([], fixture)}
      onAccept={() => undefined}
      onReject={() => undefined}
      onRevert={opts.onRevert}
      onCollapse={() => undefined}
      onOpenReview={() => undefined}
    />,
  );
}

function changesRegion() {
  return screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
}

test("Review pending delete/rename are diff-backed — Accept/Reject show directly, kind chips too (AC-09)", () => {
  // Both are real "diff" decisions, so the redesigned dock offers Accept/
  // Reject on the row itself (Task 9) instead of the old "settle in the
  // action dock" indirection FileChangesSection used.
  renderChanges(
    run({
      policy: { effectiveMode: "review" },
      activities: {
        "a-del": reviewDelete(),
        "a-ren": reviewRename({ activityId: "a-ren", invocationId: "i-ren", editId: "e-ren" }),
      },
      decisions: {
        "req-del": diffDecision({ requestId: "req-del", invocationId: "i-del", detail: "gone.txt" }),
        "req-ren": diffDecision({ requestId: "req-ren", invocationId: "i-ren", detail: "from.txt" }),
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_DELETED));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
  assert.ok(within(section).getByText("gone.txt"));
  assert.ok(within(section).getByText("from.txt"));
  assert.equal(within(section).queryByText("from.txt → to.txt") === null, true);
  assert.equal(within(section).getAllByRole("button", { name: "Accept" }).length, 2);
  assert.equal(within(section).getAllByRole("button", { name: "Reject" }).length, 2);
  assert.equal(within(section).queryByText("Pending") === null, true);
});

test("Reject of staged pending rename keeps Rejected + Renamed on fromPath (AC-11)", () => {
  renderChanges(
    run({
      policy: { effectiveMode: "review" },
      activities: {
        "a-ren": reviewRename(),
      },
      decisions: {
        "req-ren": diffDecision({
          requestId: "req-ren",
          invocationId: "i-ren",
          status: "declined",
          detail: "from.txt",
        }),
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("Rejected"));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
  assert.ok(within(section).getByText("from.txt"));
  assert.equal(within(section).queryByText("from.txt → to.txt") === null, true);
});

test("Accept rename shows fromPath → toPath with Accepted (AC-11)", () => {
  renderChanges(
    run({
      policy: { effectiveMode: "review" },
      activities: {
        "a-ren": reviewRename({ path: "to.txt" }),
      },
      decisions: {
        "req-ren": diffDecision({
          requestId: "req-ren",
          invocationId: "i-ren",
          status: "accepted",
          detail: "to.txt",
        }),
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("Accepted"));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
  assert.ok(within(section).getByText("from.txt → to.txt"));
});

test("recovery.status failed keeps Applied + kind and offers no Restore/Revert (AC-23)", () => {
  renderChanges(
    run({
      activities: {
        "a-del": deleteActivity({
          recovery: { kind: "guarded_revert", available: false, status: "failed" },
        }),
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("Applied"));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_DELETED));
  assert.equal(within(section).queryByRole("button", { name: "Restore file" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Revert rename" }) === null, true);
  assert.equal(within(section).queryByText("File restored") === null, true);
});

test("catch-up loading / failure / complete-zero stay distinct for delete-rename membership (AC-19/25)", () => {
  renderChanges(run(), { catchUp: { phase: "open" } });
  assert.ok(screen.getByText("Loading file changes…"));
  assert.equal(screen.queryByText("0") === null, true);
  cleanup();

  const message = "Couldn’t load this run’s file changes. Activity rows and diffs that already loaded stay available.";
  renderChanges(run({ activities: { "a-del": deleteActivity() } }), {
    catchUp: { phase: "failed", message },
  });
  const failed = changesRegion();
  assert.equal(within(failed).getByRole("alert").textContent, message);
  assert.equal(within(failed).queryByText("gone.txt") === null, true);
  cleanup();

  const { container } = render(
    <RunSurface
      run={run({
        activities: {
          r: deleteActivity({
            activityId: "r",
            name: "run_shell",
            kind: null,
            path: null,
            editId: null,
            autoApplied: false,
            automaticEligibility: "not_eligible",
            execution: "not_executed",
            recovery: null,
            command: "rm -rf /",
          }),
        },
      })}
      catchUp={{ phase: "closed" }}
    />,
  );
  assert.equal(container.querySelector(".changes") === null, true);
  assert.equal(screen.queryByText("Loading file changes…") === null, true);
});

test("opening View diff does not call restore/revert (AC-20)", () => {
  let reverted = 0;
  renderChanges(
    run({
      activities: {
        "a-del": deleteActivity({
          activityId: "a-del",
          invocationId: "i-del",
          diff: "--- a/gone.txt\n+++ /dev/null\n-old",
        }),
      },
    }),
    { onRevert: () => { reverted += 1; } },
  );
  const section = changesRegion();
  fireEvent.click(within(section).getByRole("button", { name: "View diff" }));
  assert.equal(reverted, 0);
  fireEvent.click(within(section).getByRole("button", { name: "Restore file" }));
  assert.equal(reverted, 1);
});

test("Restore file posts edit-recovery (AC-05)", async () => {
  const calls: Array<{ sessionId: string; runId: string; editId: string }> = [];
  const original = api.editRecovery;
  api.editRecovery = (async (body) => {
    calls.push(body);
    return { ok: true, activity: {} };
  }) as typeof api.editRecovery;
  try {
    const fixture = run({ activities: { "a-del": deleteActivity() } });
    renderChanges(fixture, {
      onRevert: (member) =>
        void api.editRecovery({ sessionId: fixture.sessionId, runId: fixture.runId, editId: member.editId }),
    });
    const section = changesRegion();
    fireEvent.click(within(section).getByRole("button", { name: "Restore file" }));
    assert.deepEqual(calls, [{ sessionId: "session-a", runId: "run-a", editId: "e-del" }]);
  } finally {
    api.editRecovery = original;
  }
});

test("Chat productMode does not mount File changes even with vouched delete (AC-21)", () => {
  render(
    <RunSurface
      run={run({ activities: { "a-del": deleteActivity() } })}
      productMode="chat"
    />,
  );
  assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }) === null, true);
  assert.equal(screen.queryByText(FILE_CHANGES_KIND_DELETED) === null, true);
});

test("shell path-ish activity is not a Deleted File changes member (AC-15/22)", () => {
  const fixture = run({
    activities: {
      sh: deleteActivity({
        activityId: "sh",
        invocationId: "sh-1",
        name: "run_shell",
        kind: null,
        path: "gone.txt",
        editId: "e-shell",
        autoApplied: true,
        automaticEligibility: "trusted_command_class",
        command: "del gone.txt",
        recovery: null,
      }),
    },
  });
  const projection = projectRunChangeList(fixture, { phase: "closed" });
  assert.equal(projection.state, "absent");
});

test("pending rename in the diff queue binds fromPath and an empty diff does not crash (AC-09)", () => {
  const fixture = run({
    policy: { effectiveMode: "review" },
    activities: {
      "a-ren": reviewRename({ diff: null }),
    },
    decisions: {
      "req-ren": diffDecision({ requestId: "req-ren", invocationId: "i-ren", detail: "from.txt" }),
    },
  });
  const queue = mergePendingDiffs([], fixture);
  assert.equal(queue[0]?.path, "from.txt");
  renderChanges(fixture);
  const dock = changesRegion();
  assert.ok(within(dock).getAllByText("from.txt").length >= 1);
  assert.ok(within(dock).getByRole("button", { name: "Accept" }));
  assert.ok(within(dock).getByRole("button", { name: "Reject" }));
});
