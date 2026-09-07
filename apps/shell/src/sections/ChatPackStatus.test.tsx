import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ChatPackStatus,
  PACK_COMPOSER_ARMED_TOOLTIP,
  PACK_COMPOSER_CONFIRM_ERROR,
  PACK_COMPOSER_EMPTY,
  PACK_COMPOSER_HYDRATE_CAP,
  PACK_COMPOSER_HYDRATE_PATH,
  PACK_COMPOSER_LOADING,
  PACK_COMPOSER_NOTE_FAILED,
  PACK_COMPOSER_OFFLINE,
  PACK_COMPOSER_PIN_FAILED,
} from "./ChatPackStatus";

afterEach(() => cleanup());

test("Code / absent_code renders nothing", () => {
  const { container } = render(
    <ChatPackStatus projection={{ state: "absent_code" }} />,
  );
  assert.equal(container.textContent, "");
});

test("empty is muted No pinned pack — not error", () => {
  const { container } = render(
    <ChatPackStatus projection={{ state: "empty" }} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_EMPTY));
  assert.equal(container.querySelector("[data-chat-pack='empty']")?.className.includes("is-empty"), true);
  assert.equal(screen.queryByRole("alert") === null, true);
});

test("armed shows Pack · n files and Armed tooltip — never Included", () => {
  render(
    <ChatPackStatus
      projection={{ state: "armed", fileCount: 2, hasNote: true }}
    />,
  );
  const chip = screen.getByRole("button", { name: "Pack · 2 files · note" });
  assert.equal(chip.getAttribute("title"), PACK_COMPOSER_ARMED_TOOLTIP);
  assert.equal(chip.textContent?.includes("Included"), false);
  assert.ok(screen.getByRole("status"));
});

test("loading / offline / confirm_error exact copy", () => {
  const { rerender } = render(
    <ChatPackStatus projection={{ state: "loading" }} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_LOADING));
  rerender(<ChatPackStatus projection={{ state: "offline" }} />);
  assert.ok(screen.getByText(PACK_COMPOSER_OFFLINE));
  rerender(<ChatPackStatus projection={{ state: "confirm_error" }} />);
  assert.ok(screen.getByText(PACK_COMPOSER_CONFIRM_ERROR));
  assert.ok(screen.getByRole("alert"));
});

test("pin / note / hydrate refuse copy — hydrate cap vs path", () => {
  const { rerender } = render(
    <ChatPackStatus projection={{ state: "pin_failed", fileCount: 1, hasNote: false }} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_PIN_FAILED));
  rerender(
    <ChatPackStatus projection={{ state: "note_failed", fileCount: 1, hasNote: true }} />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_NOTE_FAILED));
  rerender(
    <ChatPackStatus
      projection={{ state: "hydrate_failed", fileCount: 0, hasNote: false, overCap: false }}
    />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_HYDRATE_PATH));
  rerender(
    <ChatPackStatus
      projection={{ state: "hydrate_failed", fileCount: 0, hasNote: false, overCap: true }}
    />,
  );
  assert.ok(screen.getByText(PACK_COMPOSER_HYDRATE_CAP));
});
