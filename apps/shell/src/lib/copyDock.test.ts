import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planLiveActivityReveal } from "./copyDock.js";

describe("planLiveActivityReveal", () => {
  it("keeps the live end even when a first activity header exists", () => {
    assert.equal(planLiveActivityReveal(true, true), "keep-end");
  });

  it("shows the header only when the operator has scrolled away", () => {
    assert.equal(planLiveActivityReveal(false, true), "show-header");
  });

  it("skips when there is no header and the operator is away", () => {
    assert.equal(planLiveActivityReveal(false, false), "skip");
  });
});
