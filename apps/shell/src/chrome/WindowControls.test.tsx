// Task 4 — frameless window caption buttons. Outside Tauri (browser-dev
// path) there is no native window to control, so the component must render
// nothing; inside Tauri it must expose the three caption buttons by their
// accessible names.
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { WindowControls } from "./WindowControls";
import { installTauriGlobal } from "../app/testFakeHost";

afterEach(() => cleanup());

describe("WindowControls", () => {
  it("renders nothing outside Tauri", () => {
    const { container } = render(<WindowControls />);
    assert.equal(container.firstChild, null);
  });

  it("renders minimize, maximize, and close buttons when Tauri is installed", () => {
    const restoreTauri = installTauriGlobal();
    render(<WindowControls />);
    assert.ok(screen.getByRole("button", { name: "Minimize" }));
    assert.ok(screen.getByRole("button", { name: "Maximize" }));
    assert.ok(screen.getByRole("button", { name: "Close" }));
    restoreTauri();
  });
});
