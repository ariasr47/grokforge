import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MENTION_ATTACH_MARKER,
  expandAtMentions,
  splitUserPromptMentions,
  visibleUserPrompt,
} from "./expandMentions.js";

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

  it("visibleUserPrompt hides the attached dump", async () => {
    const typed = "@AGENTS.md Quote the first heading.";
    const out = await expandAtMentions(typed, async () => ({
      content: "# Spire OS — multi-provider workspace\nrest",
    }));
    assert.match(out, new RegExp(MENTION_ATTACH_MARKER.replace(/[[\]]/g, "\\$&")));
    assert.equal(visibleUserPrompt(out), typed);
    assert.equal(visibleUserPrompt("plain"), "plain");
  });
});

describe("splitUserPromptMentions", () => {
  it("keeps @path as its own mention token", () => {
    const parts = splitUserPromptMentions("@AGENTS.md Quote the first heading.");
    assert.deepEqual(parts, [
      { kind: "mention", value: "@AGENTS.md" },
      { kind: "text", value: " Quote the first heading." },
    ]);
  });
});
