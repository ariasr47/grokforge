import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatToolInput,
  summarizeToolInput,
  truncateToolBody,
} from "./toolFormat.js";

describe("truncateToolBody", () => {
  it("leaves short text alone and truncates long", () => {
    assert.equal(truncateToolBody("hi", 10), "hi");
    const long = "x".repeat(50);
    const out = truncateToolBody(long, 20);
    assert.ok(out.startsWith("x".repeat(20)));
    assert.match(out, /more chars/);
  });
});

describe("summarizeToolInput", () => {
  it("prefers command then path then query", () => {
    assert.equal(
      summarizeToolInput("run_shell", { command: "npm test" }),
      "npm test",
    );
    assert.equal(
      summarizeToolInput("read_file", { path: "src/App.tsx" }),
      "src/App.tsx",
    );
    assert.equal(
      summarizeToolInput("search", { query: "TODO" }),
      "TODO",
    );
  });
});

describe("formatToolInput", () => {
  it("pretty-prints objects", () => {
    const out = formatToolInput({ path: "a.ts" });
    assert.match(out, /"path"/);
  });
});
