import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandAtMentions } from "./expandMentions.js";

describe("expandAtMentions", () => {
  it("injects file bodies for @paths", async () => {
    const out = await expandAtMentions("See @src/a.ts please", async (p) => {
      assert.equal(p, "src/a.ts");
      return { content: "export const x = 1;" };
    });
    assert.match(out, /File: src\/a\.ts/);
    assert.match(out, /export const x = 1/);
  });

  it("no-ops without mentions", async () => {
    const out = await expandAtMentions("plain", async () => {
      throw new Error("should not read");
    });
    assert.equal(out, "plain");
  });
});
