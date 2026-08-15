import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEffort, modelFallbackChain, resolveEffort } from "./effort.js";

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

describe("modelFallbackChain", () => {
  it("leads with the resolved model and appends other known-good candidates", () => {
    const chain = modelFallbackChain(resolveEffort("auto", "grok-does-not-exist-9"));
    assert.equal(chain[0], "grok-does-not-exist-9");
    assert.ok(chain.length >= 2, "expected at least one fallback candidate");
    assert.ok(chain.includes("grok-4"));
  });

  it("de-duplicates when the resolved model is already a known-good candidate", () => {
    const chain = modelFallbackChain(resolveEffort("heavy", "grok-4"));
    assert.equal(new Set(chain).size, chain.length);
    assert.equal(chain[0], "grok-4");
  });

  it("never returns an empty chain", () => {
    const chain = modelFallbackChain(resolveEffort("fast", "grok-4"));
    assert.ok(chain.length >= 1);
  });
});
