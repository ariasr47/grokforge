import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapApiError } from "./xai.js";

describe("mapApiError", () => {
  it("maps status codes to stable codes", () => {
    assert.equal(mapApiError(401, "nope").code, "auth_expired");
    assert.equal(mapApiError(403, "nope").code, "auth_forbidden");
    assert.equal(mapApiError(429, "slow").code, "rate_limit");
    assert.equal(mapApiError(500, "boom").code, "upstream_error");
    assert.equal(mapApiError(418, "teapot").code, "api_error");
  });
});
