import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPdfReadFileFailureLabel,
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

describe("formatPdfReadFileFailureLabel", () => {
  it("appends vouched class from JSON output only", () => {
    const label = formatPdfReadFileFailureLabel(
      "Couldn't extract text from doc.pdf.",
      JSON.stringify({
        extract_failed: true,
        extract_failure_class: "encrypted",
      }),
    );
    assert.equal(
      label,
      "Couldn't extract text from doc.pdf. (encrypted)",
    );
  });

  it("does not invent a class from bare error", () => {
    assert.equal(
      formatPdfReadFileFailureLabel(
        "Couldn't extract text from doc.pdf.",
        null,
      ),
      "Couldn't extract text from doc.pdf.",
    );
  });

  it("ignores non-extract_failed JSON", () => {
    assert.equal(
      formatPdfReadFileFailureLabel("ENOENT", JSON.stringify({ error: "ENOENT" })),
      "ENOENT",
    );
  });
});

