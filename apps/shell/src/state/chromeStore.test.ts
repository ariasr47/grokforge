import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { useChromeStore } from "./chromeStore.js";

describe("chromeStore", () => {
  beforeEach(() => {
    useChromeStore.setState({
      paletteOpen: false,
      peek: null,
      dragOver: false,
    });
  });

  it("toggles the command palette without touching peek", () => {
    useChromeStore.getState().setPaletteOpen(true);
    assert.equal(useChromeStore.getState().paletteOpen, true);
    assert.equal(useChromeStore.getState().peek, null);
    useChromeStore.getState().setPaletteOpen((open) => !open);
    assert.equal(useChromeStore.getState().paletteOpen, false);
  });

  it("openPalette opens with a mode and an optional query, defaulting the query to empty", () => {
    useChromeStore.getState().openPalette("sessions", "sidebar tree");
    assert.equal(useChromeStore.getState().paletteOpen, true);
    assert.equal(useChromeStore.getState().paletteMode, "sessions");
    assert.equal(useChromeStore.getState().paletteQuery, "sidebar tree");

    useChromeStore.getState().openPalette("commands");
    assert.equal(useChromeStore.getState().paletteMode, "commands");
    assert.equal(useChromeStore.getState().paletteQuery, "");
  });
});
