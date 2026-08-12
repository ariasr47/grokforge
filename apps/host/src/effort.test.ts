import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEffort, resolveEffort } from "./effort.js";

describe("isEffort", () => {
  it("accepts known levels only", () => {
    assert.equal(isEffort("auto"), true);
    assert.equal(isEffort("fast"), true);
    assert.equal(isEffort("expert"), true);
    assert.equal(isEffort("heavy"), true);
    assert.equal(isEffort("turbo"), false);
    assert.equal(isEffort(null), false);
  });
});

describe("resolveEffort", () => {
  it("maps fast/expert/heavy bindings", () => {
    const base = "grok-4";
    assert.equal(resolveEffort("auto", base).model, base);
    assert.equal(resolveEffort("auto", base).reasoning_effort, undefined);
    assert.equal(resolveEffort("fast", base).reasoning_effort, "low");
    assert.equal(resolveEffort("expert", base).model, base);
    assert.equal(resolveEffort("expert", base).reasoning_effort, "high");
    assert.equal(resolveEffort("heavy", base).reasoning_effort, "high");
  });
});
