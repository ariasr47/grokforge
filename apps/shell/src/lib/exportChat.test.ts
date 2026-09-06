import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestChatFilename, transcriptToMarkdown } from "./exportChat.js";

describe("transcriptToMarkdown", () => {
  it("skips tools and labels roles", () => {
    const md = transcriptToMarkdown({
      title: "Japan Q3",
      mode: "chat",
      messages: [
        { id: "1", role: "user", content: "Hello" },
        { id: "2", role: "tool", content: "noise", toolMeta: { name: "x" } },
        { id: "3", role: "assistant", content: "Hi there" },
      ],
    });
    assert.match(md, /# Japan Q3/);
    assert.match(md, /## You/);
    assert.match(md, /## Grok/);
    assert.doesNotMatch(md, /noise/);
  });
});

describe("suggestChatFilename", () => {
  it("sanitizes title", () => {
    const n = suggestChatFilename("My Report!!!");
    assert.match(n, /^grokforge-my-report-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
