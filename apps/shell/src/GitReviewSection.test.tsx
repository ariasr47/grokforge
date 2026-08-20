import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GitReviewSection,
  GIT_REVIEW_HEADER,
  GIT_REVIEW_LOADING,
  GIT_REVIEW_HELPER,
  GIT_REVIEW_UNAVAILABLE,
  GIT_REVIEW_VIEW_OUTPUT,
  GIT_REVIEW_OFFLINE,
  GIT_REVIEW_LIVE_GROWING,
} from "./GitReviewSection";
import type { RunGitReviewListProjection, RunGitReviewMember } from "./runGitReviewList";

afterEach(() => cleanup());

test("absent renders nothing", () => {
  const { container } = render(
    <GitReviewSection projection={{ state: "absent", runLive: false }} />,
  );
  assert.equal(container.querySelector("[aria-label='Git review']"), null);
});

test("loading and error copy; no Retry", () => {
  const { unmount } = render(<GitReviewSection projection={{ state: "loading" }} />);
  assert.ok(screen.getByText(GIT_REVIEW_LOADING));
  unmount();
  render(
    <GitReviewSection
      projection={{
        state: "error",
        message:
          "Couldn’t load this run’s git review. Activity rows that already loaded stay available.",
      }}
    />,
  );
  assert.ok(screen.getByText(/Couldn’t load this run’s git review/));
  assert.equal(screen.queryByRole("button", { name: /retry/i }), null);
});

test("ready starts collapsed; expands kinds + Failed/Not run/unavailable", async () => {
  const user = userEvent.setup();
  const projection: RunGitReviewListProjection = {
    state: "ready",
    runLive: false,
    members: [
      {
        activityId: "a1",
        invocationId: "i1",
        command: "git status -sb",
        kind: "status",
        execution: "executed",
        evidenceUnavailable: false,
      },
      {
        activityId: "a2",
        invocationId: "i2",
        command: "git diff",
        kind: "diff",
        execution: "executed",
        evidenceUnavailable: false,
      },
      {
        activityId: "a3",
        invocationId: "i3",
        command: "git log -n 1",
        kind: "log",
        execution: "not_executed",
        evidenceUnavailable: false,
      },
      {
        activityId: "a4",
        invocationId: "i4",
        command: "gh pr view",
        kind: "pr",
        execution: "executed",
        evidenceUnavailable: true,
      },
    ],
  };
  const statusById = new Map([
    ["a1", "succeeded" as const],
    ["a2", "failed" as const],
    ["a3", "rejected" as const],
    ["a4", "succeeded" as const],
  ]);
  const lifecycleById = new Map([
    ["a1", "terminal" as const],
    ["a2", "terminal" as const],
    ["a3", "terminal" as const],
    ["a4", "terminal" as const],
  ]);
  render(
    <GitReviewSection
      projection={projection}
      activityStatusById={statusById}
      activityLifecycleById={lifecycleById}
      outputAvailableIds={new Set(["a1", "a2", "a3"])}
    />,
  );
  assert.ok(screen.getByText(GIT_REVIEW_HEADER));
  assert.ok(screen.getByText("4"));
  assert.ok(screen.getByText(/1 status/i));
  assert.equal(screen.queryByText("git status -sb"), null);
  await user.click(screen.getByRole("button", { name: /Git review/i }));
  assert.ok(screen.getByText(GIT_REVIEW_HELPER));
  assert.ok(screen.getByText("Status"));
  assert.ok(screen.getByText("Diff"));
  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("Not run"));
  assert.ok(screen.getByText(GIT_REVIEW_UNAVAILABLE));
  assert.equal(screen.queryByText("Passed"), null);
  assert.equal(screen.queryByText(/ready to ship/i), null);
  assert.ok(screen.getAllByRole("button", { name: GIT_REVIEW_VIEW_OUTPUT }).length >= 1);
});

function readyMember(overrides: Partial<RunGitReviewMember> = {}): RunGitReviewMember {
  return {
    activityId: "a1",
    invocationId: "i1",
    command: "git status",
    kind: "status",
    execution: "executed",
    evidenceUnavailable: false,
    ...overrides,
  };
}

test("Running omits View output while output is null; Not run/Failed keep it (AC-33)", async () => {
  const user = userEvent.setup();
  let viewed: string | null = null;
  render(
    <GitReviewSection
      projection={{
        state: "ready",
        runLive: true,
        members: [
          readyMember({
            activityId: "a-run",
            invocationId: "i-run",
            command: "git status",
            execution: "pending",
          }),
          readyMember({
            activityId: "a-fail",
            invocationId: "i-fail",
            command: "git diff",
            kind: "diff",
            execution: "executed",
          }),
          readyMember({
            activityId: "a-skip",
            invocationId: "i-skip",
            command: "git log",
            kind: "log",
            execution: "not_executed",
          }),
        ],
      }}
      activityStatusById={new Map([
        ["a-run", "running"],
        ["a-fail", "failed"],
        ["a-skip", "rejected"],
      ])}
      activityLifecycleById={new Map([
        ["a-run", "pending"],
        ["a-fail", "terminal"],
        ["a-skip", "terminal"],
      ])}
      outputAvailableIds={new Set(["a-fail"])}
      onViewOutput={(member) => {
        viewed = member.activityId;
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Git review/i }));
  assert.ok(screen.getByText("Running"));
  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("Not run"));
  const viewButtons = screen.getAllByRole("button", { name: GIT_REVIEW_VIEW_OUTPUT });
  assert.equal(viewButtons.length, 2, "Running without output omits View output");
  await user.click(viewButtons[0]!);
  assert.ok(viewed === "a-fail" || viewed === "a-skip");
});

test("live growing copy while runLive; never final clean/PR-ready wording", () => {
  render(
    <GitReviewSection
      projection={{
        state: "ready",
        runLive: true,
        members: [readyMember()],
      }}
    />,
  );
  assert.ok(screen.getByText(GIT_REVIEW_LIVE_GROWING));
  const text = (document.body.textContent ?? "").toLowerCase();
  assert.equal(text.includes("working tree clean"), false);
  assert.equal(text.includes("pr ready"), false);
  assert.equal(text.includes("git review complete"), false);
});

test("offline copy is exact and does not wipe the list", () => {
  render(
    <GitReviewSection
      projection={{
        state: "ready",
        runLive: false,
        members: [readyMember()],
      }}
      offline
    />,
  );
  assert.ok(screen.getByText(GIT_REVIEW_OFFLINE));
  assert.ok(screen.getByText(GIT_REVIEW_HEADER));
  assert.equal(screen.queryByText(GIT_REVIEW_LIVE_GROWING), null);
});

test("banned framing is absent from the ready section", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <GitReviewSection
      projection={{
        state: "ready",
        runLive: false,
        members: [readyMember({ kind: "pr", command: "gh pr view" })],
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Git review/i }));
  const text = (container.textContent ?? "").toLowerCase();
  for (const banned of [
    "git ide",
    "source control",
    "ready to ship",
    "working tree clean",
    "pr ready",
    "open link",
    "passed",
    "dirty",
    "ahead",
  ]) {
    assert.equal(text.includes(banned), false, banned);
  }
});
