import test from "node:test";
import assert from "node:assert/strict";
import { isVerifyCommand, deriveVerifyMember, chipLabel, projectRunVerifyList, canAllChecksPassed } from "./runVerifyList";
import type { ActivityRecord, RunProjectionRun } from "./runReducer";

test("Option C allowlist membership", () => {
  const inn = [
    "npm test",
    "npm --silent test",
    "npm --silent run test",
    "npm run test",
    "npm run typecheck",
    "npm run check",
    "npm run tsc",
    "npm run test:unit",
    "npm run test-ci",
    "npm run typecheck:app",
    "npx vitest",
    "npx --yes vitest",
    "npx jest",
    "npx tsc",
    "cargo test",
    "cargo check",
    "cargo --quiet test",
  ];
  const out = [
    "npm run --silent test",
    "npm run -s test",
    "npm run -- test",
    "npm run check-updates",
    "npm run check:all",
    "npm run tsc:build",
    "npm run tsc-build",
    "npm install",
    "npm ci",
    "npm publish",
    "npm start",
    "npm run build",
    "cargo build",
    "cargo clippy",
    "pnpm test",
    "yarn test",
    "npm test & npm run typecheck",
    "npm test; npm run typecheck",
    "npm test | tee out",
    "git status",
    "",
  ];
  for (const c of inn) assert.equal(isVerifyCommand(c), true, c);
  for (const c of out) assert.equal(isVerifyCommand(c), false, c);
});

function act(partial: Partial<ActivityRecord> & Pick<ActivityRecord, "activityId" | "invocationId" | "command">): ActivityRecord {
  return {
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    diff: null,
    path: null,
    policy: {},
    automaticEligibility: "not_eligible",
    autoApplied: false,
    editId: null,
    recovery: null,
    ...partial,
  };
}

test("chip priorities: not_executed → Not run; running; pass; fail; settled null → unknown", () => {
  const notRun = deriveVerifyMember(act({
    activityId: "1", invocationId: "1", command: "npm test",
    execution: "not_executed", status: "rejected",
  }));
  assert.equal(notRun.execution, "not_executed");
  assert.equal(notRun.outcome, null);
  assert.equal(chipLabel(notRun), "Not run");

  const running = deriveVerifyMember(act({
    activityId: "2", invocationId: "2", command: "npm test",
    lifecycle: "pending", execution: null, status: "running",
  }));
  assert.equal(running.execution, "pending");
  assert.equal(running.outcome, "running");
  assert.equal(chipLabel(running), "Running");

  const passed = deriveVerifyMember(act({
    activityId: "3", invocationId: "3", command: "npm test",
    execution: "executed", status: "succeeded",
    output: JSON.stringify({ exit_code: 1 }),
  }));
  assert.equal(passed.outcome, "pass");
  assert.equal(chipLabel(passed), "Passed");

  const failed = deriveVerifyMember(act({
    activityId: "4", invocationId: "4", command: "npm test",
    execution: "executed", status: "failed",
  }));
  assert.equal(failed.outcome, "fail");
  assert.equal(chipLabel(failed), "Failed");

  const unknown = deriveVerifyMember(act({
    activityId: "5", invocationId: "5", command: "npm test",
    lifecycle: "terminal", execution: null, status: "succeeded",
  }));
  assert.equal(unknown.outcome, "unknown");
  assert.equal(unknown.outcomeUnavailable, true);
  assert.notEqual(unknown.execution, "pending");
  assert.equal(chipLabel(unknown), "Unknown");

  // GATE Z: fold must NOT reclassify executed+failed deny journals
  const legacyDeny = deriveVerifyMember(act({
    activityId: "6", invocationId: "6", command: "npm test",
    execution: "executed", status: "failed",
    output: JSON.stringify({ error: "User denied shell permission" }),
  }));
  assert.equal(legacyDeny.outcome, "fail");
  assert.equal(legacyDeny.execution, "executed");
  assert.equal(chipLabel(legacyDeny), "Failed");
});

function runFixture(partial: Partial<RunProjectionRun> & Pick<RunProjectionRun, "runId" | "sessionId">): RunProjectionRun {
  return {
    connectionGeneration: 1,
    state: "terminal",
    acceptedPrompt: "p",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: {},
    model: {},
    terminalKind: "answered",
    finalAnswer: "ok",
    answerVouched: true,
    failure: null,
    reasoning: {},
    message: {},
    answer: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: 1,
    ...partial,
  };
}

test("catch-up open → loading; failed → error; complete zero → absent; members → ready", () => {
  const empty = runFixture({ runId: "r", sessionId: "s" });
  assert.equal(projectRunVerifyList(empty, { phase: "open" }).state, "loading");
  const err = projectRunVerifyList(empty, { phase: "failed" });
  assert.equal(err.state, "error");
  if (err.state === "error") assert.match(err.message, /verify results/);
  assert.equal(projectRunVerifyList(empty, { phase: "closed" }).state, "absent");

  const withMember = runFixture({
    runId: "r",
    sessionId: "s",
    state: "running",
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    activities: {
      a1: act({ activityId: "a1", invocationId: "i1", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
    },
  });
  const ready = projectRunVerifyList(withMember, { phase: "closed" });
  assert.equal(ready.state, "ready");
  if (ready.state === "ready") {
    assert.equal(ready.members.length, 1);
    assert.equal(ready.runLive, true);
  }
});

test("health-poll closed catch-up does not open loading over ready (W3)", () => {
  const withMember = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({ activityId: "a1", invocationId: "i1", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
    },
  });
  assert.equal(projectRunVerifyList(withMember, { phase: "closed" }).state, "ready");
});

test("npm install alone → absent; mixed unknown retained", () => {
  const installOnly = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({ activityId: "a1", invocationId: "i1", command: "npm install", execution: "executed", status: "succeeded", output: "ok" }),
    },
  });
  assert.equal(projectRunVerifyList(installOnly, { phase: "closed" }).state, "absent");

  const mixed = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({ activityId: "a1", invocationId: "i1", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
      a2: act({ activityId: "a2", invocationId: "i2", command: "npm run typecheck", lifecycle: "terminal", execution: null, status: "failed" }),
    },
  });
  const proj = projectRunVerifyList(mixed, { phase: "closed" });
  assert.equal(proj.state, "ready");
  if (proj.state === "ready") {
    assert.equal(proj.members.length, 2);
    assert.ok(proj.members.some((m) => m.outcome === "pass"));
    assert.ok(proj.members.some((m) => m.outcome === "unknown" && m.outcomeUnavailable));
  }
});

test("All checks passed gate: forbidden while runLive", () => {
  const live = projectRunVerifyList(
    runFixture({
      runId: "r",
      sessionId: "s",
      state: "running",
      terminalKind: null,
      finalAnswer: null,
      answerVouched: false,
      activities: {
        a1: act({ activityId: "a1", invocationId: "i1", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
      },
    }),
    { phase: "closed" },
  );
  assert.equal(canAllChecksPassed(live), false);
});

test("All checks passed allowed only when terminal and every member Passed", () => {
  const terminal = projectRunVerifyList(
    runFixture({
      runId: "r",
      sessionId: "s",
      activities: {
        a1: act({ activityId: "a1", invocationId: "i1", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
      },
    }),
    { phase: "closed" },
  );
  assert.equal(canAllChecksPassed(terminal), true);

  const mixed = projectRunVerifyList(
    runFixture({
      runId: "r",
      sessionId: "s",
      activities: {
        a1: act({ activityId: "a1", invocationId: "i1", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
        a2: act({ activityId: "a2", invocationId: "i2", command: "npm run typecheck", execution: "executed", status: "failed" }),
      },
    }),
    { phase: "closed" },
  );
  assert.equal(canAllChecksPassed(mixed), false);
});

test("file-edit activities never become Verify members; verify shell never needs editId", () => {
  const editsOnly = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      e1: act({
        activityId: "e1",
        invocationId: "i1",
        name: "write_file",
        command: null,
        path: "src/a.ts",
        editId: "edit-1",
        automaticEligibility: "text_edit",
        autoApplied: true,
        diff: "--- a\n+++ b",
      }),
    },
  });
  assert.equal(projectRunVerifyList(editsOnly, { phase: "closed" }).state, "absent");
});

test("two runs stay isolated; singleton is ready not absent", () => {
  const early = projectRunVerifyList(
    runFixture({
      runId: "r1",
      sessionId: "s",
      activities: {
        a1: act({ activityId: "a1", invocationId: "i1", command: "npm install", execution: "executed", status: "succeeded" }),
      },
    }),
    { phase: "closed" },
  );
  const late = projectRunVerifyList(
    runFixture({
      runId: "r2",
      sessionId: "s",
      activities: {
        a2: act({ activityId: "a2", invocationId: "i2", command: "npm test", execution: "executed", status: "succeeded", output: "ok" }),
      },
    }),
    { phase: "closed" },
  );
  assert.equal(early.state, "absent");
  assert.equal(late.state, "ready");
  if (late.state === "ready") {
    assert.equal(late.members.length, 1);
    assert.equal(late.members[0]!.command, "npm test");
  }
});

test("dedupe updates the same activity/invocation in place", () => {
  const first = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({
        activityId: "a1",
        invocationId: "i1",
        command: "npm test",
        lifecycle: "pending",
        execution: null,
        status: "running",
      }),
    },
  });
  const running = projectRunVerifyList(first, { phase: "closed" });
  assert.equal(running.state, "ready");
  if (running.state === "ready") {
    assert.equal(running.members.length, 1);
    assert.equal(running.members[0]!.outcome, "running");
  }
  const settled = projectRunVerifyList(
    {
      ...first,
      activities: {
        a1: act({
          activityId: "a1",
          invocationId: "i1",
          command: "npm test",
          execution: "executed",
          status: "succeeded",
          output: "ok",
        }),
      },
    },
    { phase: "closed" },
  );
  assert.equal(settled.state, "ready");
  if (settled.state === "ready") {
    assert.equal(settled.members.length, 1);
    assert.equal(settled.members[0]!.outcome, "pass");
  }
});
