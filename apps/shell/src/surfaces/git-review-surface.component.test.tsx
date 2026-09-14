import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "./RunSurface";
import { CHANGES_DOCK_LABEL, ChangesDock } from "../dock/ChangesDock";
import { projectRunChangeList } from "../projections/runChangeList";
import { projectRunVerifyList } from "../projections/runVerifyList";
import { projectRunGitReviewList } from "../projections/runGitReviewList";
import type { ActivityRecord, RunProjectionRun, RunSnapshot } from "../projections/runReducer";

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

/** Files/Verify/Git moved from RunSurface into the (tabbed) Changes dock in
 *  Task 9 — build the dock from the same production projections. */
function renderChangesDock(fixture: RunProjectionRun, opts: { productMode?: "code" | "chat" } = {}) {
  const productMode = opts.productMode ?? "code";
  if (productMode === "chat") {
    render(
      <ChangesDock
        files={{ state: "ready", members: [] }}
        verify={{ state: "ready", runLive: false, members: [] }}
        git={{ state: "ready", members: [] }}
        diffQueue={[]}
        onAccept={() => undefined}
        onReject={() => undefined}
        onCollapse={() => undefined}
        onOpenReview={() => undefined}
      />,
    );
    return;
  }
  const catchUp = { phase: "closed" as const };
  const filesProjection = projectRunChangeList(fixture, catchUp);
  const verifyProjection = projectRunVerifyList(fixture, catchUp);
  const gitProjection = projectRunGitReviewList(fixture, catchUp);
  // Mirrors App.tsx's own changesActivityStatusById/changesActivityLifecycleById
  // derivation — GitTab's chrome (Running/Not run/Failed/unavailable) reads the
  // real activity status/lifecycle, not just the RunGitReviewMember shape
  // (which deliberately can't distinguish "executed+failed" on its own).
  const activityStatusById = new Map<string, ActivityRecord["status"]>();
  const activityLifecycleById = new Map<string, ActivityRecord["lifecycle"]>();
  const activityOutputById = new Map<string, unknown>();
  for (const activity of Object.values(fixture.activities)) {
    activityStatusById.set(activity.activityId, activity.status);
    activityLifecycleById.set(activity.activityId, activity.lifecycle);
    activityOutputById.set(activity.activityId, activity.output);
  }
  render(
    <ChangesDock
      files={
        filesProjection.state === "ready"
          ? { state: "ready", members: filesProjection.members.map((m) => ({ ...m, runId: fixture.runId })) }
          : { state: "ready", members: [] }
      }
      verify={verifyProjection.state === "ready" ? { state: "ready", runLive: false, members: verifyProjection.members } : { state: "ready", runLive: false, members: [] }}
      git={gitProjection.state === "ready" ? { state: "ready", members: gitProjection.members } : { state: "ready", members: [] }}
      diffQueue={[]}
      activityStatusById={activityStatusById}
      activityLifecycleById={activityLifecycleById}
      activityOutputById={activityOutputById}
      onAccept={() => undefined}
      onReject={() => undefined}
      onCollapse={() => undefined}
      onOpenReview={() => undefined}
    />,
  );
}

function changesRegion() {
  return screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
}

async function openTab(dock: HTMLElement, name: RegExp) {
  const user = userEvent.setup();
  await user.click(within(dock).getByRole("tab", { name }));
}

test("Code run: Files/Verify/Git tabs stay independent; Activity keeps its own place", async () => {
  render(<RunSurface run={triple()} catchUp={{ phase: "closed" }} productMode="code" />);
  const activity = screen.getByLabelText("Activity");
  assert.ok(activity);
  // File changes/Verify/Git review no longer render inside RunSurface at all
  // (Task 9) — they're the Changes dock now, a separate panel App.tsx mounts
  // beside the thread, not ordered against Activity in the same tree.
  assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }) === null, true);
});

test("Chat productMode never gets a Changes dock (AC-26)", () => {
  renderChangesDock(triple(), { productMode: "chat" });
  assert.equal(screen.queryByRole("region", { name: CHANGES_DOCK_LABEL }) === null, true);
});

test("multi-member status+diff on one Git tab without Dirty/Ahead chips (AC-01/02/03)", async () => {
  renderChangesDock(triple());
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("Status"));
  assert.ok(within(dock).getByText("Diff"));
  assert.ok(within(dock).getByText("git status -sb"));
  assert.ok(within(dock).getByText("git diff"));
  assert.equal(within(dock).queryByText(/^Dirty$/i) === null, true);
  assert.equal(within(dock).queryByText(/^Ahead$/i) === null, true);
  assert.equal(within(dock).queryByText(/^Open link$/i) === null, true);
});

test("singleton one-entry Git list is not suppressed (AC-04)", async () => {
  renderChangesDock(run({ activities: { "a-git-status": shellActivity() } }));
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("git status -sb"));
});

test("Git tab Status row paints git status stdout from activity.output", async () => {
  renderChangesDock(run({ activities: { "a-git-status": shellActivity() } }));
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("git status -sb"));
  assert.ok(within(dock).getByText(/M dirty\.txt/));
});

test("Git tab Status row unwraps JSON envelope stdout, not the raw JSON", async () => {
  renderChangesDock(
    run({
      activities: {
        "a-git-status": shellActivity({
          output: JSON.stringify({ stdout: " M dirty.txt\n", stderr: "", exit_code: 0 }),
        }),
      },
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText(/M dirty\.txt/));
  assert.equal(within(dock).queryByText(/"exit_code"/) === null, true);
});

test("executed gh pr is a PR member by durable command; no title/Open link (AC-05)", async () => {
  renderChangesDock(
    run({
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
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("PR"));
  assert.ok(within(dock).getByText("gh pr view"));
  const text = (dock.textContent ?? "").toLowerCase();
  assert.equal(text.includes("open link"), false);
  assert.equal(text.includes("pr ready"), false);
});

test("status/diff without gh pr does not invent a PR member (AC-06)", async () => {
  renderChangesDock(triple());
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.equal(within(dock).queryByText("PR") === null, true);
  assert.equal(within(dock).queryByText("gh pr view") === null, true);
});

test("complete empty including uninspected dirty tree shows no Git evidence, Files/Verify stay (AC-08)", async () => {
  renderChangesDock(
    run({
      activities: {
        "a-edit": writeActivity(),
        "a-verify": verifyActivity(),
      },
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("No git evidence from this run"));
  await openTab(dock, /Files/);
  assert.ok(within(dock).getByText("a.txt"));
  await openTab(dock, /Verify/);
  assert.ok(within(dock).getByText("npm test"));
});

test("successive runs stay isolated (AC-09)", async () => {
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
  renderChangesDock(early);
  let dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("No git evidence from this run"));
  cleanup();

  renderChangesDock(late);
  dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("git status -sb"));
  cleanup();

  renderChangesDock(early);
  dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("No git evidence from this run"));
});

test("catch-up open shows Loading git review… not absent (AC-13)", async () => {
  const catchUp = { phase: "open" as const };
  render(
    <ChangesDock
      files={{ state: "loading" }}
      verify={{ state: "loading" }}
      git={{ state: "loading" }}
      diffQueue={[]}
      onAccept={() => undefined}
      onReject={() => undefined}
      onCollapse={() => undefined}
      onOpenReview={() => undefined}
    />,
  );
  const dock = changesRegion();
  assert.ok(within(dock).getByText("Loading file changes…"));
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("Loading git review…"));
  void catchUp;
});

test("health-poll closed catch-up does not open Loading over a ready list (W3)", async () => {
  renderChangesDock(triple());
  let dock = changesRegion();
  await openTab(dock, /Git/);
  assert.equal(within(dock).queryByText("Loading git review…") === null, true);
  cleanup();
  renderChangesDock(triple());
  dock = changesRegion();
  await openTab(dock, /Git/);
  assert.equal(within(dock).queryByText("Loading git review…") === null, true);
  assert.ok(within(dock).getByText("git status -sb"));
});

test("catch-up failed shows load-failure copy, not empty, no Retry (AC-14)", async () => {
  const message = "Couldn’t load this run’s git review. Activity rows that already loaded stay available.";
  render(
    <ChangesDock
      files={{ state: "ready", members: [] }}
      verify={{ state: "ready", runLive: false, members: [] }}
      git={{ state: "error", message }}
      diffQueue={[]}
      onAccept={() => undefined}
      onReject={() => undefined}
      onCollapse={() => undefined}
      onOpenReview={() => undefined}
    />,
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.equal(within(dock).getByRole("alert").textContent, message);
  assert.equal(within(dock).queryByRole("button", { name: /retry/i }) === null, true);
});

test("mixed list retains unrestorable pr beside restored status (AC-15)", async () => {
  renderChangesDock(
    run({
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
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("git status -sb"));
  assert.ok(within(dock).getByText("gh pr view"));
});

test("File changes / Verify / Git review membership stay on their own tab (AC-16/17/18)", async () => {
  renderChangesDock(triple());
  const dock = changesRegion();
  // Files tab is the default.
  assert.ok(within(dock).getByText("a.txt"));
  assert.equal(within(dock).queryByText("git status -sb") === null, true);
  assert.equal(within(dock).queryByText("npm test") === null, true);

  await openTab(dock, /Verify/);
  assert.ok(within(dock).getByText("npm test"));
  assert.equal(within(dock).queryByText("git status -sb") === null, true);
  assert.equal(within(dock).queryByText("a.txt") === null, true);

  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("git status -sb"));
  assert.equal(within(dock).queryByText("npm test") === null, true);
  assert.equal(within(dock).queryByText("a.txt") === null, true);
});

test("log and show appear on the same Git tab (AC-29)", async () => {
  renderChangesDock(
    run({
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
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("Log"));
  assert.ok(within(dock).getByText("Show"));
});

test("multi-statement && and ; stay off the Git list", async () => {
  // A companion write activity keeps the dock itself visible (Task 9's
  // ChangesDock hides entirely when Files/Verify/Git are all empty — see
  // AC-08's own "Files/Verify stay" pattern above) so this test can assert
  // the Git tab specifically stays empty for a rejected multi-statement shape.
  renderChangesDock(
    run({
      activities: {
        "a-edit": writeActivity(),
        a1: shellActivity({
          activityId: "a1",
          invocationId: "i1",
          command: "git status && git diff",
          input: { command: "git status && git diff" },
        }),
      },
    }),
  );
  let dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("No git evidence from this run"));
  cleanup();

  renderChangesDock(
    run({
      activities: {
        "a-edit": writeActivity(),
        a1: shellActivity({
          activityId: "a1",
          invocationId: "i1",
          command: "git status; git diff",
          input: { command: "git status; git diff" },
        }),
      },
    }),
  );
  dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("No git evidence from this run"));
});

test("Plan fixed-inspection git status may list; invents no Files/Verify member (AC-27)", async () => {
  renderChangesDock(
    run({
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
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("git status --short"));
  await openTab(dock, /Files/);
  assert.ok(within(dock).getByText("No pending file changes"));
  await openTab(dock, /Verify/);
  assert.ok(within(dock).getByText("No verify commands from this run"));
});

test("Running / Not run / Failed / settled-unavailable chrome (AC-33, W-FAIL-BODY, W-AC33D)", async () => {
  renderChangesDock(
    run({
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
    }),
  );
  const dock = changesRegion();
  await openTab(dock, /Git/);
  assert.ok(within(dock).getByText("Running"));
  assert.ok(within(dock).getByText("Not run"));
  assert.ok(within(dock).getByText("Failed"));
  assert.ok(within(dock).getByText("unavailable"));
  assert.equal(within(dock).queryByText("Passed") === null, true);
});
