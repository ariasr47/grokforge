import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installCrashSink, recentCrashes } from "./crashSink.js";

describe("crashSink", () => {
  it("records window error events", () => {
    installCrashSink();
    window.dispatchEvent(new ErrorEvent("error", { message: "boom-test", filename: "x.ts", lineno: 9 }));
    assert.ok(recentCrashes().some((line) => line.includes("boom-test") && line.includes("x.ts:9")));
  });
});
