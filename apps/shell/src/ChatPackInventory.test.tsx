import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PACK_COMPOSER_CONFIRM_ERROR,
  PACK_COMPOSER_LOADING,
  PACK_COMPOSER_OFFLINE,
  PACK_COMPOSER_PIN_FAILED,
} from "./chatPackComposer";
import {
  ChatPackInventory,
  PACK_INVENTORY_EMPTY,
  PACK_INVENTORY_UPDATING,
} from "./ChatPackInventory";

afterEach(() => cleanup());

const noop = {
  onPin: () => undefined,
  onUnpin: () => undefined,
  onSaveNote: () => undefined,
  onClearNote: () => undefined,
  onClearPack: () => undefined,
};

test("absent_code renders nothing", () => {
  const { container } = render(
    <ChatPackInventory
      projection={{ state: "absent_code" }}
      members={{ files: [{ path: "a.md" }], note: "n" }}
      {...noop}
    />,
  );
  assert.equal(container.textContent, "");
});

test("empty shows Nothing pinned yet copy", () => {
  render(
    <ChatPackInventory
      projection={{ state: "empty" }}
      members={{ files: [], note: null }}
      {...noop}
    />,
  );
  assert.ok(screen.getByText(PACK_INVENTORY_EMPTY));
});

test("loading / offline / confirm_error hide members", () => {
  const members = { files: [{ path: "secret.md" }], note: "hidden note" };
  const { rerender } = render(
    <ChatPackInventory projection={{ state: "loading" }} members={members} {...noop} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_LOADING));
  assert.equal(screen.queryByText("secret.md") === null, true);
  assert.equal(screen.queryByText("hidden note") === null, true);
  rerender(
    <ChatPackInventory projection={{ state: "offline" }} members={members} {...noop} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_OFFLINE));
  assert.equal(screen.queryByText("secret.md") === null, true);
  rerender(
    <ChatPackInventory projection={{ state: "confirm_error" }} members={members} {...noop} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_CONFIRM_ERROR));
  assert.equal(screen.queryByText("secret.md") === null, true);
});

test("armed lists Geist Mono paths and note; pin_failed keeps prior members", () => {
  const { rerender } = render(
    <ChatPackInventory
      projection={{ state: "armed", fileCount: 1, hasNote: true }}
      members={{ files: [{ path: "notes/brief.md" }], note: "ship it" }}
      {...noop}
    />,
  );
  const path = screen.getByText("notes/brief.md");
  assert.ok(path.className.includes("chat-pack-path"));
  assert.ok(document.querySelector("[data-chat-pack-note='armed']")?.textContent?.includes("ship it"));
  rerender(
    <ChatPackInventory
      projection={{ state: "pin_failed", fileCount: 1, hasNote: true }}
      members={{ files: [{ path: "notes/brief.md" }], note: "ship it" }}
      {...noop}
    />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_PIN_FAILED));
  assert.ok(screen.getByText("notes/brief.md"));
});

test("mutation in flight shows Updating pack…", () => {
  render(
    <ChatPackInventory
      projection={{ state: "armed", fileCount: 1, hasNote: false }}
      members={{ files: [{ path: "a.md" }], note: null }}
      mutationInFlight
      {...noop}
    />,
  );
  assert.ok(screen.getByText(PACK_INVENTORY_UPDATING));
});

test("Pin a confined workspace file", async () => {
  let pinned = "";
  render(
    <ChatPackInventory
      projection={{ state: "empty" }}
      members={{ files: [], note: null }}
      workspaceFiles={["notes/brief.md", "out/skip.bin"]}
      {...noop}
      onPin={(p) => {
        pinned = p;
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pin notes/brief.md" }));
  assert.equal(pinned, "notes/brief.md");
});
