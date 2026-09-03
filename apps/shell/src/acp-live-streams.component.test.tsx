import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { midturnFoldedIntoAnswer, RunSurface } from "./RunSurface";
import { ThreadHeader } from "./ThreadHeader";
import { composerFooterPhaseText, deriveLivePhase, statusBarPhaseText } from "./derivedLivePhase";
import type { ActivityRecord, RunProjectionRun, RunSnapshot } from "./runReducer";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "s1",
  runId: "r1",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "do the work",
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

function run(overrides: Partial<RunProjectionRun> = {}): RunProjectionRun {
  return {
    ...snapshot,
    reasoning: {},
    answer: {},
    message: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: null,
    ...overrides,
  };
}

function readActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activityId: "read-1",
    invocationId: "read-1",
    name: "read_file",
    lifecycle: "pending",
    execution: null,
    status: "running",
    input: { path: "notes.md" },
    output: null,
    error: null,
    diff: null,
    path: "notes.md",
    policy: {},
    automaticEligibility: "read",
    autoApplied: false,
    command: null,
    editId: null,
    recovery: null,
    summary: "Read notes.md",
    title: "Reading notes.md",
    ...overrides,
  };
}

test("reasoning present → Thought disclosure; not inside Answer article", () => {
  render(<RunSurface run={run({ reasoning: { r: "private thought" }, state: "running" })} />);
  assert.ok(screen.getByText("Thought…"));
  assert.ok(screen.getByText("private thought"));
  assert.equal(screen.queryByRole("article", { name: "Assistant answer" }), null);
  const thought = screen.getByText("Thought…").closest("details");
  const answer = screen.queryByRole("article", { name: "Assistant answer" });
  assert.ok(thought);
  assert.equal((thought as HTMLDetailsElement).open, true);
  assert.equal(answer, null);
});

test("settled thought uses Thought summary and stays foldable", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "done",
    reasoning: { r: "why" },
  })} />);
  assert.ok(screen.getByText("Thought"));
  assert.equal(screen.queryByText("Thought…"), null);
  assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
  assert.equal(screen.getByRole("article", { name: "Assistant answer" }).textContent?.includes("why"), false);
  const thought = screen.getByText("Thought").closest("details");
  assert.equal((thought as HTMLDetailsElement | null)?.open, false);
});

test("message present + not yet vouched → mid-turn region with non-Answer chrome", () => {
  render(<RunSurface run={run({ message: { m: "streaming words" }, state: "running" })} />);
  const mid = screen.getByLabelText("Mid-turn narration");
  assert.ok(mid);
  assert.ok(mid.textContent?.includes("streaming words"));
  assert.equal(mid.getAttribute("aria-label"), "Mid-turn narration");
  assert.equal(screen.queryByRole("article", { name: "Assistant answer" }), null);
  assert.equal(mid.classList.contains("assistant-answer"), false);
});

test("vouched identical mid-turn omits Earlier — Answer is enough", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "streaming words",
    message: { m: "streaming words" },
  })} />);
  const answer = screen.getByRole("article", { name: "Assistant answer" });
  assert.ok(answer.textContent?.includes("streaming words"));
  assert.equal(screen.queryByLabelText("Mid-turn narration"), null);
});

test("Earlier is omitted when the vouched answer already contains the mid-turn and more", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "I'll write docs/dogfood/GAP.md.\n\nCreated docs/dogfood/GAP.md.",
    message: { m: "I'll write docs/dogfood/GAP.md." },
  })} />);
  assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
  assert.equal(screen.queryByLabelText("Mid-turn narration"), null);
});

test("whitespace-normalized duplicate mid-turn omits Earlier", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "Creating EARLIER.md.\n\nCreated EARLIER.md.",
    message: { m: "Creating EARLIER.md. \n Created EARLIER.md." },
  })} />);
  assert.equal(screen.queryByLabelText("Mid-turn narration"), null);
});

test("unique extra mid-turn paragraph keeps Earlier", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "Created EARLIER.md.",
    message: { m: "I'll inspect the repo first.\n\nCreated EARLIER.md." },
  })} />);
  const mid = screen.getByLabelText("Mid-turn narration");
  assert.ok(mid.textContent?.includes("I'll inspect the repo first."));
  assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
});

test("midturnFoldedIntoAnswer: equal / subset fold, unique paragraph does not", () => {
  assert.equal(midturnFoldedIntoAnswer("pong", "pong", true), true);
  assert.equal(midturnFoldedIntoAnswer("I'll write X.", "I'll write X.\n\nCreated X.", true), true);
  assert.equal(midturnFoldedIntoAnswer("Creating X.\n\nCreated X.", "Creating X.\n\nCreated X. Done.", true), true);
  assert.equal(midturnFoldedIntoAnswer("Creating X. \n Created X.", "Creating X.\n\nCreated X.", true), true);
  assert.equal(
    midturnFoldedIntoAnswer(
      "I'll create docs/dogfood/EARLIER.md with only EARLIER-OK, then stop.",
      "I'll create `docs/dogfood/EARLIER.md` with only `EARLIER-OK`, then stop.\n\nCreated it.",
      true,
    ),
    true,
  );
  assert.equal(midturnFoldedIntoAnswer("secret aside\n\nCreated X.", "Created X.", true), false);
  assert.equal(midturnFoldedIntoAnswer("streaming words", "streaming words", false), false);
  assert.equal(midturnFoldedIntoAnswer("streaming words", null, true), false);
});

test("Earlier is omitted when answer wraps the mid-turn in markdown ticks", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "I'll create `docs/dogfood/EARLIER.md` with only `EARLIER-OK`, then stop.\n\nCreated it.",
    message: { m: "I'll create docs/dogfood/EARLIER.md with only EARLIER-OK, then stop." },
  })} />);
  assert.equal(screen.queryByLabelText("Mid-turn narration"), null);
});

test("no reasoning → no Thought chrome", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    answerVouched: true,
    finalAnswer: "just the answer",
  })} />);
  assert.equal(screen.queryByText("Thought"), null);
  assert.equal(screen.queryByText("Thought…"), null);
  assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
});

test("cancel/fail with message store + answerVouched false → mid-turn non-final; no Answer article", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "cancelled",
    answerVouched: false,
    finalAnswer: null,
    message: { m: "partial words" },
  })} />);
  assert.ok(screen.getByLabelText("Mid-turn narration").textContent?.includes("partial words"));
  assert.equal(screen.queryByRole("article", { name: "Assistant answer" }), null);
});

test("missing-final with thought and no usable mid-turn has no Answer body", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "failed",
    answerVouched: false,
    finalAnswer: null,
    reasoning: { r: "only thought" },
    failure: { code: "missing_final_answer", message: "Missing final answer", retryable: true, recoveryAction: "retry_prompt" },
  })} />);
  assert.ok(screen.getByText("Thought"));
  assert.equal(screen.queryByRole("article", { name: "Assistant answer" }), null);
  assert.ok(screen.getByRole("alert").textContent?.includes("No final answer"));
});

test("present title/summary surfaces on the single tool row", () => {
  render(<RunSurface run={run({
    activities: { "read-1": readActivity() },
  })} />);
  const rail = screen.getByLabelText("Activity");
  assert.ok(rail.textContent?.includes("Reading notes.md"));
  assert.equal(screen.queryByText("Using tools…"), null);
});

test("failed / not_executed stay on the one Activity rail", () => {
  render(<RunSurface run={run({
    activities: {
      a: readActivity({ activityId: "a", invocationId: "a", lifecycle: "terminal", execution: "executed", status: "failed", error: "boom", title: "Read failed", summary: "Read failed" }),
      b: readActivity({ activityId: "b", invocationId: "b", lifecycle: "terminal", execution: "not_executed", status: "rejected", title: "Not run", summary: "Not run" }),
    },
  })} />);
  const rail = screen.getByLabelText("Activity");
  assert.ok(rail.textContent?.includes("Read failed"));
  assert.ok(rail.textContent?.includes("Not run"));
  assert.ok(rail.textContent?.includes("failed") || rail.textContent?.includes("boom"));
});

test("ThreadHeader's live status uses phaseLabel from DerivedLivePhase — no retired lies", () => {
  const d = deriveLivePhase({
    terminal: false, ownedBusy: true, liveness: "provider", planOwned: false,
    pendingTool: null, lastContentKind: "thought", decisionPending: false,
  });
  render(
    <ThreadHeader
      title="t"
      liveStatusText={statusBarPhaseText(d)}
      overview={null}
      onExport={() => undefined}
      changesOpen={false}
      onToggleChanges={() => undefined}
      changesAvailable={false}
    />,
  );
  assert.ok(screen.getByText("Thinking…"));
  assert.equal(screen.queryByText("Awaiting presence…"), null);
  assert.equal(screen.queryByText("Thinking field…"), null);
});

test("owner-loss failed: Mid-turn stays unvouched, Writing gone, no Assistant answer", () => {
  render(<RunSurface run={run({
    state: "terminal",
    terminalKind: "failed",
    answerVouched: false,
    finalAnswer: null,
    message: { m: "partial words" },
    failure: { code: "execution_owner_lost", message: "Owner lost", retryable: true, recoveryAction: "reconnect" },
  })} ownershipLost />);
  const mid = screen.getByLabelText("Mid-turn narration");
  assert.ok(mid.textContent?.includes("partial words"));
  assert.equal(screen.queryByRole("article", { name: "Assistant answer" }), null);
  assert.equal(screen.queryByText("Answered"), null);
  assert.ok(screen.getByText("Run failed"));
});

test("Plan-owned bar and footer helpers agree on kind", () => {
  const d = deriveLivePhase({
    terminal: false, ownedBusy: true, liveness: "provider", planOwned: true,
    pendingTool: null, lastContentKind: "message", decisionPending: false,
  });
  assert.equal(statusBarPhaseText(d), "Planning");
  // "Plan · no edits applied" is the composer's own footer line (App.tsx,
  // untouched by Task 9) — this test's job is the pure functions agreeing,
  // plus confirming ThreadHeader's live status can display the bar's half.
  assert.equal(composerFooterPhaseText(d), "Plan · no edits applied");
  render(
    <ThreadHeader
      title="t"
      liveStatusText={statusBarPhaseText(d)}
      overview={null}
      onExport={() => undefined}
      changesOpen={false}
      onToggleChanges={() => undefined}
      changesAvailable={false}
    />,
  );
  assert.ok(screen.getByText("Planning"));
});
