import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "./api";
import {
  CHANGES_DOCK_LABEL,
  ChangesDock,
  FILE_CHANGES_APPLIED_HELPER,
  type ChangesDockMember,
} from "./ChangesDock";
import {
  mergePendingDiffs,
  pendingDiffsFromRun,
  projectRunChangeList,
  type CatchUpSignal,
} from "./runChangeList";
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

/** File changes moved from RunSurface into the (session-level) Changes dock
 *  in Task 9 — this mounts both, the same way App.tsx really wires them,
 *  from the same production projection (projectRunChangeList). */
function renderWithChanges(
  fixture: RunProjectionRun,
  opts: {
    catchUp?: CatchUpSignal;
    onRevert?: (member: ChangesDockMember) => void;
    recoveryFlash?: Record<string, "reverted" | "conflict">;
  } = {},
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
    <>
      <RunSurface run={fixture} catchUp={catchUp} />
      <ChangesDock
        files={files}
        verify={{ state: "ready", runLive: false, members: [] }}
        git={{ state: "ready", members: [] }}
        diffQueue={mergePendingDiffs([], fixture)}
        onAccept={() => undefined}
        onReject={() => undefined}
        onRevert={opts.onRevert}
        recoveryFlash={opts.recoveryFlash}
        onCollapse={() => undefined}
        onOpenReview={() => undefined}
      />
    </>,
  );
}

function changesRegion() {
  return screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
}

test("ready list names three Trusted paths, Applied chips, no Pending (AC-01/02)", () => {
  renderWithChanges(trustedThree());
  const section = changesRegion();
  assert.ok(within(section).getByText("a.txt"));
  assert.ok(within(section).getByText("b.txt"));
  assert.ok(within(section).getByText("c.txt"));
  assert.equal(within(section).getAllByText("Applied").length, 3);
  assert.equal(within(section).queryByText("Pending") === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }) === null, true);
});

test("vendor session plan.md write does not mint Activity View diff", () => {
  renderWithChanges(
    run({
      policy: { effectiveMode: "review" },
      activities: {
        p1: reviewActivity({
          activityId: "p1",
          invocationId: "ip1",
          name: "write",
          path: "C:\\Users\\rodri\\.grok\\sessions\\CK3A%5CDev%5Cgrokforge\\sid\\plan.md",
          diff: "--- /dev/null\n+++ b/plan.md\n+# Plan\n",
        }),
      },
    }),
  );
  assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }) === null, true);
  const activity = screen.getByLabelText("Activity");
  assert.equal(within(activity).queryByRole("button", { name: "View diff" }) === null, true);
});

test("read/grep activities with a leftover diff do not mint View diff pills", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          r1: writeActivity({
            activityId: "r1",
            invocationId: "ir1",
            name: "read_file",
            editId: null,
            kind: null,
            autoApplied: false,
            recovery: null,
            path: "apps/shell/src/styles/chrome.css",
            diff: "--- a/chrome.css\n+++ b/chrome.css\n+nope",
          }),
        },
      })}
    />,
  );
  const activity = screen.getByLabelText("Activity");
  assert.equal(within(activity).queryByRole("button", { name: "View diff" }) === null, true);
});

test("read file with a vendor editId still does not mint View diff", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          r1: writeActivity({
            activityId: "r1",
            invocationId: "ir1",
            name: "read file",
            editId: "e-read",
            kind: null,
            autoApplied: false,
            recovery: null,
            path: "apps/shell/src/styles/chrome.css",
            diff: "--- /dev/null\n+++ b/chrome.css\n+whole file",
          }),
        },
      })}
    />,
  );
  const activity = screen.getByLabelText("Activity");
  assert.equal(within(activity).queryByRole("button", { name: "View diff" }) === null, true);
});

test("View diff matches activity.diff for the same editId (AC-03/17)", () => {
  const body = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n keep\n+A";
  const fixture = run({
    activities: { a1: writeActivity({ diff: body }) },
  });
  renderWithChanges(fixture);
  const section = changesRegion();
  fireEvent.click(within(section).getByRole("button", { name: "View diff" }));
  assert.ok(within(section).getByText("+A", { exact: false }));
  const activity = screen.getByLabelText("Activity");
  const activityDiffButtons = within(activity).getAllByRole("button", { name: "View diff" });
  fireEvent.click(activityDiffButtons[activityDiffButtons.length - 1]!);
  const activityDiff = activity.querySelector("pre");
  assert.equal(activityDiff?.textContent, body);
  assert.equal(fixture.activities.a1!.diff, body);
});

test("Rejected retains View diff body (AC-08)", () => {
  const proposed = "--- a/r1.txt\n+++ b/r1.txt\n+one";
  renderWithChanges(
    run({
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
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("Rejected"));
  assert.equal(within(section).queryByText("Pending") === null, true);
  fireEvent.click(within(section).getByRole("button", { name: "View diff" }));
  assert.ok(within(section).getByText("+one", { exact: false }));
});

test("complete zero members → no Changes dock (AC-09)", () => {
  renderWithChanges(
    run({
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
    }),
  );
  assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }) === null, true);
  assert.equal(screen.queryByText("Loading file changes…") === null, true);
});

test("singleton one-entry list is not suppressed (AC-19)", () => {
  renderWithChanges(run({ activities: { a1: writeActivity() } }));
  const section = changesRegion();
  assert.ok(within(section).getByText("a.txt"));
  assert.ok(within(section.querySelector(".chead")!).getByText(/1 file\b/));
});

test("mixed list Diff unavailable does not become whole-list error (AC-20)", () => {
  renderWithChanges(
    run({
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
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("kept.ts"));
  assert.ok(within(section).getByText("missing.ts"));
  // No diff -> no View/Hide diff toggle offered for that row (never
  // fabricated) — exactly one such toggle exists, for kept.ts.
  assert.equal(within(section).getAllByRole("button", { name: /View diff|Hide diff/ }).length, 1);
  assert.equal(screen.queryByText("Couldn’t load this run’s file changes.", { exact: false }) === null, true);
});

test("catch-up open shows Loading file changes… not absent (AC-21)", () => {
  renderWithChanges(run(), { catchUp: { phase: "open" } });
  assert.ok(screen.getByText("Loading file changes…"));
  assert.equal(screen.queryByText("0") === null, true);
});

test("health-poll closed catch-up does not open Loading over a ready list (W3)", () => {
  renderWithChanges(trustedThree(), { catchUp: { phase: "closed" } });
  assert.ok(screen.getByRole("region", { name: CHANGES_DOCK_LABEL }));
  assert.equal(screen.queryByText("Loading file changes…") === null, true);
  cleanup();
  renderWithChanges(trustedThree(), { catchUp: { phase: "closed" } });
  assert.ok(within(screen.getByRole("region", { name: CHANGES_DOCK_LABEL })).getByText("a.txt"));
  assert.equal(screen.queryByText("Loading file changes…") === null, true);
});

test("catch-up failed shows load-failure copy, not empty (AC-23)", () => {
  const message = "Couldn’t load this run’s file changes. Activity rows and diffs that already loaded stay available.";
  renderWithChanges(trustedThree(), { catchUp: { phase: "failed", message } });
  const section = changesRegion();
  assert.equal(within(section).getByRole("alert").textContent, message);
  assert.equal(within(section).queryByText("a.txt") === null, true);
});

test("Bypass activity is excluded from File changes (AC-22)", () => {
  renderWithChanges(
    run({
      activities: {
        b: writeActivity({
          path: "bypass.txt",
          editId: "e-bypass",
          automaticEligibility: "bypass",
          autoApplied: true,
        }),
      },
    }),
  );
  assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }) === null, true);
});

test("Reverted is not Applied and Revert is not offered (AC-26)", () => {
  renderWithChanges(
    run({
      activities: {
        a1: writeActivity({
          autoApplied: true,
          recovery: { kind: "guarded_revert", available: true, status: "reverted" },
        }),
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("Reverted"));
  assert.equal(within(section).queryByText("Applied") === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Revert edit" }) === null, true);
});

test("conflict chrome is Edit not reverted with View diff (AC-05)", () => {
  renderWithChanges(
    run({
      activities: {
        a1: writeActivity({
          recovery: { kind: "guarded_revert", available: true, status: "conflict" },
        }),
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("Edit not reverted"));
  assert.ok(within(section).getByRole("button", { name: "View diff" }));
  assert.equal(within(section).queryByRole("button", { name: "Revert edit" }) === null, true);
});

test("pending diff-backed members show Accept/Reject, no fabricated helper text (AC-07)", () => {
  // Review-policy pending here is backed by real "diff" decisions (not a bare
  // permission), so the redesigned dock — unlike the old FileChangesSection,
  // which always deferred to the (now-removed) DiffPanel — offers Accept/
  // Reject directly on the row, from the same diff queue DiffPanel used.
  const fixture = run({
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
  });
  renderWithChanges(fixture);
  const section = changesRegion();
  assert.equal(within(section).getAllByRole("button", { name: "Accept" }).length, 2);
  assert.equal(within(section).getAllByRole("button", { name: "Reject" }).length, 2);
  assert.equal(within(section).queryByText("Pending") === null, true);
});

test("RunSurface turn order: reasoning before the activity stack", () => {
  // File changes moved out of RunSurface (Task 9) — it's no longer orderable
  // against reasoning/activity inside one RunSurface render.
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
  // Receipts shows the edited path, not the raw write_file tool name.
  const activityAt = Math.max(text.indexOf("Edited"), text.indexOf("a.txt"));
  assert.ok(reasoningAt >= 0 && activityAt > reasoningAt);
});

test("opening and collapsing the diff preview does not call recovery or settle (AC-14)", () => {
  let recovered = 0;
  const original = (globalThis as { fetch?: typeof fetch }).fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    recovered += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    renderWithChanges(trustedThree());
    const section = changesRegion();
    fireEvent.click(within(section).getAllByRole("button", { name: "View diff" })[0]!);
    fireEvent.click(within(section).getByRole("button", { name: "Hide diff" }));
    assert.equal(recovered, 0);
  } finally {
    if (original) (globalThis as { fetch: typeof fetch }).fetch = original;
    else delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

test("Changes dock rebuilds pending from durable decision + activity without live file_edit (AC-25)", () => {
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
  const projection = projectRunChangeList(fixture, { phase: "closed" });
  render(
    <ChangesDock
      files={{
        state: "ready",
        members: projection.state === "ready" ? projection.members.map((m) => ({ ...m, runId: fixture.runId })) : [],
      }}
      verify={{ state: "ready", runLive: false, members: [] }}
      git={{ state: "ready", members: [] }}
      diffQueue={rebuilt}
      onAccept={(id) => {
        accepted = id;
      }}
      onReject={() => undefined}
      onCollapse={() => undefined}
      onOpenReview={() => undefined}
    />,
  );
  const dock = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
  assert.ok(within(dock).getAllByText("r1.txt").length >= 1);
  fireEvent.click(within(dock).getByRole("button", { name: "Accept" }));
  assert.equal(accepted, "req1");
});

test("Trusted list adds the second path on the next render without a second activity hunt (AC-13)", () => {
  const first = run({ activities: { a1: writeActivity() } });
  renderWithChanges(first);
  const firstSection = changesRegion();
  assert.ok(within(firstSection).getByText("a.txt"));
  assert.equal(within(firstSection).queryByText("b.txt") === null, true);
  cleanup();
  renderWithChanges(
    run({
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
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByText("a.txt"));
  assert.ok(within(section).getByText("b.txt"));
});

test("settled Write file decision is not a duplicate transcript card", () => {
  renderWithChanges(
    run({
      activities: {
        a1: reviewActivity({
          path: "docs/dogfood/DIFF.md",
          summary: "Write `C:\\\\Dev\\\\grokforge\\\\docs\\\\dogfood\\\\DIFF.md`",
          title: "Write `C:\\\\Dev\\\\grokforge\\\\docs\\\\dogfood\\\\DIFF.md`",
        }),
      },
      decisions: {
        perm: {
          requestId: "perm",
          invocationId: "i1",
          kind: "permission",
          status: "accepted",
          title: "Write file",
          detail: "Write `C:\\\\Dev\\\\grokforge\\\\docs\\\\dogfood\\\\DIFF.md`",
          expiresAt: null,
          policy: {},
        },
      },
    }),
  );
  assert.equal(screen.queryByRole("group", { name: "Write file" }) === null, true);
  assert.ok(screen.getByRole("region", { name: CHANGES_DOCK_LABEL }));
  assert.ok(screen.getAllByText("DIFF.md").length >= 1);
});

test("Review File changes path covers a second search-replace activity — no extra View diff", () => {
  renderWithChanges(
    run({
      policy: { effectiveMode: "review" },
      activities: {
        member: reviewActivity({
          activityId: "perm-row",
          invocationId: "perm-inv",
          editId: "perm-row",
          path: "docs/dogfood/NEXT.md",
          diff: "--- a/docs/dogfood/NEXT.md\n+++ b/docs/dogfood/NEXT.md\n-NEXT-OK\n+NEXT-TWO\n",
        }),
        extra: reviewActivity({
          activityId: "sr-extra",
          invocationId: "sr-extra",
          editId: "sr-extra",
          name: "search_replace",
          path: "docs/dogfood/NEXT.md",
          diff: "--- a/docs/dogfood/NEXT.md\n+++ b/docs/dogfood/NEXT.md\n-NEXT-OK\n+NEXT-TWO\n",
        }),
      },
      decisions: {
        perm: {
          requestId: "perm",
          invocationId: "perm-inv",
          kind: "permission",
          status: "accepted",
          title: "Write file",
          detail: "docs/dogfood/NEXT.md",
          expiresAt: null,
          policy: {},
        },
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByRole("button", { name: "View diff" }));
  const activity = screen.getByLabelText("Activity");
  assert.equal(within(activity).queryByRole("button", { name: "View diff" }) === null, true);
});

test("Review File changes member does not duplicate View diff in Activity", () => {
  renderWithChanges(
    run({
      activities: {
        a1: reviewActivity({
          path: "docs/dogfood/CLEAN.md",
          editId: "tc-write",
          invocationId: "tc-write",
          diff: "--- /dev/null\n+++ b/docs/dogfood/CLEAN.md\n+CLEAN-OK\n",
        }),
      },
      decisions: {
        perm: {
          requestId: "perm",
          invocationId: "tc-write",
          kind: "permission",
          status: "accepted",
          title: "Write file",
          detail: "docs/dogfood/CLEAN.md",
          expiresAt: null,
          policy: {},
        },
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByRole("button", { name: "View diff" }));
  const activity = screen.getByLabelText("Activity");
  assert.equal(within(activity).queryByRole("button", { name: "View diff" }) === null, true);
});

test("Review File changes member does not duplicate Revert edit in Activity", () => {
  renderWithChanges(
    run({
      activities: {
        a1: reviewActivity({
          path: "docs/dogfood/acp-code/revert-probe.md",
          editId: "rev-write",
          invocationId: "rev-write",
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        }),
      },
      decisions: {
        perm: {
          requestId: "perm",
          invocationId: "rev-write",
          kind: "permission",
          status: "accepted",
          title: "Write file",
          detail: "docs/dogfood/acp-code/revert-probe.md",
          expiresAt: null,
          policy: {},
        },
      },
    }),
  );
  const section = changesRegion();
  assert.ok(within(section).getByRole("button", { name: "Revert edit" }));
  const activity = screen.getByLabelText("Activity");
  assert.equal(within(activity).queryByRole("button", { name: "Revert edit" }) === null, true);
});

test("Review File changes revert success is not repeated in Activity", async () => {
  const original = api.editRecovery;
  const calls: Array<{ sessionId: string; runId: string; editId: string }> = [];
  api.editRecovery = (async (body) => {
    calls.push(body);
    return { ok: true, activity: {} };
  }) as typeof api.editRecovery;
  try {
    const fixture = run({
      activities: {
        a1: reviewActivity({
          path: "docs/dogfood/acp-code/revert-probe.md",
          editId: "rev-write",
          invocationId: "rev-write",
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        }),
        a2: reviewActivity({
          activityId: "a2",
          path: "docs/dogfood/acp-code/revert-probe.md",
          editId: "rev-write",
          invocationId: "rev-write",
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        }),
      },
      decisions: {
        perm: {
          requestId: "perm",
          invocationId: "rev-write",
          kind: "permission",
          status: "accepted",
          title: "Write file",
          detail: "docs/dogfood/acp-code/revert-probe.md",
          expiresAt: null,
          policy: {},
        },
      },
    });
    // Fires the real recovery call (mirrors App.tsx's recoverChangeMember)
    // and, on success, re-renders with the flash state App.tsx would set —
    // this is what actually paints "Edit reverted" in the dock.
    let reverted: ChangesDockMember | null = null;
    renderWithChanges(fixture, {
      onRevert: (member) => {
        void api.editRecovery({ sessionId: fixture.sessionId, runId: fixture.runId, editId: member.editId }).then(() => {
          reverted = member;
        });
      },
    });
    const section = changesRegion();
    fireEvent.click(within(section).getByRole("button", { name: "Revert edit" }));
    await waitFor(() => assert.equal(calls.length, 1));
    await waitFor(() => assert.ok(reverted));
    cleanup();
    renderWithChanges(fixture, { recoveryFlash: { [reverted!.editId]: "reverted" } });
    assert.ok(within(changesRegion()).getByText("Edit reverted"));
    const activity = screen.getByLabelText("Activity");
    assert.equal(within(activity).queryByText("Edit reverted") === null, true);
  } finally {
    api.editRecovery = original;
  }
});

test("Applied automatically note only shows for trusted-applied members", () => {
  renderWithChanges(run({ activities: { a1: writeActivity() } }));
  const section = changesRegion();
  assert.ok(within(section).getByText(FILE_CHANGES_APPLIED_HELPER));
});
