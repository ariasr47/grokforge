import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ActionDock } from "./ActionDock";
import { GATE_ASK_ELSE, GATE_RECOVER } from "./copyDock";

afterEach(() => cleanup());

function baseProps() {
  return {
    permissions: [],
    oauth: null,
    onPermission: () => undefined,
  };
}

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
