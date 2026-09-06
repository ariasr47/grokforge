import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timeAgo } from "./timeAgo.js";

describe("timeAgo", () => {
  const now = 1_700_000_000_000;

  it("buckets relative times", () => {
    assert.equal(timeAgo(now - 10_000, now), "just now");
    assert.equal(timeAgo(now - 60_000, now), "1m ago");
    assert.equal(timeAgo(now - 5 * 60_000, now), "5m ago");
    assert.equal(timeAgo(now - 2 * 3600_000, now), "2h ago");
    assert.equal(timeAgo(now - 3 * 86400_000, now), "3d ago");
  });
});
