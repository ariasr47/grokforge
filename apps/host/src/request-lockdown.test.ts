import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWED_ORIGINS,
  isJsonContentType,
  isOriginAllowed,
  requestHasBody,
} from "./request-lockdown.js";

describe("isOriginAllowed", () => {
  it("allows a request with no Origin header at all", () => {
    assert.equal(isOriginAllowed(undefined), true);
    assert.equal(isOriginAllowed(null), true);
    assert.equal(isOriginAllowed(""), true);
  });

  it("allows exactly the shell's own dev origins", () => {
    for (const o of ALLOWED_ORIGINS) {
      assert.equal(isOriginAllowed(o), true);
    }
  });

  it("refuses a foreign origin", () => {
    assert.equal(isOriginAllowed("https://evil.example"), false);
  });

  it("refuses a near-miss origin (different port / scheme / trailing slash / suffix domain)", () => {
    assert.equal(isOriginAllowed("http://localhost:5199"), false);
    assert.equal(isOriginAllowed("https://tauri.localhost"), false);
    assert.equal(isOriginAllowed("http://tauri.localhost/"), false);
    assert.equal(isOriginAllowed("http://tauri.localhost.evil.com"), false);
  });
});

describe("isJsonContentType", () => {
  it("accepts application/json, case-insensitively", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("Application/JSON"), true);
  });

  it("accepts application/json with a charset suffix", () => {
    assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
  });

  it("refuses text/plain and other non-JSON types", () => {
    assert.equal(isJsonContentType("text/plain"), false);
    assert.equal(isJsonContentType("application/x-www-form-urlencoded"), false);
  });

  it("refuses a missing content-type", () => {
    assert.equal(isJsonContentType(undefined), false);
    assert.equal(isJsonContentType(null), false);
    assert.equal(isJsonContentType(""), false);
  });
});

describe("requestHasBody", () => {
  it("is false with no content-length or transfer-encoding (e.g. POST /api/cancel)", () => {
    assert.equal(requestHasBody({}), false);
    assert.equal(requestHasBody({ "content-length": "0" }), false);
  });

  it("is true with a positive content-length", () => {
    assert.equal(requestHasBody({ "content-length": "12" }), true);
  });

  it("is true with a chunked transfer-encoding regardless of content-length", () => {
    assert.equal(requestHasBody({ "transfer-encoding": "chunked" }), true);
  });
});
