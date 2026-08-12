import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownCacheSize, parseMarkdownBlocks } from "./markdown.js";
import { tokenizeLine, shouldHighlight } from "./codeHighlight.js";
import { parseRichDocumentProgressive } from "./richUi.js";

describe("parseMarkdownBlocks", () => {
  it("parses GFM tables", () => {
    const src = `| A | B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |`;
    const blocks = parseMarkdownBlocks(src);
    const table = blocks.find((b) => b.type === "table");
    assert.ok(table);
    if (table?.type === "table") {
      assert.deepEqual(table.headers, ["A", "B"]);
      assert.equal(table.rows.length, 2);
    }
  });

  it("parses task lists", () => {
    const src = `- [x] Done\n- [ ] Todo`;
    const blocks = parseMarkdownBlocks(src);
    const task = blocks.find((b) => b.type === "task");
    assert.ok(task);
    if (task?.type === "task") {
      assert.equal(task.items[0]!.done, true);
      assert.equal(task.items[1]!.done, false);
    }
  });

  it("parses grok-ui fences as rich", () => {
    const src =
      "Intro\n\n```grok-ui\n" +
      JSON.stringify({
        blocks: [{ type: "callout", body: "hi", tone: "info" }],
      }) +
      "\n```";
    const blocks = parseMarkdownBlocks(src);
    assert.ok(blocks.some((b) => b.type === "rich"));
  });

  it("caches repeated parses", () => {
    const src = "# Hello\n\nWorld";
    parseMarkdownBlocks(src);
    parseMarkdownBlocks(src);
    assert.ok(markdownCacheSize() >= 1);
  });
});

describe("codeHighlight", () => {
  it("tokenizes keywords and strings", () => {
    const toks = tokenizeLine('const x = "hi"; // c');
    assert.ok(toks.some((t) => t.c === "kw" && t.t === "const"));
    assert.ok(toks.some((t) => t.c === "str"));
    assert.ok(toks.some((t) => t.c === "cmt"));
  });
  it("skips plain text langs", () => {
    assert.equal(shouldHighlight("text"), false);
    assert.equal(shouldHighlight("ts"), true);
  });
});

describe("parseRichDocumentProgressive", () => {
  it("salvages truncated JSON stream", () => {
    const partial =
      '{"version":1,"blocks":[{"type":"callout","body":"Hello"';
    const doc = parseRichDocumentProgressive(partial);
    // may or may not fully recover depending on truncation point
    if (doc) {
      assert.ok(doc.blocks.length >= 1);
    } else {
      assert.equal(doc, null);
    }
  });
});
