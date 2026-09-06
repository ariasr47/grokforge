import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectSrc } from "./csp.js";

describe("connectSrc", () => {
  it("prod pins the prod ladder and github updater hosts, not a wildcard port", () => {
    const src = connectSrc("prod");
    assert.ok(src.includes("http://127.0.0.1:8787"));
    assert.ok(src.includes("ws://127.0.0.1:8806"));
    assert.ok(src.includes("https://github.com"));
    assert.equal(src.includes("127.0.0.1:*"), false);
    assert.equal(src.includes("8788"), false);
  });

  it("dev pins the dev ladder and Vite", () => {
    const src = connectSrc("dev");
    assert.ok(src.includes("http://127.0.0.1:8788"));
    assert.ok(src.includes("http://localhost:5174"));
    assert.equal(src.includes("8787"), false);
  });
});
