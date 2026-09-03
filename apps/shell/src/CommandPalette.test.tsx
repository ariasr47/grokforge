import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette, type PaletteSessionRow } from "./CommandPalette";

afterEach(() => cleanup());

const actions = [
  { id: "new-session", label: "New chat session", run: () => undefined },
  { id: "focus-composer", label: "Focus composer", run: () => undefined },
  { id: "shortcuts", label: "Keyboard shortcuts", hint: "Ctrl+K", run: () => undefined },
];

const sessions: PaletteSessionRow[] = [
  {
    id: "s1",
    workspacePath: "/home/rodrigo/grokforge",
    workspaceName: "grokforge",
    title: "Fix typecheck in apps/shell",
    branch: "master",
    updatedAt: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    id: "s2",
    workspacePath: "/home/rodrigo/spire-os",
    workspaceName: "spire-os",
    title: "Sidebar tree · sessions v2",
    branch: "main",
    updatedAt: Date.now() - 60 * 1000,
  },
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

  it("footer reads the move/run/close hint, nothing else", () => {
    render(<CommandPalette open actions={actions} onClose={() => undefined} />);
    const footer = document.querySelector(".palette-footer");
    assert.ok(footer);
    assert.equal(footer!.textContent, "↑↓ move⏎ runesc close");
  });

  it("Ctrl+P sessions mode lists sessions across every workspace, not commands", () => {
    render(
      <CommandPalette
        open
        mode="sessions"
        actions={actions}
        sessions={sessions}
        onClose={() => undefined}
        onSelectSession={() => undefined}
      />,
    );
    assert.ok(screen.getByRole("dialog", { name: "Search sessions" }));
    assert.ok(screen.getByRole("option", { name: /Fix typecheck in apps\/shell/ }));
    assert.ok(screen.getByRole("option", { name: /Sidebar tree · sessions v2/ }));
    assert.equal(screen.getAllByRole("option").length, 2);
    // workspace + branch + time-ago, not a command hint
    const row = screen.getByRole("option", { name: /Fix typecheck in apps\/shell/ });
    assert.ok(row.textContent?.includes("grokforge"));
    assert.ok(row.textContent?.includes("master"));
  });

  it("sessions mode filters by title, workspace, or branch", () => {
    render(
      <CommandPalette
        open
        mode="sessions"
        actions={actions}
        sessions={sessions}
        onClose={() => undefined}
        onSelectSession={() => undefined}
      />,
    );
    const input = screen.getByPlaceholderText("Search sessions…");
    fireEvent.change(input, { target: { value: "spire" } });
    assert.equal(screen.getAllByRole("option").length, 1);
    assert.ok(screen.getByRole("option", { name: /Sidebar tree/ }));

    fireEvent.change(input, { target: { value: "main" } });
    assert.equal(screen.getAllByRole("option").length, 1);
    assert.ok(screen.getByRole("option", { name: /Sidebar tree/ }));
  });

  it("sessions mode: Enter switches to the highlighted session and closes", () => {
    const selected: PaletteSessionRow[] = [];
    const close: string[] = [];
    render(
      <CommandPalette
        open
        mode="sessions"
        actions={actions}
        sessions={sessions}
        onClose={() => close.push("close")}
        onSelectSession={(row) => selected.push(row)}
      />,
    );
    const input = screen.getByPlaceholderText("Search sessions…");
    fireEvent.change(input, { target: { value: "sidebar" } });
    fireEvent.keyDown(input, { key: "Enter" });
    assert.equal(selected.length, 1);
    assert.equal(selected[0]!.id, "s2");
    assert.deepEqual(close, ["close"]);
  });

  it("a starting query (Home's field) lands in the palette input", () => {
    render(
      <CommandPalette
        open
        mode="sessions"
        actions={actions}
        sessions={sessions}
        initialQuery="spire"
        onClose={() => undefined}
        onSelectSession={() => undefined}
      />,
    );
    const input = screen.getByPlaceholderText("Search sessions…") as HTMLInputElement;
    assert.equal(input.value, "spire");
    assert.equal(screen.getAllByRole("option").length, 1);
  });
});
