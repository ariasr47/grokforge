import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActionDock } from "./ActionDock.js";
import { mergePendingDiffs, mergePendingPermissions, pendingPermissionsFromRun } from "./runChangeList.js";
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
      diffQueue={[]}
      activeDiffId={null}
      onActiveDiffId={() => undefined}
      oauth={null}
      onPermission={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onAcceptAll={() => undefined}
      onRejectAll={() => undefined}
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
    const allow = within(group).getByRole("button", { name: "Allow" });
    const decline = within(group).getByRole("button", { name: "Decline" });
    assert.equal(allow.hasAttribute("disabled"), true);
    assert.equal(decline.hasAttribute("disabled"), true);
    fireEvent.click(allow);
    fireEvent.click(decline);
    await Promise.resolve();
    assert.equal(permissionCalls, 0);
    assert.equal(diffCalls, 0);
  } finally {
    api.runPermission = originalPermission;
    api.runDiff = originalDiff;
  }
});

test("pending diff fills ActionDock Accept/Reject until settlement", () => {
  const fixture = run({
    activities: { a1: reviewActivity() },
    decisions: { req1: diffDecision({ requestId: "req1" }) },
  });
  const { rerender } = render(
    emptyDock({
      diffQueue: mergePendingDiffs([], fixture),
      activeDiffId: "req1",
    }),
  );
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByRole("button", { name: "Accept" }));
  assert.ok(within(dock).getByRole("button", { name: "Reject" }));
  const settled = run({
    activities: { a1: reviewActivity() },
    decisions: { req1: diffDecision({ requestId: "req1", status: "accepted" }) },
  });
  rerender(emptyDock({ diffQueue: mergePendingDiffs(mergePendingDiffs([], fixture), settled) }));
  assert.equal(screen.queryByRole("region", { name: "Pending agent actions" }), null);
});

test("ActionDock is absent when nothing is pending", () => {
  render(emptyDock());
  assert.equal(screen.queryByRole("region", { name: "Pending agent actions" }), null);
});

test("pending permission card uses pinned title chrome and detail pass-through", () => {
  const fixture = run({
    decisions: { a: permissionDecision({ detail: "echo live-turn-attention" }) },
  });
  render(emptyDock({ permissions: pendingPermissionsFromRun(fixture) }));
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByRole("region", { name: "Allow running a command?" }));
  assert.ok(within(dock).getByText("echo live-turn-attention"));
  assert.ok(within(dock).getByRole("button", { name: "Allow once" }));
  assert.ok(within(dock).getByRole("button", { name: "Always this chat" }));
  assert.ok(within(dock).getByRole("button", { name: "Deny" }));
});

test("mergePendingPermissions drops a settled permission from the dock input", () => {
  const pending = run({ decisions: { a: permissionDecision() } });
  const settled = run({ decisions: { a: permissionDecision({ status: "accepted" }) } });
  const merged = mergePendingPermissions(pendingPermissionsFromRun(pending), settled);
  render(emptyDock({ permissions: merged }));
  assert.equal(screen.queryByRole("region", { name: "Pending agent actions" }), null);
});
