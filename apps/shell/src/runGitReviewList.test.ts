import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGitReviewCommand,
  deriveGitReviewMember,
  gitReviewRowChrome,
  bodyRestored,
  projectRunGitReviewList,
} from "./runGitReviewList";
import { isVerifyCommand } from "./runVerifyList";
import type { ActivityRecord, RunProjectionRun } from "./runReducer";

test("verification-git + gh pr shape membership", () => {
  const inn: Array<[string, string]> = [
    ["git status", "status"],
    ["git status -sb", "status"],
    ["git STATUS", "status"],
    ["git diff", "diff"],
    ["git diff --stat", "diff"],
    ["git log -n 5", "log"],
    ["git show HEAD", "show"],
    ["git.exe status", "status"],
    ["gh pr view", "pr"],
    ["gh PR status", "pr"],
    ["gh pr create --title x", "pr"],
  ];
  for (const [c, kind] of inn) {
    assert.equal(classifyGitReviewCommand(c), kind, c);
  }
  const out = [
    "git",
    "git push",
    "git push --force",
    "git pull",
    "git commit -m x",
    "git status && git diff",
    "git status; git diff",
    "git status | cat",
    "git status\ngit diff",
    "gh issue list",
    "gh --repo o/n pr view",
    "npm test",
    "npm run typecheck",
    "",
  ];
  for (const c of out) assert.equal(classifyGitReviewCommand(c), null, c);
});

function act(
  partial: Partial<ActivityRecord> & Pick<ActivityRecord, "activityId" | "invocationId" | "command">,
): ActivityRecord {
  return {
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: {},
    output: "ok",
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

test("execution chrome: Not run / Running / Failed / unavailable / ok", () => {
  const notRun = deriveGitReviewMember(act({
    activityId: "1", invocationId: "1", command: "git status",
    execution: "not_executed", status: "rejected", output: null,
  }), "status");
  assert.equal(notRun.execution, "not_executed");
  assert.equal(notRun.evidenceUnavailable, false);
  assert.equal(gitReviewRowChrome(notRun, "rejected", "terminal"), "Not run");

  const running = deriveGitReviewMember(act({
    activityId: "2", invocationId: "2", command: "git status",
    lifecycle: "pending", execution: null, status: "running", output: null,
  }), "status");
  assert.equal(running.execution, "pending");
  assert.equal(running.evidenceUnavailable, false);
  assert.equal(gitReviewRowChrome(running, "running", "pending"), "Running");
  // W-AC33D: in-flight null output is Running, not unavailable
  assert.notEqual(gitReviewRowChrome(running, "running", "pending"), "unavailable");

  // W-FAIL-BODY: executed+failed + null output → Failed, evidenceUnavailable false
  const failed = deriveGitReviewMember(act({
    activityId: "3", invocationId: "3", command: "git diff",
    execution: "executed", status: "failed", output: null, error: null,
  }), "diff");
  assert.equal(failed.execution, "executed");
  assert.equal(failed.evidenceUnavailable, false);
  assert.equal(gitReviewRowChrome(failed, "failed", "terminal"), "Failed");

  const settledNull = deriveGitReviewMember(act({
    activityId: "4", invocationId: "4", command: "git status",
    lifecycle: "terminal", execution: null, status: "succeeded", output: null,
  }), "status");
  assert.equal(settledNull.execution, "executed");
  assert.equal(settledNull.evidenceUnavailable, true);
  assert.equal(gitReviewRowChrome(settledNull, "succeeded", "terminal"), "unavailable");

  const ok = deriveGitReviewMember(act({
    activityId: "5", invocationId: "5", command: "git status",
    execution: "executed", status: "succeeded", output: "clean",
  }), "status");
  assert.equal(ok.evidenceUnavailable, false);
  assert.equal(gitReviewRowChrome(ok, "succeeded", "terminal"), "ok");
});

test("bodyRestored: output or non-empty error", () => {
  assert.equal(bodyRestored(act({ activityId: "a", invocationId: "a", command: "git status", output: "x" })), true);
  assert.equal(bodyRestored(act({ activityId: "b", invocationId: "b", command: "git status", output: null, error: "boom" })), true);
  assert.equal(bodyRestored(act({ activityId: "c", invocationId: "c", command: "git status", output: null, error: null })), false);
  assert.equal(bodyRestored(act({ activityId: "d", invocationId: "d", command: "git status", output: null, error: "" })), false);
});

function runFixture(
  partial: Partial<RunProjectionRun> & Pick<RunProjectionRun, "runId" | "sessionId">,
): RunProjectionRun {
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
  assert.equal(projectRunGitReviewList(empty, { phase: "open" }).state, "loading");
  const err = projectRunGitReviewList(empty, { phase: "failed" });
  assert.equal(err.state, "error");
  if (err.state === "error") assert.match(err.message, /git review/);
  assert.equal(projectRunGitReviewList(empty, { phase: "closed" }).state, "absent");

  const withMember = runFixture({
    runId: "r",
    sessionId: "s",
    state: "running",
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    activities: {
      a1: act({
        activityId: "a1", invocationId: "i1", command: "git status",
        execution: "executed", status: "succeeded", output: "ok",
      }),
    },
  });
  const ready = projectRunGitReviewList(withMember, { phase: "closed" });
  assert.equal(ready.state, "ready");
  if (ready.state === "ready") {
    assert.equal(ready.members.length, 1);
    assert.equal(ready.members[0]!.kind, "status");
    assert.equal(ready.runLive, true);
  }
});

test("W3: closed catch-up does not open loading over ready", () => {
  const withMember = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({
        activityId: "a1", invocationId: "i1", command: "git diff",
        execution: "executed", status: "succeeded", output: "ok",
      }),
    },
  });
  assert.equal(projectRunGitReviewList(withMember, { phase: "closed" }).state, "ready");
});

test("multi-statement excluded; PR only when executed terminal; unrestorable pr retained", () => {
  const chain = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({
        activityId: "a1", invocationId: "i1", command: "git status && git diff",
        execution: "executed", status: "succeeded", output: "ok",
      }),
    },
  });
  assert.equal(projectRunGitReviewList(chain, { phase: "closed" }).state, "absent");

  const prPending = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({
        activityId: "a1", invocationId: "i1", command: "gh pr view",
        lifecycle: "pending", execution: null, status: "running", output: null,
      }),
    },
  });
  assert.equal(projectRunGitReviewList(prPending, { phase: "closed" }).state, "absent");

  const prMissingBody = runFixture({
    runId: "r",
    sessionId: "s",
    activities: {
      a1: act({
        activityId: "a1", invocationId: "i1", command: "git status",
        execution: "executed", status: "succeeded", output: "ok",
      }),
      a2: act({
        activityId: "a2", invocationId: "i2", command: "gh pr view",
        lifecycle: "terminal", execution: "executed", status: "succeeded", output: null,
      }),
    },
  });
  const mixed = projectRunGitReviewList(prMissingBody, { phase: "closed" });
  assert.equal(mixed.state, "ready");
  if (mixed.state === "ready") {
    assert.equal(mixed.members.length, 2);
    const pr = mixed.members.find((m) => m.kind === "pr")!;
    assert.equal(pr.evidenceUnavailable, true);
  }
});

test("sibling exclusion: verify commands and edits stay out; git stays out of verify", () => {
  assert.equal(isVerifyCommand("git status"), false);
  assert.equal(isVerifyCommand("npm test"), true);
  assert.equal(classifyGitReviewCommand("npm test"), null);
});
