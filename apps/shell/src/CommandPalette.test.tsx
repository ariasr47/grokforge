import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";

afterEach(() => cleanup());

const actions = [
  { id: "new-session", label: "New chat session", run: () => undefined },
  { id: "focus-composer", label: "Focus composer", run: () => undefined },
  { id: "shortcuts", label: "Keyboard shortcuts", hint: "Ctrl+K", run: () => undefined },
];

describe("CommandPalette", () => {
  it("lists commands when open, not an empty card", () => {
    render(<CommandPalette open actions={actions} onClose={() => undefined} />);
    assert.ok(screen.getByRole("dialog", { name: "Command palette" }));
    assert.ok(screen.getByRole("option", { name: /New chat session/ }));
    assert.ok(screen.getByRole("option", { name: /Focus composer/ }));
    assert.equal(screen.getAllByRole("option").length, 3);
  });

  it("filters by query and Enter runs the highlighted command", () => {
    const seen: string[] = [];
    const close: string[] = [];
    render(
      <CommandPalette
        open
        actions={actions.map((a) => ({
          ...a,
          run: () => seen.push(a.id),
        }))}
        onClose={() => close.push("close")}
      />,
    );
    const input = screen.getByPlaceholderText("Type a command…");
    fireEvent.change(input, { target: { value: "focus" } });
    assert.equal(screen.getAllByRole("option").length, 1);
    fireEvent.keyDown(input, { key: "Enter" });
    assert.deepEqual(seen, ["focus-composer"]);
    assert.deepEqual(close, ["close"]);
  });
});
