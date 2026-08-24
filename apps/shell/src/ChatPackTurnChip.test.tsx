import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ChatPackTurnChip,
  PACK_TURN_CONFIRM_ERROR,
  PACK_TURN_HYDRATING,
  PACK_TURN_INCLUDED,
  PACK_TURN_NOT_INCLUDED,
  packTurnFaultCopy,
} from "./ChatPackTurnChip";

afterEach(() => cleanup());

test("absent renders nothing", () => {
  const { container } = render(
    <ChatPackTurnChip projection={{ state: "absent" }} />,
  );
  assert.equal(container.textContent, "");
});

test("hydrating is Confirming… — not empty", () => {
  render(<ChatPackTurnChip projection={{ state: "hydrating" }} />);
  assert.ok(screen.getByText(PACK_TURN_HYDRATING));
  assert.equal(screen.queryByText(PACK_TURN_NOT_INCLUDED), null);
  assert.equal(screen.queryByText(PACK_TURN_INCLUDED), null);
});

test("included is Included pack — never armed copy", () => {
  render(
    <ChatPackTurnChip
      projection={{ state: "included", files: [{ path: "a.md" }], noteIncluded: true }}
    />,
  );
  assert.ok(screen.getByText(PACK_TURN_INCLUDED));
  assert.equal(screen.queryByText(/Armed/), null);
});

test("not_included / confirm_error / faults use exact copy", () => {
  const { rerender } = render(
    <ChatPackTurnChip projection={{ state: "not_included" }} />,
  );
  assert.ok(screen.getByText(PACK_TURN_NOT_INCLUDED));
  rerender(<ChatPackTurnChip projection={{ state: "confirm_error" }} />);
  assert.ok(screen.getByText(PACK_TURN_CONFIRM_ERROR));
  rerender(
    <ChatPackTurnChip
      projection={{ state: "materialization_fault", fault: "path", files: [{ path: "x.md" }] }}
    />,
  );
  assert.ok(screen.getByText(packTurnFaultCopy("path")));
  rerender(
    <ChatPackTurnChip
      projection={{ state: "materialization_fault", fault: "over_cap", files: [] }}
    />,
  );
  assert.ok(screen.getByText(packTurnFaultCopy("over_cap")));
});

test("restored keeps materialization_fault and confirm_failed copy", () => {
  const { rerender } = render(
    <ChatPackTurnChip
      projection={{
        state: "restored",
        inclusion: "materialization_fault",
        fault: "over_cap",
        files: [],
        noteIncluded: false,
      }}
    />,
  );
  assert.ok(screen.getByText(packTurnFaultCopy("over_cap")));
  rerender(
    <ChatPackTurnChip
      projection={{
        state: "restored",
        inclusion: "confirm_failed",
        fault: null,
        files: [],
        noteIncluded: false,
      }}
    />,
  );
  assert.ok(screen.getByText(PACK_TURN_CONFIRM_ERROR));
});
