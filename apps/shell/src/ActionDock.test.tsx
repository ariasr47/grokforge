import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActionDock } from "./ActionDock";
import { GATE_ASK_ELSE, GATE_RECOVER } from "./copyDock";

afterEach(() => cleanup());

function baseProps() {
  return {
    permissions: [],
    diffQueue: [],
    activeDiffId: null,
    onActiveDiffId: () => undefined,
    oauth: null,
    onPermission: () => undefined,
    onAccept: () => undefined,
    onReject: () => undefined,
    onAcceptAll: () => undefined,
    onRejectAll: () => undefined,
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

test("recovery's ask gate never fabricates a second option — one real action plus dismiss", () => {
  render(
    <ActionDock
      {...baseProps()}
      recoveryDecision={{ id: "d1", question: "Restore edit-1?" }}
      onRecover={() => undefined}
    />,
  );
  const gate = screen.getByRole("region", { name: "Grok has a question" });
  const options = within(gate).getAllByRole("button");
  // Exactly Recover + Ask something else — never a second invented choice.
  assert.equal(options.length, 2);
  assert.ok(within(gate).getByRole("button", { name: GATE_RECOVER }));
  const dismiss = within(gate).getByRole("button", { name: GATE_ASK_ELSE });
  assert.equal(within(dismiss).getByText("esc").tagName, "KBD");
});

test("dismissing the ask gate hides it; a fresh decision (new id) still reopens it", () => {
  const { rerender } = render(
    <ActionDock
      {...baseProps()}
      recoveryDecision={{ id: "d1", question: "Restore edit-1?" }}
      onRecover={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: GATE_ASK_ELSE }));
  assert.equal(screen.queryByRole("region", { name: "Grok has a question" }), null);
  // Same id again (e.g. an unrelated re-render) stays dismissed.
  rerender(
    <ActionDock
      {...baseProps()}
      recoveryDecision={{ id: "d1", question: "Restore edit-1?" }}
      onRecover={() => undefined}
    />,
  );
  assert.equal(screen.queryByRole("region", { name: "Grok has a question" }), null);
  // A new decision (different id) is not swallowed by the old dismissal.
  rerender(
    <ActionDock
      {...baseProps()}
      recoveryDecision={{ id: "d2", question: "Restore edit-2?" }}
      onRecover={() => undefined}
    />,
  );
  assert.ok(screen.getByRole("region", { name: "Grok has a question" }));
});

test("no recovery decision means no ask gate and an empty dock stays hidden", () => {
  const { container } = render(<ActionDock {...baseProps()} recoveryDecision={null} />);
  assert.equal(container.firstChild, null);
});
