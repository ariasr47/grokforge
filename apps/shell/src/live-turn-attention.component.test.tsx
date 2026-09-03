import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActionDock } from "./ActionDock.js";
import { CHANGES_DOCK_LABEL, ChangesDock } from "./ChangesDock.js";
import { mergePendingDiffs, mergePendingPermissions, pendingPermissionsFromRun, projectRunChangeList } from "./runChangeList.js";
import type { ActivityRecord, DecisionRequest, RunProjectionRun, RunSnapshot } from "./runReducer.js";
import { RunSurface } from "./RunSurface.js";
import { api } from "./api.js";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a",
  runId: "run-a",
  connectionGeneration: 1,
  state: "waiting_for_decision",
  acceptedPrompt: "need a decision",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 4,
  policy: { effectiveMode: "review" },
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

function permissionDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "perm-1",
    invocationId: "inv-perm",
    kind: "permission",
    status: "pending",
    title: "Run shell",
    detail: "echo live-turn-attention",
    expiresAt: null,
    policy: {},
    ...overrides,
  };
}

function reviewActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a1",
    invocationId: "inv-d1",
    name: "write_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "r1.txt" },
    output: null,
    error: null,
    diff: "--- a/r1.txt\n+++ b/r1.txt\n+one",
    path: "r1.txt",
    policy: { effectiveMode: "review" },
    automaticEligibility: "not_eligible",
    autoApplied: false,
    command: null,
    editId: "edit-r1",
    recovery: null,
    ...overrides,
  };
}

function diffDecision(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    requestId: "req-1",
    invocationId: "inv-d1",
    kind: "diff",
    status: "pending",
    title: "Edit file",
    detail: "r1.txt",
    expiresAt: null,
    policy: { effectiveMode: "review" },
    ...overrides,
  };
}

function emptyDock(overrides: Partial<Parameters<typeof ActionDock>[0]> = {}) {
  return (
    <ActionDock
      permissions={[]}
      oauth={null}
      onPermission={() => undefined}
      {...overrides}
    />
  );
}

test("RunSurface pending decision is evidence-only — buttons do not call settle APIs", async () => {
  let permissionCalls = 0;
  let diffCalls = 0;
  const originalPermission = api.runPermission;
  const originalDiff = api.runDiff;
  api.runPermission = (async () => {
    permissionCalls += 1;
    return { ok: true };
  }) as typeof api.runPermission;
  api.runDiff = (async () => {
    diffCalls += 1;
    return { ok: true };
  }) as typeof api.runDiff;
  try {
    render(
      <RunSurface
        run={run({
          decisions: { p: permissionDecision() },
        })}
      />,
    );
    const group = screen.getByRole("group", { name: "Run shell" });
    assert.ok(within(group).getByText("echo live-turn-attention"));
    assert.equal(within(group).queryByRole("button", { name: "Allow" }) === null, true);
    assert.equal(within(group).queryByRole("button", { name: "Decline" }) === null, true);
    assert.ok(within(group).getByText("Settle this in the card below."));
    assert.equal(permissionCalls, 0);
    assert.equal(diffCalls, 0);
  } finally {
    api.runPermission = originalPermission;
    api.runDiff = originalDiff;
  }
});

test("pending diff fills the Changes dock's Accept/Reject until settlement", () => {
  // DiffPanel moved from ActionDock to the Changes dock in Task 9 — same
  // production projection (projectRunChangeList), just a different panel.
  const fixture = run({
    activities: { a1: reviewActivity() },
    decisions: { req1: diffDecision({ requestId: "req1" }) },
  });
  const changesDockFor = (r: RunProjectionRun) => {
    const projection = projectRunChangeList(r, { phase: "closed" });
    const members = projection.state === "ready" ? projection.members.map((m) => ({ ...m, runId: r.runId })) : [];
    return (
      <ChangesDock
        files={{ state: "ready", members }}
        verify={{ state: "ready", members: [] }}
        git={{ state: "ready", members: [] }}
        diffQueue={mergePendingDiffs([], r)}
        onAccept={() => undefined}
        onReject={() => undefined}
        onCollapse={() => undefined}
        onOpenReview={() => undefined}
      />
    );
  };
  const { rerender } = render(changesDockFor(fixture));
  const dock = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
  assert.ok(within(dock).getByRole("button", { name: "Accept" }));
  assert.ok(within(dock).getByRole("button", { name: "Reject" }));
  const settled = run({
    activities: { a1: reviewActivity() },
    decisions: { req1: diffDecision({ requestId: "req1", status: "accepted" }) },
  });
  rerender(changesDockFor(settled));
  assert.equal(within(screen.getByRole("region", { name: CHANGES_DOCK_LABEL })).queryByRole("button", { name: "Accept" }) === null, true);
  assert.equal(within(screen.getByRole("region", { name: CHANGES_DOCK_LABEL })).queryByRole("button", { name: "Reject" }) === null, true);
  assert.ok(within(screen.getByRole("region", { name: CHANGES_DOCK_LABEL })).getByText("Accepted"));
});

test("ActionDock is absent when nothing is pending", () => {
  render(emptyDock());
  assert.equal(screen.queryByRole("region", { name: "Pending agent actions" }) === null, true);
});

test("pending permission card uses pinned title chrome and detail pass-through", () => {
  const fixture = run({
    decisions: { a: permissionDecision({ detail: "echo live-turn-attention" }) },
  });
  render(emptyDock({ permissions: pendingPermissionsFromRun(fixture) }));
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByRole("region", { name: "Grok wants to run a command" }));
  assert.ok(within(dock).getByText("echo live-turn-attention"));
  assert.ok(within(dock).getByRole("button", { name: "Allow" }));
  assert.ok(within(dock).getByRole("button", { name: "Allow for this session" }));
  assert.ok(within(dock).getByRole("button", { name: "Deny" }));
  assert.equal(screen.queryByRole("button", { name: "Trust this folder" }) === null, true);
});

test("write permission card offers Trust this folder when a workspace can be trusted", () => {
  const fixture = run({
    decisions: { a: permissionDecision({ title: "Write file", detail: "Write: notes.md" }) },
  });
  let trusted = 0;
  render(emptyDock({
    permissions: pendingPermissionsFromRun(fixture),
    onTrustFolder: () => { trusted += 1; },
  }));
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByRole("region", { name: "Grok wants to write a file" }));
  fireEvent.click(within(dock).getByRole("button", { name: "Trust this folder" }));
  assert.equal(trusted, 1);
});

test("mergePendingPermissions drops a settled permission from the dock input", () => {
  const pending = run({ decisions: { a: permissionDecision() } });
  const settled = run({ decisions: { a: permissionDecision({ status: "accepted" }) } });
  const merged = mergePendingPermissions(pendingPermissionsFromRun(pending), settled);
  render(emptyDock({ permissions: merged }));
  assert.equal(screen.queryByRole("region", { name: "Pending agent actions" }) === null, true);
});
