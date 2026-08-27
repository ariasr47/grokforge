import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "./RunSurface";
import {
  VERIFY_ALL_PASSED,
  VERIFY_HEADER,
  VERIFY_LIVE_GROWING,
  VERIFY_LOAD_FAILURE,
  VERIFY_LOADING,
  VERIFY_UNKNOWN_HELPER,
  VERIFY_VIEW_OUTPUT,
} from "./VerifySection";
import { FILE_CHANGES_HEADER } from "./FileChangesSection";
import type { ActivityRecord, RunProjectionRun, RunSnapshot } from "./runReducer";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a",
  runId: "run-a",
  connectionGeneration: 1,
  state: "terminal",
  acceptedPrompt: "run tests",
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
  activities: {},
  decisions: {},
  seenEventSeq: new Set([1]),
  terminalEventSeq: 4,
  ...overrides,
});

function shellActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "a-verify",
    invocationId: "i-verify",
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { command: "npm test" },
    output: "ok",
    error: null,
    diff: null,
    path: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
    command: "npm test",
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

test("Verify sits after File changes; View output focuses activity identity", async () => {
  const user = userEvent.setup();
  const fixture = run({
    activities: {
      "a-edit": writeActivity(),
      "a-verify": shellActivity({ output: "ok — npm test" }),
    },
  });
  render(<RunSurface run={fixture} catchUp={{ phase: "closed" }} />);
  const file = screen.getByLabelText("File changes");
  const verify = screen.getByLabelText("Verify");
  const activity = screen.getByLabelText("Activity");
  assert.ok(file.compareDocumentPosition(verify) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(verify.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
  await user.click(screen.getByRole("button", { name: /Verify/i }));
  await user.click(screen.getByRole("button", { name: VERIFY_VIEW_OUTPUT }));
  const row = document.querySelector('[data-activity-id="a-verify"]') as HTMLElement | null;
  assert.ok(row);
  assert.ok(row.closest("[data-tool-activity]"));
  assert.ok((row.textContent ?? "").includes("ok — npm test") || (document.querySelector(".tool-activity-body")?.textContent ?? "").includes("ok — npm test"));
});

test("multi-command list names both checks as Passed (AC-01/02/10)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "npm test",
            output: JSON.stringify({ exit_code: 1 }),
          }),
          a2: shellActivity({
            activityId: "a2",
            invocationId: "i2",
            command: "npm run typecheck",
            output: "ok",
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(section).getByText("2"));
  assert.ok(within(section).getByText(/2 passed/));
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("npm test"));
  assert.ok(within(section).getByText("npm run typecheck"));
  assert.equal(within(section).getAllByText("Passed").length, 2);
  assert.equal(within(section).queryByText("Failed"), null);
  assert.equal(within(section).queryByText("Unknown"), null);
  assert.ok(within(section).getByText(VERIFY_ALL_PASSED));
});

test("failed suite is visible as Failed with collapsed {n} failed (AC-03)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "npm test",
            status: "failed",
            output: "fail",
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(section).getByText(/1 failed/));
  assert.equal(within(section).queryByText(VERIFY_ALL_PASSED), null);
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("Failed"));
});

test("settled missing execution is Unknown, not Running (AC-04)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "npm test",
            lifecycle: "terminal",
            execution: null,
            status: "succeeded",
            output: null,
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(section).getByText(/1 unknown/));
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("Unknown"));
  assert.ok(within(section).getByText(VERIFY_UNKNOWN_HELPER));
  assert.equal(within(section).queryByText("Running"), null);
  assert.equal(within(section).queryByText("Passed"), null);
});

test("in-flight member is Running, not Passed/Failed/Unknown (AC-05)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        state: "running",
        terminalKind: null,
        finalAnswer: null,
        answerVouched: false,
        terminalEventSeq: null,
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "npm test",
            lifecycle: "pending",
            execution: null,
            status: "running",
            output: null,
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("Running"));
  assert.equal(within(section).queryByText("Passed"), null);
  assert.equal(within(section).queryByText("Failed"), null);
  assert.equal(within(section).queryByText("Unknown"), null);
  assert.equal(within(section).queryByRole("button", { name: VERIFY_VIEW_OUTPUT }), null);
  assert.ok(screen.getByText(VERIFY_LIVE_GROWING));
  assert.equal(screen.queryByText(VERIFY_ALL_PASSED), null);
});

test("not_executed paints Not run, never Failed (AC-06 fixture)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({
            activityId: "a1",
            invocationId: "i1",
            command: "npm test",
            execution: "not_executed",
            status: "rejected",
            output: JSON.stringify({ error: "User denied shell permission" }),
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("Not run"));
  assert.equal(within(section).queryByText("Failed"), null);
  assert.equal(within(section).queryByText("Passed"), null);
  assert.equal(within(section).queryByText("Unknown"), null);
});

test("complete zero / install-only / chained shell show no Verify section (AC-08/23/25)", () => {
  const { rerender } = render(
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
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);

  rerender(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({ command: "npm install", activityId: "a1", invocationId: "i1" }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);

  rerender(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({ command: "npm test; npm run typecheck", activityId: "a1", invocationId: "i1" }),
          a2: shellActivity({ command: "npm run check-updates", activityId: "a2", invocationId: "i2" }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);
});

test("successive runs stay isolated (AC-09)", () => {
  const early = run({
    runId: "run-early",
    acceptedPrompt: "read only",
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
  });
  const late = run({
    runId: "run-late",
    acceptedPrompt: "run tests later",
    activities: {
      a1: shellActivity({ command: "npx --yes vitest" }),
    },
  });
  const { rerender } = render(<RunSurface run={early} />);
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);
  rerender(<RunSurface run={late} />);
  const lateSection = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(lateSection).getByText("1"));
  rerender(<RunSurface run={early} />);
  assert.equal(screen.queryByRole("region", { name: VERIFY_HEADER }), null);
});

test("live second command grows the list and never claims All checks passed (AC-11)", async () => {
  const user = userEvent.setup();
  const first = run({
    state: "running",
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    terminalEventSeq: null,
    activities: {
      a1: shellActivity({ activityId: "a1", invocationId: "i1", command: "npm test", output: "ok" }),
    },
  });
  const { rerender } = render(<RunSurface run={first} />);
  let section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(section).getByText("1"));
  assert.equal(screen.queryByText(VERIFY_ALL_PASSED), null);
  rerender(
    <RunSurface
      run={{
        ...first,
        activities: {
          ...first.activities,
          a2: shellActivity({
            activityId: "a2",
            invocationId: "i2",
            command: "npm run typecheck",
            lifecycle: "pending",
            execution: null,
            status: "running",
            output: null,
          }),
        },
      }}
    />,
  );
  section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(section).getByText("2"));
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("npm test"));
  assert.ok(within(section).getByText("npm run typecheck"));
  assert.equal(screen.queryByText(VERIFY_ALL_PASSED), null);
});

test("catch-up open shows Loading verify results… not absent (AC-14)", () => {
  render(<RunSurface run={run()} catchUp={{ phase: "open" }} />);
  assert.ok(screen.getByText(VERIFY_LOADING));
  assert.equal(screen.queryByText(VERIFY_ALL_PASSED), null);
});

test("catch-up failed shows load-failure copy, not empty (AC-15)", () => {
  render(
    <RunSurface
      run={run({ activities: { a1: shellActivity() } })}
      catchUp={{ phase: "failed", message: VERIFY_LOAD_FAILURE }}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.equal(within(section).getByRole("alert").textContent, VERIFY_LOAD_FAILURE);
  assert.equal(within(section).queryByRole("button", { name: /retry/i }), null);
  assert.ok(screen.getByLabelText("Activity"));
});

test("mixed list retains Unknown beside Passed (AC-16)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        activities: {
          a1: shellActivity({ activityId: "a1", invocationId: "i1", command: "npm test", output: "ok" }),
          a2: shellActivity({
            activityId: "a2",
            invocationId: "i2",
            command: "npm run typecheck",
            lifecycle: "terminal",
            execution: null,
            status: "failed",
            output: null,
          }),
        },
      })}
    />,
  );
  const section = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(section).getByText("2"));
  await user.click(within(section).getByRole("button", { name: /Verify/i }));
  assert.ok(within(section).getByText("Passed"));
  assert.ok(within(section).getByText("Unknown"));
  assert.ok(within(section).getByText("npm test"));
  assert.ok(within(section).getByText("npm run typecheck"));
});

test("File changes stays edits; Verify stays allowlisted shell (AC-17/18)", async () => {
  const user = userEvent.setup();
  render(
    <RunSurface
      run={run({
        activities: {
          "a-edit": writeActivity(),
          "a-verify": shellActivity(),
        },
      })}
    />,
  );
  const files = screen.getByRole("region", { name: FILE_CHANGES_HEADER });
  const verify = screen.getByRole("region", { name: VERIFY_HEADER });
  assert.ok(within(files).getByText("a.txt"));
  assert.equal(within(files).queryByText("npm test"), null);
  await user.click(within(verify).getByRole("button", { name: /Verify/i }));
  assert.ok(within(verify).getByText("npm test"));
  assert.equal(within(verify).queryByText("a.txt"), null);
});

test("browsing Verify does not call permission, diff, or recovery APIs (AC-19)", async () => {
  const user = userEvent.setup();
  let calls = 0;
  const original = (globalThis as { fetch?: typeof fetch }).fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    render(
      <RunSurface
        run={run({
          activities: {
            "a-edit": writeActivity(),
            "a-verify": shellActivity(),
          },
        })}
      />,
    );
    const verify = screen.getByRole("region", { name: VERIFY_HEADER });
    await user.click(within(verify).getByRole("button", { name: /Verify/i }));
    await user.click(within(verify).getByRole("button", { name: VERIFY_VIEW_OUTPUT }));
    assert.equal(calls, 0);
  } finally {
    if (original) (globalThis as { fetch: typeof fetch }).fetch = original;
    else delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});
