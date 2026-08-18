import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  VerifySection,
  VERIFY_ALL_PASSED,
  VERIFY_HEADER,
  VERIFY_HELPER,
  VERIFY_LIVE_GROWING,
  VERIFY_LOADING,
  VERIFY_OFFLINE,
  VERIFY_UNKNOWN_HELPER,
  VERIFY_VIEW_OUTPUT,
} from "./VerifySection";
import type { RunVerifyListProjection, RunVerifyMember } from "./runVerifyList";

afterEach(() => cleanup());

test("absent renders nothing", () => {
  const { container } = render(
    <VerifySection projection={{ state: "absent", runLive: false }} />,
  );
  assert.equal(container.querySelector("[aria-label='Verify']"), null);
});

test("loading and error copy; no Retry", () => {
  const { unmount } = render(<VerifySection projection={{ state: "loading" }} />);
  assert.ok(screen.getByText(VERIFY_LOADING));
  unmount();
  render(
    <VerifySection
      projection={{
        state: "error",
        message: "Couldn’t load this run’s verify results. Activity rows that already loaded stay available.",
      }}
    />,
  );
  assert.ok(screen.getByText(/Couldn’t load this run’s verify results/));
  assert.equal(screen.queryByRole("button", { name: /retry/i }), null);
});

test("ready starts collapsed with count; expands rows; Not run / Failed chips", async () => {
  const user = userEvent.setup();
  const projection: RunVerifyListProjection = {
    state: "ready",
    runLive: false,
    members: [
      {
        activityId: "a1",
        invocationId: "i1",
        command: "npm test",
        execution: "executed",
        outcome: "fail",
        outcomeUnavailable: false,
      },
      {
        activityId: "a2",
        invocationId: "i2",
        command: "npm run typecheck",
        execution: "not_executed",
        outcome: null,
        outcomeUnavailable: false,
      },
    ],
  };
  render(<VerifySection projection={projection} />);
  assert.ok(screen.getByText(VERIFY_HEADER));
  assert.ok(screen.getByText("2"));
  assert.ok(screen.getByText(/1 failed/));
  assert.equal(screen.queryByText("npm test"), null);
  await user.click(screen.getByRole("button", { name: /Verify/i }));
  assert.ok(screen.getByText("npm test"));
  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("Not run"));
  assert.ok(screen.getByText(VERIFY_HELPER));
});

function readyMember(overrides: Partial<RunVerifyMember> = {}): RunVerifyMember {
  return {
    activityId: "a1",
    invocationId: "i1",
    command: "npm test",
    execution: "executed",
    outcome: "pass",
    outcomeUnavailable: false,
    ...overrides,
  };
}

test("Passed / Unknown / Running rows use vouched chips and View output rules", async () => {
  const user = userEvent.setup();
  let viewed: string | null = null;
  render(
    <VerifySection
      projection={{
        state: "ready",
        runLive: false,
        members: [
          readyMember({ outcome: "pass" }),
          readyMember({
            activityId: "a2",
            invocationId: "i2",
            command: "npm run typecheck",
            execution: "executed",
            outcome: "unknown",
            outcomeUnavailable: true,
          }),
          readyMember({
            activityId: "a3",
            invocationId: "i3",
            command: "npx vitest",
            execution: "pending",
            outcome: "running",
          }),
        ],
      }}
      onViewOutput={(member) => {
        viewed = member.activityId;
      }}
      outputAvailableIds={new Set(["a1", "a2"])}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Verify/i }));
  assert.ok(screen.getByText("Passed"));
  assert.ok(screen.getByText("Unknown"));
  assert.ok(screen.getByText("Running"));
  assert.ok(screen.getByText(VERIFY_UNKNOWN_HELPER));
  const viewButtons = screen.getAllByRole("button", { name: VERIFY_VIEW_OUTPUT });
  assert.equal(viewButtons.length, 2, "Running without output omits View output");
  await user.click(viewButtons[0]!);
  assert.equal(viewed, "a1");
});

test("live growing copy; All checks passed only when every member Passed and not live", async () => {
  const passed: RunVerifyListProjection = {
    state: "ready",
    runLive: false,
    members: [readyMember({ outcome: "pass" })],
  };
  const { rerender } = render(<VerifySection projection={{ ...passed, runLive: true }} />);
  assert.ok(screen.getByText(VERIFY_LIVE_GROWING));
  assert.equal(screen.queryByText(VERIFY_ALL_PASSED), null);
  rerender(<VerifySection projection={passed} />);
  assert.equal(screen.queryByText(VERIFY_LIVE_GROWING), null);
  assert.ok(screen.getByText(VERIFY_ALL_PASSED));
});

test("offline copy is exact and does not wipe the list", () => {
  render(
    <VerifySection
      projection={{
        state: "ready",
        runLive: false,
        members: [readyMember({ outcome: "pass" })],
      }}
      offline
    />,
  );
  assert.ok(screen.getByText(VERIFY_OFFLINE));
  assert.ok(screen.getByText(VERIFY_HEADER));
  assert.equal(screen.queryByText(VERIFY_LIVE_GROWING), null);
});

test("banned framing is absent from the ready section", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <VerifySection
      projection={{
        state: "ready",
        runLive: false,
        members: [readyMember({ outcome: "pass" })],
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Verify/i }));
  const text = (container.textContent ?? "").toLowerCase();
  for (const banned of ["ci", "pipeline", "coverage", "quality gate", "all green", "sandbox-verified"]) {
    assert.equal(text.includes(banned), false, banned);
  }
});
