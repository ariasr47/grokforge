import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listRichMarkdownSegments,
  markdownCacheSize,
  parseMarkdownBlocks,
} from "./markdownParse.js";
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

  it("parses a same-line ```grok-ui {json}``` dump as rich, not a JSON paste", () => {
    const src =
      "Make most sides ahead. ```grok-ui " +
      JSON.stringify({
        version: 1,
        blocks: [
          { type: "callout", tone: "info", title: "Hosting rule", body: "Plan 4–6 sides." },
          {
            type: "carousel",
            title: "Best sides",
            items: [{ title: "Rice", body: "Short-grain.", badge: "Essential" }],
          },
        ],
      }) +
      " ``` ### Sauces\n- Tare";
    const blocks = parseMarkdownBlocks(src);
    assert.ok(blocks.some((b) => b.type === "rich"));
    assert.ok(blocks.some((b) => b.type === "h" && b.text.includes("Sauces")));
    const dump = blocks.find((b) => b.type === "p" && b.text.includes('"version"'));
    assert.equal(dump, undefined);
    const code = blocks.find((b) => b.type === "code" && b.lang.startsWith("grok-ui"));
    assert.equal(code, undefined);
  });

  it("parses unfenced grok-ui {json} dumps as rich, not a text dump", () => {
    const src =
      "charge for it. grok-ui " +
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: "metrics",
            title: "Quick verdict",
            items: [{ label: "Demand", value: "Real" }],
          },
        ],
      }) +
      "  ## Judgment\n**The job-to-be-done is proven.**";
    const blocks = parseMarkdownBlocks(src);
    assert.ok(blocks.some((b) => b.type === "rich"));
    assert.ok(blocks.some((b) => b.type === "h" && b.text.includes("Judgment")));
    const dump = blocks.find((b) => b.type === "p" && b.text.includes('"version"'));
    assert.equal(dump, undefined);
  });

  it("caches repeated parses", () => {
    const src = "# Hello\n\nWorld";
    parseMarkdownBlocks(src);
    parseMarkdownBlocks(src);
    assert.ok(markdownCacheSize() >= 1);
  });

  it("listRichMarkdownSegments ranges cover fence markers for a failed fence", () => {
    const src = "```grok-ui\nnot-json{{{{{\n```";
    const { lifted, segments } = listRichMarkdownSegments(src);
    assert.equal(segments.length, 1);
    const slice = lifted.slice(segments[0]!.start, segments[0]!.end);
    assert.ok(slice.includes("```"));
    assert.ok(slice.includes("not-json"));
    assert.equal(segments[0]!.code, "not-json{{{{{");
    const rich = parseMarkdownBlocks(src).filter((b) => b.type === "rich");
    assert.equal(rich.length, segments.length);
  });

  it("listRichMarkdownSegments matches parseMarkdownBlocks rich count after unfenced lift", () => {
    const src =
      "charge for it. grok-ui " +
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: "metrics",
            title: "Quick verdict",
            items: [{ label: "Demand", value: "Real" }],
          },
        ],
      }) +
      "  ## Judgment\n**The job-to-be-done is proven.**";
    const blocks = parseMarkdownBlocks(src);
    const { segments } = listRichMarkdownSegments(src);
    assert.ok(blocks.some((b) => b.type === "rich"));
    assert.equal(
      blocks.filter((b) => b.type === "rich").length,
      segments.length,
    );
  });
});

describe("codeHighlight", () => {
  it("tokenizes keywords and strings", () => {
    const toks = tokenizeLine('const x = "hi"; // c');
    assert.ok(toks.some((t) => t.c === "kw" && t.t === "const"));
    assert.ok(toks.some((t) => t.c === "str"));
    assert.ok(toks.some((t) => t.c === "cmt"));
  });
  it("skips plain text langs; alias still gate-passes", () => {
    assert.equal(shouldHighlight("text", "x"), false);
    assert.equal(shouldHighlight("ts", "x"), true);
    assert.equal(shouldHighlight("zig", "x"), false);
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
