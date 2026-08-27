import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "./RunSurface";
import {
  GIT_REVIEW_HEADER,
  GIT_REVIEW_HELPER,
  GIT_REVIEW_LIVE_GROWING,
  GIT_REVIEW_LOAD_FAILURE,
  GIT_REVIEW_LOADING,
  GIT_REVIEW_UNAVAILABLE,
  GIT_REVIEW_VIEW_OUTPUT,
} from "./GitReviewSection";
import { FILE_CHANGES_HEADER } from "./FileChangesSection";
import { VERIFY_HEADER } from "./VerifySection";
import type { ActivityRecord, RunProjectionRun, RunSnapshot } from "./runReducer";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a",
  runId: "run-a",
  connectionGeneration: 1,
  state: "terminal",
  acceptedPrompt: "inspect git",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 4,
  policy: { effectiveMode: "trusted_workspace" },
  model: { id: "grok-4.6" },
  terminalKind: "answered",
  finalAnswer: "done",
  answerVouched: true,
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
  terminalEventSeq: 4,
  ...overrides,
});

function shellActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-git-status",
    invocationId: "i-git-status",
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { command: "git status -sb" },
    output: "## main\n M dirty.txt\n",
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
    command: "git status -sb",
    editId: null,
    recovery: null,
    ...overrides,
  };
}

function writeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-edit",
    invocationId: "i-edit",
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

function verifyActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return shellActivity({
    activityId: "a-verify",
    invocationId: "i-verify",
    command: "npm test",
    input: { command: "npm test" },
    output: "ok — npm test",
    automaticEligibility: "trusted_command_class",
    ...overrides,
  });
}

const triple = (): RunProjectionRun =>
  run({
    activities: {
      "a-edit": writeActivity(),
      "a-verify": verifyActivity(),
      "a-git-status": shellActivity(),
      "a-git-diff": shellActivity({
        activityId: "a-git-diff",
        invocationId: "i-git-diff",
        command: "git diff",
        input: { command: "git diff" },
        output: "diff --git a/dirty.txt b/dirty.txt\n",
      }),
    },
  });

test("Code run: File changes → Verify → Git review → Activity; View output focuses identity", async () => {
  const user = userEvent.setup();
  render(<RunSurface run={triple()} catchUp={{ phase: "closed" }} productMode="code" />);
  const file = screen.getByLabelText("File changes");
  const verify = screen.getByLabelText("Verify");
  const git = screen.getByLabelText("Git review");
  const activity = screen.getByLabelText("Activity");
  assert.ok(file.compareDocumentPosition(verify) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(verify.compareDocumentPosition(git) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(git.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
  await user.click(within(git).getByRole("button", { name: /Git review/i }));
  const viewButtons = within(git).getAllByRole("button", { name: GIT_REVIEW_VIEW_OUTPUT });
  await user.click(viewButtons[0]!);
  const row = document.querySelector('[data-activity-id="a-git-status"]') as HTMLElement | null;
  assert.ok(row);
  assert.ok(row.closest("[data-tool-activity]"));
  assert.ok((row.textContent ?? document.querySelector(".tool-activity-body")?.textContent ?? "").includes("M dirty.txt"));
});

test("Chat productMode never mounts Git review (AC-26)", () => {
  const { container } = render(
    <RunSurface run={triple()} catchUp={{ phase: "closed" }} productMode="chat" />,
  );
  assert.equal(container.querySelector("[aria-label='Git review']"), null);
  assert.equal(screen.queryByLabelText("File changes"), null);
  assert.equal(screen.queryByLabelText("Verify"), null);
});

test("multi-member status+diff on one list without Dirty/Ahead chips (AC-01/02/03)", async () => {
  const user = userEvent.setup();
  render(<RunSurface run={triple()} productMode="code" />);
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(section).getByText("2"));
  assert.ok(within(section).getByText(/1 status/i));
  assert.ok(within(section).getByText(/1 diff/i));
  await user.click(within(section).getByRole("button", { name: /Git review/i }));
  assert.ok(within(section).getByText("Status"));
  assert.ok(within(section).getByText("Diff"));
  assert.ok(within(section).getByText("git status -sb"));
  assert.ok(within(section).getByText("git diff"));
  const text = (section.textContent ?? "").toLowerCase();
  assert.equal(text.includes("dirty"), false);
  assert.equal(text.includes("ahead"), false);
  assert.equal(text.includes("passed"), false);
  assert.equal(text.includes("open link"), false);
});

test("singleton one-entry list is not suppressed (AC-04)", () => {
  render(
    <RunSurface
      productMode="code"
      run={run({
        activities: { "a-git-status": shellActivity() },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(section).getByText("1"));
  assert.equal(screen.queryByText("0"), null);
});

test("executed gh pr is a PR member by durable command; no title/Open link (AC-05)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          "a-git-status": shellActivity(),
          "a-pr": shellActivity({
            activityId: "a-pr",
            invocationId: "i-pr",
            command: "gh pr view",
            input: { command: "gh pr view" },
            output: "title:\tDemo PR\n",
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  await user.click(within(section).getByRole("button", { name: /Git review/i }));
  assert.ok(within(section).getByText("PR"));
  assert.ok(within(section).getByText("gh pr view"));
  const text = (section.textContent ?? "").toLowerCase();
  assert.equal(text.includes("open link"), false);
  assert.equal(text.includes("pr ready"), false);
});

test("status/diff without gh pr does not invent a PR member (AC-06)", async () => {
  const user = userEvent.setup();
  render(<RunSurface run={triple()} productMode="code" />);
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  await user.click(within(section).getByRole("button", { name: /Git review/i }));
  assert.equal(within(section).queryByText("PR"), null);
  assert.equal(within(section).queryByText("gh pr view"), null);
});

test("complete empty including uninspected dirty tree shows no Git review (AC-08)", () => {
  render(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          "a-edit": writeActivity(),
          "a-verify": verifyActivity(),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: GIT_REVIEW_HEADER }), null);
  assert.ok(screen.getByRole("region", { name: FILE_CHANGES_HEADER }));
  assert.ok(screen.getByRole("region", { name: VERIFY_HEADER }));
});

test("successive runs stay isolated (AC-09)", () => {
  const early = run({
    runId: "run-early",
    acceptedPrompt: "read only",
    activities: { "a-edit": writeActivity() },
  });
  const late = run({
    runId: "run-late",
    acceptedPrompt: "inspect later",
    activities: { "a-git-status": shellActivity() },
  });
  const { rerender } = render(<RunSurface run={early} productMode="code" />);
  assert.equal(screen.queryByRole("region", { name: GIT_REVIEW_HEADER }), null);
  rerender(<RunSurface run={late} productMode="code" />);
  const lateSection = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(lateSection).getByText("1"));
  rerender(<RunSurface run={early} productMode="code" />);
  assert.equal(screen.queryByRole("region", { name: GIT_REVIEW_HEADER }), null);
});

test("live second member grows the list without final clean/PR-ready copy (AC-10)", async () => {
  const user = userEvent.setup();
  const first = run({
    state: "running",
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    terminalEventSeq: null,
    activities: { "a-git-status": shellActivity() },
  });
  const { rerender } = render(<RunSurface run={first} productMode="code" />);
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(section).getByText("1"));
  assert.ok(screen.getByText(GIT_REVIEW_LIVE_GROWING));
  rerender(
    <RunSurface
      productMode="code"
      run={run({
        state: "running",
        terminalKind: null,
        finalAnswer: null,
        answerVouched: false,
        terminalEventSeq: null,
        activities: {
          "a-git-status": shellActivity(),
          "a-git-diff": shellActivity({
            activityId: "a-git-diff",
            invocationId: "i-git-diff",
            command: "git diff",
            input: { command: "git diff" },
            output: "diff --git a/dirty.txt b/dirty.txt\n",
          }),
        },
      })}
    />,
  );
  const grown = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(grown).getByText("2"));
  await user.click(within(grown).getByRole("button", { name: /Git review/i }));
  assert.ok(within(grown).getByText("git status -sb"));
  assert.ok(within(grown).getByText("git diff"));
  const text = (grown.textContent ?? "").toLowerCase();
  assert.equal(text.includes("working tree clean"), false);
  assert.equal(text.includes("pr ready"), false);
  assert.equal(text.includes("git review complete"), false);
});

test("catch-up open shows Loading git review… not absent (AC-13)", () => {
  render(<RunSurface run={run()} catchUp={{ phase: "open" }} productMode="code" />);
  assert.ok(screen.getByText(GIT_REVIEW_LOADING));
  assert.equal(screen.queryByText(GIT_REVIEW_HELPER), null);
});

test("health-poll closed catch-up does not open Loading over a ready list (W3)", () => {
  const { rerender } = render(
    <RunSurface run={triple()} catchUp={{ phase: "closed" }} productMode="code" />,
  );
  assert.ok(screen.getByRole("region", { name: GIT_REVIEW_HEADER }));
  assert.equal(screen.queryByText(GIT_REVIEW_LOADING), null);
  rerender(<RunSurface run={triple()} catchUp={{ phase: "closed" }} productMode="code" />);
  assert.ok(screen.getByRole("region", { name: GIT_REVIEW_HEADER }));
  assert.equal(screen.queryByText(GIT_REVIEW_LOADING), null);
});

test("catch-up failed shows load-failure copy, not empty, no Retry (AC-14)", () => {
  render(
    <RunSurface
      run={triple()}
      catchUp={{ phase: "failed" }}
      productMode="code"
    />,
  );
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.equal(within(section).getByRole("alert").textContent, GIT_REVIEW_LOAD_FAILURE);
  assert.equal(screen.queryByRole("button", { name: /retry/i }), null);
  assert.ok(screen.getByLabelText("Activity"));
});

test("mixed list retains unrestorable pr beside restored status (AC-15)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          "a-git-status": shellActivity(),
          "a-pr": shellActivity({
            activityId: "a-pr",
            invocationId: "i-pr",
            command: "gh pr view",
            input: { command: "gh pr view" },
            output: null,
            error: null,
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(section).getByText("2"));
  await user.click(within(section).getByRole("button", { name: /Git review/i }));
  assert.ok(within(section).getByText("git status -sb"));
  assert.ok(within(section).getByText("gh pr view"));
  assert.ok(within(section).getByText(GIT_REVIEW_UNAVAILABLE));
  assert.equal(screen.queryByText(GIT_REVIEW_LOAD_FAILURE), null);
});

test("File changes / Verify / Git review membership stay separate (AC-16/17/18)", async () => {
  const user = userEvent.setup();
  render(<RunSurface run={triple()} productMode="code" />);
  const file = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  const verify = screen.getByRole("region", { name: VERIFY_HEADER });
  const git = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  assert.ok(within(file).getByText("a.txt"));
  assert.equal(within(file).queryByText("git status -sb"), null);
  assert.equal(within(file).queryByText("npm test"), null);
  await user.click(within(verify).getByRole("button", { name: /Verify/i }));
  assert.ok(within(verify).getByText("npm test"));
  assert.equal(within(verify).queryByText("git status -sb"), null);
  assert.equal(within(verify).queryByText("a.txt"), null);
  await user.click(within(git).getByRole("button", { name: /Git review/i }));
  assert.ok(within(git).getByText("git status -sb"));
  assert.equal(within(git).queryByText("npm test"), null);
  assert.equal(within(git).queryByText("a.txt"), null);
});

test("browsing Git review does not call permission/diff/recovery APIs (AC-19)", async () => {
  const user = userEvent.setup();
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    render(<RunSurface run={triple()} productMode="code" />);
    const git = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
    await user.click(within(git).getByRole("button", { name: /Git review/i }));
    await user.click(within(git).getAllByRole("button", { name: GIT_REVIEW_VIEW_OUTPUT })[0]!);
    assert.equal(paths.some((p) => p.includes("/api/permission")), false);
    assert.equal(paths.some((p) => p.includes("/api/diff")), false);
    assert.equal(paths.some((p) => p.includes("/api/edit-recovery")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("log and show appear on the same list (AC-29)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          "a-log": shellActivity({
            activityId: "a-log",
            invocationId: "i-log",
            command: "git log -n 1",
            input: { command: "git log -n 1" },
            output: "commit abc\n",
          }),
          "a-show": shellActivity({
            activityId: "a-show",
            invocationId: "i-show",
            command: "git show HEAD",
            input: { command: "git show HEAD" },
            output: "diff --git a/x b/x\n",
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  await user.click(within(section).getByRole("button", { name: /Git review/i }));
  assert.ok(within(section).getByText("Log"));
  assert.ok(within(section).getByText("Show"));
});

test("multi-statement && and ; stay off the list (AC-30)", () => {
  const { rerender } = render(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "git status && git diff",
            input: { command: "git status && git diff" },
          }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: GIT_REVIEW_HEADER }), null);
  assert.ok(screen.getByLabelText("Activity"));
  rerender(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "git status; git diff",
            input: { command: "git status; git diff" },
          }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: GIT_REVIEW_HEADER }), null);
});

test("Plan fixed-inspection git status may list; invents no File changes/Verify (AC-27)", () => {
  render(
    <RunSurface
      productMode="code"
      run={run({
        activities: {
          "a-fixed": shellActivity({
            activityId: "a-fixed",
            invocationId: "i-fixed",
            command: "git status --short",
            input: { command: "git status --short" },
            automaticEligibility: "fixed_inspection",
            autoApplied: true,
            output: " M apps/shell/src/App.tsx\n",
          }),
        },
      })}
    />,
  );
  assert.ok(screen.getByRole("region", { name: GIT_REVIEW_HEADER }));
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);
});

test("Running / Not run / Failed / settled-unavailable chrome (AC-33, W-FAIL-BODY, W-AC33D)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      productMode="code"
      run={run({
        state: "running",
        terminalKind: null,
        finalAnswer: null,
        answerVouched: false,
        terminalEventSeq: null,
        activities: {
          "a-run": shellActivity({
            activityId: "a-run",
            invocationId: "i-run",
            command: "git status",
            lifecycle: "pending",
            execution: null,
            status: "running",
            output: null,
          }),
          "a-skip": shellActivity({
            activityId: "a-skip",
            invocationId: "i-skip",
            command: "git log -n 1",
            execution: "not_executed",
            status: "rejected",
            output: null,
          }),
          "a-fail": shellActivity({
            activityId: "a-fail",
            invocationId: "i-fail",
            command: "git diff",
            execution: "executed",
            status: "failed",
            output: null,
            error: null,
          }),
          "a-miss": shellActivity({
            activityId: "a-miss",
            invocationId: "i-miss",
            command: "git show HEAD",
            lifecycle: "terminal",
            execution: null,
            status: "succeeded",
            output: null,
            error: null,
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: GIT_REVIEW_HEADER });
  await user.click(within(section).getByRole("button", { name: /Git review/i }));
  assert.ok(within(section).getByText("Running"));
  assert.ok(within(section).getByText("Not run"));
  assert.ok(within(section).getByText("Failed"));
  assert.ok(within(section).getByText(GIT_REVIEW_UNAVAILABLE));
  assert.equal(within(section).queryByText("Passed"), null);
  const viewButtons = within(section).getAllByRole("button", { name: GIT_REVIEW_VIEW_OUTPUT });
  // Running with null output omits View output; Not run / Failed / unavailable keep it.
  assert.equal(viewButtons.length, 3);
});
