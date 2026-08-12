import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitUnifiedDiff } from "./diffUtil.js";

describe("splitUnifiedDiff", () => {
  it("splits before/after lines from a unified hunk", () => {
    const diff = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-old",
      "+new",
      " line3",
    ].join("\n");
    const { before, after, header } = splitUnifiedDiff(diff);
    assert.ok(header.some((h) => h.startsWith("@@")));
    assert.deepEqual(before, ["line1", "old", "line3"]);
    assert.deepEqual(after, ["line1", "new", "line3"]);
  });

  it("normalizes CRLF", () => {
    const { after } = splitUnifiedDiff(
      "--- a\r\n+++ b\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n",
    );
    assert.deepEqual(after, ["new"]);
  });
});
