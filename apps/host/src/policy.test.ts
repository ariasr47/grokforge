import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampEffort } from "./policy.js";

describe("clampEffort", () => {
  it("allows auto always", () => {
    assert.equal(clampEffort("auto", "fast"), "auto");
  });
  it("caps heavy to max", () => {
    assert.equal(clampEffort("heavy", "fast"), "fast");
    assert.equal(clampEffort("expert", "fast"), "fast");
    assert.equal(clampEffort("fast", "expert"), "fast");
  });
});
