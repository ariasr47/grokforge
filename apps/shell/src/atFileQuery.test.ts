import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atFileQueryMatches, atFileSuggestions } from "./atFileQuery.js";

describe("atFileQueryMatches", () => {
  it("matches nested KEEP.md from a basename query", () => {
    assert.equal(atFileQueryMatches("docs/dogfood/KEEP.md", "KEEP"), true);
    assert.equal(atFileQueryMatches("docs/dogfood/KEEP.md", "docs/dogfood/KEEP.md"), true);
    assert.equal(atFileQueryMatches("docs\\dogfood\\KEEP.md", "KEEP.md"), true);
    assert.equal(atFileQueryMatches("apps/host/package.json", "KEEP"), false);
  });

  it("ranks KEEP.md ahead of forge-keep screenshots", () => {
    const files = [
      "docs/dogfood/forge-keep-ten.png",
      "docs/dogfood/forge-keep-thirty.png",
      "docs/brand/source/.gitkeep",
      "docs/dogfood/KEEP.md",
    ];
    assert.equal(atFileSuggestions(files, "KEEP")[0], "docs/dogfood/KEEP.md");
    assert.equal(atFileSuggestions(files, "KEEP.md")[0], "docs/dogfood/KEEP.md");
  });
});
