import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PI_TURN_CONFIRM_ERROR,
  PI_TURN_FAILED,
  PI_TURN_HYDRATING,
  PI_TURN_NOT_INCLUDED,
  piTurnIncluded,
} from "./projectInstructionsTurn";
import { ProjectInstructionsTurnChip } from "./ProjectInstructionsTurnChip";

afterEach(() => cleanup());

test("catch-up open → hydrating Confirming… copy", () => {
  render(<ProjectInstructionsTurnChip projection={{ state: "hydrating" }} />);
  assert.ok(screen.getByText(PI_TURN_HYDRATING));
});

test("catch-up failed → confirm_error exact copy", () => {
  render(<ProjectInstructionsTurnChip projection={{ state: "confirm_error" }} />);
  assert.ok(screen.getByText(PI_TURN_CONFIRM_ERROR));
});

test("included → Included · {path}", () => {
  render(
    <ProjectInstructionsTurnChip
      projection={{ state: "included", path: "AGENTS.md" }}
    />,
  );
  assert.ok(screen.getByText(piTurnIncluded("AGENTS.md")));
  assert.equal(screen.queryByText(/Followed/i) === null, true);
});

test("not_included → muted No project instructions for this turn or quiet absence", () => {
  render(<ProjectInstructionsTurnChip projection={{ state: "not_included" }} />);
  assert.ok(screen.getByText(PI_TURN_NOT_INCLUDED));
  assert.equal(screen.queryByText(/Included/) === null, true);
});

test("failed → Couldn’t resolve project instructions for this turn. (no path print)", () => {
  const { container } = render(
    <ProjectInstructionsTurnChip
      projection={{ state: "failed", path: "AGENTS.md" }}
    />,
  );
  assert.ok(screen.getByText(PI_TURN_FAILED));
  assert.equal(container.textContent?.includes("AGENTS.md"), false);
  assert.equal(screen.queryByText(PI_TURN_NOT_INCLUDED) === null, true);
});

test("restored keeps failed", () => {
  const { container } = render(
    <ProjectInstructionsTurnChip
      projection={{ state: "restored", inclusion: "failed", path: "AGENTS.md" }}
    />,
  );
  assert.ok(screen.getByText(PI_TURN_FAILED));
  assert.equal(container.textContent?.includes("AGENTS.md"), false);
  assert.equal(screen.queryByText(PI_TURN_NOT_INCLUDED) === null, true);
});

test("Chat / no voucher → absent", () => {
  const { container } = render(
    <ProjectInstructionsTurnChip projection={{ state: "absent" }} />,
  );
  assert.equal(container.textContent, "");
});

test("restored included paints Included · path; never Followed", () => {
  render(
    <ProjectInstructionsTurnChip
      projection={{ state: "restored", inclusion: "included", path: "CLAUDE.md" }}
    />,
  );
  assert.ok(screen.getByText(piTurnIncluded("CLAUDE.md")));
  assert.equal(screen.queryByText(/Followed/i) === null, true);
});
