import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRichUiLang, parseRichDocument } from "./richUi.js";

describe("isRichUiLang", () => {
  it("accepts grok-ui aliases", () => {
    assert.equal(isRichUiLang("grok-ui"), true);
    assert.equal(isRichUiLang("ui"), true);
    assert.equal(isRichUiLang("javascript"), false);
  });
});

describe("parseRichDocument", () => {
  it("sanitizes carousel and choices", () => {
    const doc = parseRichDocument(
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: "carousel",
            items: [
              { title: "Fast", body: "Quick", badge: "Rec" },
              { title: "Expert", body: "Deep" },
            ],
          },
          {
            type: "choices",
            prompt: "Pick",
            options: [{ label: "A" }, { label: "B", description: "bee" }],
          },
        ],
      }),
    );
    assert.ok(doc);
    assert.equal(doc!.blocks.length, 2);
    assert.equal(doc!.blocks[0]!.type, "carousel");
    assert.equal(doc!.blocks[1]!.type, "choices");
  });

  it("rejects unknown types and invalid JSON", () => {
    assert.equal(parseRichDocument("not-json"), null);
    const doc = parseRichDocument(
      JSON.stringify({ blocks: [{ type: "script", body: "alert(1)" }] }),
    );
    assert.equal(doc, null);
  });

  it("strips oversized option lists", () => {
    const options = Array.from({ length: 20 }, (_, i) => ({
      label: `Opt ${i}`,
    }));
    const doc = parseRichDocument(
      JSON.stringify({ blocks: [{ type: "choices", options }] }),
    );
    assert.ok(doc);
    if (doc!.blocks[0]!.type === "choices") {
      assert.ok(doc!.blocks[0].options.length <= 8);
    }
  });
});
