import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  PLAN_ACCEPTED_TITLE,
  PLAN_CANCELLED,
  PLAN_CHIP_PROPOSED,
  PLAN_EMPTY,
  PLAN_EXPLORING,
  PLAN_FAILED,
  PLAN_HEADER,
  PLAN_KEPT_HELPER,
  PLAN_KEPT_TITLE,
  PLAN_LOAD_FAILURE,
  PLAN_READY_HELPER,
  PLAN_RESTORING,
  PLAN_SUPERSEDED,
  PlanSection,
  acceptedHelper,
} from "./PlanSection";

afterEach(() => cleanup());

test("exploring exact copy", () => {
  render(<PlanSection projection={{ state: "exploring" }} />);
  assert.ok(screen.getByRole("heading", { name: PLAN_HEADER }));
  assert.ok(screen.getByText(PLAN_EXPLORING));
});

test("restoring catch-up copy is not exploring", () => {
  render(<PlanSection projection={{ state: "loading" }} />);
  assert.ok(screen.getByText(PLAN_RESTORING));
  assert.equal(screen.queryByText(PLAN_EXPLORING), null);
  assert.equal(screen.queryByText(PLAN_EMPTY), null);
});

test("empty ready shows No changes proposed. and zero members", () => {
  render(
    <PlanSection
      projection={{
        state: "ready",
        proposedMembers: [],
        body: "Nothing to change in this workspace.",
        decisionPending: true,
        empty: true,
      }}
    />,
  );
  assert.ok(screen.getByText(PLAN_EMPTY));
  assert.equal(screen.queryByText(PLAN_CHIP_PROPOSED), null);
  assert.equal(screen.queryByRole("button", { name: /accept/i }), null);
});

test("accepted helper with Policy label", () => {
  render(
    <PlanSection
      projection={{ state: "accepted", policyLabel: "Review", bypassActive: false, body: null }}
    />,
  );
  assert.ok(screen.getByText(PLAN_ACCEPTED_TITLE));
  assert.ok(screen.getByText(acceptedHelper("Review", false)));
});

test("accepted helper appends Bypass only when vouched", () => {
  render(
    <PlanSection
      projection={{ state: "accepted", policyLabel: "Trusted workspace", bypassActive: true, body: null }}
    />,
  );
  assert.ok(screen.getByText(acceptedHelper("Trusted workspace", true)));
});

test("accepted plan keeps the three-step body visible", () => {
  const body =
    "Three-step plan for apps/shell typecheck.\n\n1. Set-Location apps/shell\n2. npx tsc --noEmit\n3. Read the result.";
  render(
    <PlanSection
      projection={{ state: "accepted", policyLabel: "Review", bypassActive: false, body }}
    />,
  );
  assert.ok(screen.getByText(PLAN_ACCEPTED_TITLE));
  assert.ok(document.querySelector(".plan-body"));
  assert.match(document.querySelector(".plan-body")?.textContent ?? "", /1\.\s*Set-Location/);
});

test("cancelled / failed / superseded / load failure exact copy", () => {
  const { rerender } = render(<PlanSection projection={{ state: "cancelled" }} />);
  assert.ok(screen.getByText(PLAN_CANCELLED));
  rerender(<PlanSection projection={{ state: "failed" }} />);
  assert.ok(screen.getByText(PLAN_FAILED));
  assert.equal(screen.queryByText(PLAN_CANCELLED), null);
  rerender(<PlanSection projection={{ state: "superseded" }} />);
  assert.ok(screen.getByText(PLAN_SUPERSEDED));
  rerender(<PlanSection projection={{ state: "error", message: PLAN_LOAD_FAILURE }} />);
  assert.equal(screen.getByRole("alert").textContent, PLAN_LOAD_FAILURE);
});

test("singleton still renders one Proposed member", () => {
  render(
    <PlanSection
      projection={{
        state: "ready",
        proposedMembers: [{ path: "only.ts", summary: "Update only.ts" }],
        body: "Update `only.ts`.",
        decisionPending: true,
        empty: false,
      }}
    />,
  );
  assert.ok(screen.getByText("only.ts"));
  assert.ok(screen.getByText(PLAN_CHIP_PROPOSED));
  assert.ok(screen.getByLabelText("1 proposed members"));
});

test("multi-path lists Proposed members and dock helper; no Accept in section", () => {
  render(
    <PlanSection
      projection={{
        state: "ready",
        proposedMembers: [
          { path: "src/a.ts", summary: "Update helper" },
          { path: "apps/shell/src/b.tsx", summary: "Create UI" },
        ],
        body: "Two files",
        decisionPending: true,
        empty: false,
      }}
    />,
  );
  assert.ok(screen.getByText("src/a.ts"));
  assert.ok(screen.getByText("apps/shell/src/b.tsx"));
  assert.equal(screen.getAllByText(PLAN_CHIP_PROPOSED).length, 2);
  assert.ok(screen.getByText(PLAN_READY_HELPER));
  assert.equal(screen.queryByRole("button", { name: /accept plan/i }), null);
  assert.equal(screen.queryByRole("button", { name: /reject/i }), null);
});

test("ready non-empty collapse toggle hides members", () => {
  render(
    <PlanSection
      projection={{
        state: "ready",
        proposedMembers: [{ path: "src/a.ts", summary: "Update" }],
        body: null,
        decisionPending: false,
        empty: false,
      }}
    />,
  );
  const toggle = screen.getByRole("button", { name: /plan/i });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByText("src/a.ts"), null);
});

test("kept_planning exact helper", () => {
  render(<PlanSection projection={{ state: "kept_planning" }} />);
  assert.ok(screen.getByText(PLAN_KEPT_TITLE));
  assert.ok(screen.getByText(PLAN_KEPT_HELPER));
});
