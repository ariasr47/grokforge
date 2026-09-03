import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PI_COMPOSER_EMPTY,
  PI_COMPOSER_ERROR,
  PI_COMPOSER_LOADED_LABEL,
  PI_COMPOSER_LOADING,
  PI_COMPOSER_OFFLINE,
  piComposerLoadedTitle,
} from "./projectInstructionsComposer";
import { ProjectInstructionsStatus } from "./ProjectInstructionsStatus";

afterEach(() => cleanup());

test("loaded shows Project instructions · AGENTS.md + tooltip", () => {
  render(
    <ProjectInstructionsStatus
      projection={{ state: "loaded", path: "AGENTS.md" }}
    />,
  );
  assert.ok(screen.getByText(PI_COMPOSER_LOADED_LABEL));
  const path = screen.getByText("AGENTS.md");
  assert.ok(path);
  assert.equal(path.getAttribute("title"), piComposerLoadedTitle("AGENTS.md"));
  const status = screen.getByRole("status");
  assert.match(status.textContent ?? "", /Project instructions/);
  assert.match(status.textContent ?? "", /AGENTS.md/);
  assert.match(status.textContent ?? "", /·/);
});

test("empty shows No project instructions — not danger", () => {
  const { container } = render(
    <ProjectInstructionsStatus projection={{ state: "empty" }} />,
  );
  const el = screen.getByText(PI_COMPOSER_EMPTY);
  assert.ok(el);
  assert.equal(el.closest("[data-project-instructions]")?.getAttribute("data-project-instructions"), "empty");
  assert.equal(container.querySelector("[data-project-instructions='error']") === null, true);
  assert.equal(screen.queryByRole("alert") === null, true);
  assert.equal(screen.queryByText(PI_COMPOSER_ERROR) === null, true);
});

test("error shows Couldn’t resolve project instructions. and does not print path", () => {
  const { container } = render(
    <ProjectInstructionsStatus projection={{ state: "error" }} />,
  );
  assert.ok(screen.getByText(PI_COMPOSER_ERROR));
  assert.equal(screen.queryByText("AGENTS.md") === null, true);
  assert.equal(screen.queryByText("CLAUDE.md") === null, true);
  assert.equal(container.textContent?.includes("AGENTS.md"), false);
  assert.ok(screen.getByRole("alert"));
  assert.equal(screen.queryByText(PI_COMPOSER_EMPTY) === null, true);
});

test("loading / offline exact copy", () => {
  const { rerender } = render(
    <ProjectInstructionsStatus projection={{ state: "loading" }} />,
  );
  assert.ok(screen.getByText(PI_COMPOSER_LOADING));
  rerender(<ProjectInstructionsStatus projection={{ state: "offline" }} />);
  assert.ok(screen.getByText(PI_COMPOSER_OFFLINE));
  assert.equal(screen.queryByText(PI_COMPOSER_LOADING) === null, true);
});

test("absent_chat and disabled_no_workspace render null / no empty copy", () => {
  const chat = render(
    <ProjectInstructionsStatus projection={{ state: "absent_chat" }} />,
  );
  assert.equal(chat.container.textContent, "");
  assert.equal(screen.queryByText(PI_COMPOSER_EMPTY) === null, true);
  chat.unmount();

  const none = render(
    <ProjectInstructionsStatus projection={{ state: "disabled_no_workspace" }} />,
  );
  assert.equal(none.container.textContent, "");
  assert.equal(screen.queryByText(PI_COMPOSER_EMPTY) === null, true);
});

test("path uses mono; long path truncates with title full path", () => {
  render(
    <ProjectInstructionsStatus
      projection={{ state: "loaded", path: "AGENTS.md" }}
    />,
  );
  const path = screen.getByText("AGENTS.md");
  assert.ok(path.className.includes("project-instructions-path"));
  assert.equal(path.getAttribute("title"), piComposerLoadedTitle("AGENTS.md"));
});

test("never prints Agents.md as a recognized v1 name", () => {
  const { container } = render(
    <ProjectInstructionsStatus
      projection={{ state: "loaded", path: "AGENTS.md" }}
    />,
  );
  assert.equal(container.textContent?.includes("Agents.md"), false);
});
