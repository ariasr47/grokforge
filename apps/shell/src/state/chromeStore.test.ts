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
});
