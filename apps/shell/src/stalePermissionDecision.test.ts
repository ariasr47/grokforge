import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api";
import { isStalePermissionDecision } from "./stalePermissionDecision";

test("decision_not_found is a stale settle, not a crash banner", () => {
  assert.equal(
    isStalePermissionDecision(
      new ApiError(404, { error: "no pending permission", code: "decision_not_found" }),
    ),
    true,
  );
});

test("unrelated failures still count as errors", () => {
  assert.equal(isStalePermissionDecision(new Error("host offline")), false);
  assert.equal(
    isStalePermissionDecision(new ApiError(500, { error: "boom", code: "internal" })),
    false,
  );
});
