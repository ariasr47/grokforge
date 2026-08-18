import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  PLAN_ARM_BLOCKED_UNVOUCHED,
  PLAN_ARM_HELPER_ARMED,
  PLAN_ARM_OFFLINE,
  PlanArmControl,
} from "./PlanArmControl";
import { planArmFailureCopy } from "./planArm";

afterEach(() => cleanup());

test("armed shows helper Explore and propose without applying edits", () => {
  render(
    <PlanArmControl
      projection={{ state: "armed", engaged: true, vouched: true }}
    />,
  );
  assert.ok(screen.getByText(PLAN_ARM_HELPER_ARMED));
  assert.equal(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-pressed"), "true");
});

test("blocked_unvouched exact copy; no Reject", () => {
  render(<PlanArmControl projection={{ state: "blocked_unvouched" }} />);
  assert.ok(screen.getByText(PLAN_ARM_BLOCKED_UNVOUCHED));
  assert.equal(screen.queryByRole("button", { name: /reject/i }), null);
  assert.equal(screen.getByRole("button", { name: "Plan" }).hasAttribute("disabled"), true);
});

test("Chat absent_chat renders no Plan control", () => {
  const { container } = render(<PlanArmControl projection={{ state: "absent_chat" }} />);
  assert.equal(container.textContent, "");
  assert.equal(screen.queryByRole("button", { name: "Plan" }), null);
});

test("offline exact copy is distinct from blocked_unvouched", () => {
  render(<PlanArmControl projection={{ state: "offline" }} />);
  assert.ok(screen.getByText(PLAN_ARM_OFFLINE));
  assert.equal(screen.queryByText(PLAN_ARM_BLOCKED_UNVOUCHED), null);
});

test("arm failure exact copy + Try again", () => {
  let retried = false;
  render(
    <PlanArmControl
      projection={{ state: "error", message: planArmFailureCopy("Execute") }}
      onRetry={() => {
        retried = true;
      }}
    />,
  );
  assert.ok(screen.getByText(planArmFailureCopy("Execute")));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  assert.equal(retried, true);
});

test("default chip is available and not selected", () => {
  let next: boolean | null = null;
  render(
    <PlanArmControl
      projection={{ state: "default", engaged: false, vouched: true }}
      onToggle={(engaged) => {
        next = engaged;
      }}
    />,
  );
  const chip = screen.getByRole("button", { name: "Plan" });
  assert.equal(chip.getAttribute("aria-pressed"), "false");
  fireEvent.click(chip);
  assert.equal(next, true);
});
