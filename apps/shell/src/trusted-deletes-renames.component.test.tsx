import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActionDock } from "./ActionDock";
import { api } from "./api";
import {
  FILE_CHANGES_HEADER,
  FILE_CHANGES_KIND_DELETED,
  FILE_CHANGES_KIND_RENAMED,
  FILE_CHANGES_LOAD_FAILURE,
  FILE_CHANGES_LOADING,
  FILE_CHANGES_PENDING_HELPER,
  FILE_CHANGES_RESTORE_FILE,
  FILE_CHANGES_REVERT_RENAME,
  FileChangesSection,
} from "./FileChangesSection";
import { pendingDiffsFromRun } from "./runChangeList";
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

test("Review pending delete/rename show Pending helper and kind chips (AC-09)", () => {
  render(
    <RunSurface
      run={run({
        policy: { effectiveMode: "review" },
        activities: {
          "a-del": reviewDelete(),
          "a-ren": reviewRename({ activityId: "a-ren", invocationId: "i-ren", editId: "e-ren" }),
        },
        decisions: {
          "req-del": diffDecision({ requestId: "req-del", invocationId: "i-del", detail: "gone.txt" }),
          "req-ren": diffDecision({ requestId: "req-ren", invocationId: "i-ren", detail: "from.txt" }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_DELETED));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
  assert.ok(within(section).getByText("gone.txt"));
  assert.ok(within(section).getByText("from.txt"));
  assert.equal(within(section).queryByText("from.txt → to.txt"), null);
  assert.equal(within(section).getAllByText("Pending").length, 2);
  assert.equal(within(section).getAllByText(FILE_CHANGES_PENDING_HELPER).length, 2);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
  assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
});

test("dock Reject of staged pending rename keeps Rejected + Renamed on fromPath (AC-11)", () => {
  render(
    <RunSurface
      run={run({
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
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("Rejected"));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
  assert.ok(within(section).getByText("from.txt"));
  assert.equal(within(section).queryByText("from.txt → to.txt"), null);
});

test("Review accept rename shows fromPath → toPath with Accepted (AC-11)", () => {
  render(
    <RunSurface
      run={run({
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
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("Accepted"));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_RENAMED));
  assert.ok(within(section).getByText("from.txt → to.txt"));
});

test("recovery.status failed keeps Applied + kind and offers no Restore/Revert (AC-23)", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          "a-del": deleteActivity({
            recovery: { kind: "guarded_revert", available: false, status: "failed" },
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.ok(within(section).getByText("Applied"));
  assert.ok(within(section).getByText(FILE_CHANGES_KIND_DELETED));
  assert.equal(within(section).queryByRole("button", { name: FILE_CHANGES_RESTORE_FILE }), null);
  assert.equal(within(section).queryByRole("button", { name: FILE_CHANGES_REVERT_RENAME }), null);
  assert.equal(within(section).queryByText("File restored"), null);
});

test("catch-up loading / failure / complete-zero stay distinct for delete-rename membership (AC-19/25)", () => {
  const { rerender } = render(<RunSurface run={run()} catchUp={{ phase: "open" }} />);
  assert.ok(screen.getByText(FILE_CHANGES_LOADING));
  assert.equal(screen.queryByText("0"), null);

  rerender(
    <RunSurface
      run={run({ activities: { "a-del": deleteActivity() } })}
      catchUp={{ phase: "failed", message: FILE_CHANGES_LOAD_FAILURE }}
    />,
  );
  const failed = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  assert.equal(within(failed).getByRole("alert").textContent, FILE_CHANGES_LOAD_FAILURE);
  assert.equal(within(failed).queryByText("gone.txt"), null);

  rerender(
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
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByText(FILE_CHANGES_LOADING), null);
});

test("opening View diff does not call restore/revert (AC-20)", () => {
  let reverted = 0;
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [{
          editId: "e-del",
          path: "gone.txt",
          kind: "delete",
          fromPath: null,
          toPath: null,
          activityId: "a-del",
          invocationId: "i-del",
          requestId: null,
          diff: "--- a/gone.txt\n+++ /dev/null\n-old",
          settlement: "applied",
          recoveryAvailable: true,
          diffUnavailable: false,
        }],
      }}
      onRevert={() => {
        reverted += 1;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  assert.equal(reverted, 0);
  fireEvent.click(screen.getByRole("button", { name: FILE_CHANGES_RESTORE_FILE }));
  assert.equal(reverted, 1);
});

test("Restore file on RunSurface posts edit-recovery (AC-05)", async () => {
  const calls: Array<{ sessionId: string; runId: string; editId: string }> = [];
  const original = api.editRecovery;
  api.editRecovery = (async (body) => {
    calls.push(body);
    return { ok: true, activity: {} };
  }) as typeof api.editRecovery;
  try {
    render(<RunSurface run={run({ activities: { "a-del": deleteActivity() } })} />);
    const section = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
    fireEvent.click(within(section).getByRole("button", { name: FILE_CHANGES_RESTORE_FILE }));
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
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByText(FILE_CHANGES_KIND_DELETED), null);
});

test("shell path-ish activity is not a Deleted File changes member (AC-15/22)", () => {
  render(
    <RunSurface
      run={run({
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
      })}
      productMode="code"
    />,
  );
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByText(FILE_CHANGES_KIND_DELETED), null);
});

test("pending rename dock column binds fromPath and empty diff does not crash (AC-09)", () => {
  const fixture = run({
    policy: { effectiveMode: "review" },
    activities: {
      "a-ren": reviewRename({ diff: null }),
    },
    decisions: {
      "req-ren": diffDecision({ requestId: "req-ren", invocationId: "i-ren", detail: "from.txt" }),
    },
  });
  const queue = pendingDiffsFromRun(fixture);
  assert.equal(queue[0]?.path, "from.txt");
  render(
    <ActionDock
      permissions={[]}
      diffQueue={queue}
      activeDiffId="req-ren"
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
    />,
  );
  const dock = screen.getByRole("region", { name: "Pending file edits (1)" });
  assert.ok(within(dock).getAllByText("from.txt").length >= 1);
  assert.ok(within(dock).getByRole("button", { name: "Accept" }));
  assert.ok(within(dock).getByRole("button", { name: "Reject" }));
});
