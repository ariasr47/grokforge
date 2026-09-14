import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PermissionReq } from "../projections/runChangeList";
import { ActionDock } from "./ActionDock";
import { GATE_ASK_ELSE, GATE_RECOVER } from "../lib/copyDock";

afterEach(() => cleanup());

function baseProps() {
  return {
    permissions: [],
    oauth: null,
    onPermission: () => undefined,
  };
}

function permission(overrides: Partial<PermissionReq> = {}): PermissionReq {
  return {
    id: "perm-1",
    kind: "shell",
    detail: "npm test",
    sessionId: "s1",
    runId: "r1",
    invocationId: "perm-1",
    ...overrides,
  };
}

/** A composer textarea alongside ActionDock, standing in for App.tsx's real
 *  composer — ActionDock itself renders no composer. */
function Harness({ permissions }: { permissions: PermissionReq[] }) {
  return (
    <>
      <textarea aria-label="composer" />
      <ActionDock {...baseProps()} permissions={permissions} />
    </>
  );
}

test("F1: a permission arriving while the composer is focused does not steal focus away from it", () => {
  const { rerender } = render(<Harness permissions={[]} />);
  const composer = screen.getByLabelText("composer");
  composer.focus();
  assert.equal(document.activeElement, composer);

  // The gate now arrives mid-sentence — ActionDock's own focus-on-open
  // effect must not yank focus off the composer (F1): doing so would let
  // the operator's very next keystroke land on the dock's button instead,
  // where App.tsx's global Y/N/S shortcuts would read it as a decision.
  rerender(<Harness permissions={[permission()]} />);
  screen.getByRole("region", { name: "Grok wants to run a command" });
  assert.equal(document.activeElement, composer);
});

test("a pending recovery_confirmation decision renders the cyan ask gate in the dock", () => {
  let recovered = 0;
  render(
    <ActionDock
      {...baseProps()}
      recoveryDecision={{ id: "d1", question: "Restore edit-1 to its state before the last write?" }}
      onRecover={() => {
        recovered += 1;
      }}
    />,
  );
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  const gate = within(dock).getByRole("region", { name: "Grok has a question" });
  assert.ok(within(gate).getByText("Restore edit-1 to its state before the last write?"));
  const opt = within(gate).getByRole("button", { name: GATE_RECOVER });
  assert.equal(within(opt).getByText("1").tagName, "KBD");
  opt.click();
  assert.equal(recovered, 1);
});

test("recovery's ask gate offers only the one real action, with no dismiss", () => {
  render(
    <ActionDock
      {...baseProps()}
      recoveryDecision={{ id: "d1", question: "Restore edit-1?" }}
      onRecover={() => undefined}
    />,
  );
  const gate = screen.getByRole("region", { name: "Grok has a question" });
  const options = within(gate).getAllByRole("button");
  // Exactly Recover — never a second invented choice, and never a dismiss that
  // would hide the card while the composer stays locked on it.
  assert.equal(options.length, 1);
  assert.ok(within(gate).getByRole("button", { name: GATE_RECOVER }));
  assert.equal(within(gate).queryByRole("button", { name: GATE_ASK_ELSE }) === null, true);
});

test("no recovery decision means no ask gate and an empty dock stays hidden", () => {
  const { container } = render(<ActionDock {...baseProps()} recoveryDecision={null} />);
  assert.equal(container.firstChild, null);
});

test("two pending permissions surface 1 of 2 on the dock", () => {
  render(
    <ActionDock
      {...baseProps()}
      permissions={[
        permission({ id: "perm-a", invocationId: "perm-a", detail: "echo q1" }),
        permission({ id: "perm-b", invocationId: "perm-b", detail: "echo q2" }),
      ]}
    />,
  );
  const dock = screen.getByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByText("1 of 2"));
  assert.ok(within(dock).getByRole("region", { name: "Grok wants to run a command" }));
});

test("ask permission renders numbered options and click settles option:N", () => {
  let decision: string | null = null;
  render(
    <ActionDock
      {...baseProps()}
      permissions={[
        permission({
          kind: "ask",
          detail: JSON.stringify({
            question: "Which copy for GATE_ASK_POLICY?",
            options: ["keep current", "change it"],
          }),
        }),
      ]}
      onPermission={(d) => {
        decision = d;
      }}
    />,
  );
  const gate = screen.getByRole("region", { name: "Grok has a question" });
  assert.ok(within(gate).getByText("Which copy for GATE_ASK_POLICY?"));
  const opt2 = within(gate).getByRole("button", { name: /change it/ });
  assert.equal(within(opt2).getByText("2").tagName, "KBD");
  opt2.click();
  assert.equal(decision, "option:1");
});
