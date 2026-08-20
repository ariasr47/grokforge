import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRichUiLang,
  liftUnfencedRichUi,
  parseRichDocument,
} from "./richUi.js";

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

  it("accepts map, download, image, actions, and embed", () => {
    const doc = parseRichDocument(
      JSON.stringify({
        blocks: [
          { type: "map", query: "Tokyo Tower", label: "Tokyo" },
          {
            type: "download",
            name: "notes.txt",
            content: "hello",
            mime: "text/plain",
          },
          {
            type: "image",
            src: "https://example.com/a.png",
            alt: "A",
          },
          {
            type: "actions",
            items: [
              { label: "Open", href: "https://example.com/x" },
              { label: "Pick me", value: "yes" },
            ],
          },
          { type: "embed", provider: "youtube", id: "dQw4w9WgXcQ" },
        ],
      }),
    );
    assert.ok(doc);
    assert.deepEqual(
      doc!.blocks.map((b) => b.type),
      ["map", "download", "image", "actions", "embed"],
    );
  });

  it("rejects javascript image src, raw iframe src, and junk embed ids", () => {
    const doc = parseRichDocument(
      JSON.stringify({
        blocks: [
          { type: "image", src: "javascript:alert(1)" },
          { type: "map", src: "https://evil.example/embed" },
          { type: "embed", provider: "youtube", id: "../../x" },
          { type: "download", name: "x", href: "http://insecure.example/a" },
        ],
      }),
    );
    assert.equal(doc, null);
  });

  it("keeps recommended on a decision option", () => {
    const doc = parseRichDocument(
      JSON.stringify({
        blocks: [
          {
            type: "decision",
            prompt: "Ship?",
            options: [
              { label: "Yes", recommended: true },
              { label: "Hold" },
            ],
          },
        ],
      }),
    );
    assert.ok(doc);
    if (doc!.blocks[0]!.type === "choices") {
      assert.equal(doc!.blocks[0].options[0]!.recommended, true);
      assert.equal(doc!.blocks[0].options[1]!.recommended, undefined);
    }
  });
});

describe("liftUnfencedRichUi", () => {
  it("lifts inline grok-ui {json} into a fence so mixed prose still parses", () => {
    const payload = {
      version: 1,
      blocks: [
        {
          type: "metrics",
          title: "Quick verdict",
          items: [{ label: "Demand", value: "Real", hint: "People already pay" }],
        },
        {
          type: "callout",
          tone: "warn",
          title: "The blocker is not the UI",
          body: "Official APIs do not give those lists.",
        },
      ],
    };
    const src =
      "The idea is real demand. grok-ui " +
      JSON.stringify(payload) +
      "  ## Judgment\n**The job is proven.**";
    const lifted = liftUnfencedRichUi(src);
    assert.match(lifted, /```grok-ui\n\{/);
    assert.ok(lifted.includes("## Judgment"));
    assert.ok(lifted.includes("The idea is real demand."));
    assert.ok(!lifted.includes("grok-ui {"));
  });

  it("leaves already-fenced grok-ui as a canonical fence and does not lift JSON inside other fences", () => {
    const fenced =
      "Intro\n\n```grok-ui\n" +
      JSON.stringify({ blocks: [{ type: "callout", body: "hi" }] }) +
      "\n```\n";
    const lifted = liftUnfencedRichUi(fenced);
    assert.match(lifted, /```grok-ui\n\{"blocks":/);
    assert.ok(lifted.includes("Intro"));
    assert.ok(!lifted.includes("```grok-ui {"));

    const code =
      "```js\nconst x = { \"version\": 1, \"blocks\": [{ \"type\": \"callout\", \"body\": \"no\" }] };\n```";
    assert.equal(liftUnfencedRichUi(code), code);
  });

  it("does not lift an incomplete grok-ui object", () => {
    const src = 'Hello grok-ui { "version": 1, "blocks": [';
    assert.equal(liftUnfencedRichUi(src), src);
  });

  it("lifts a same-line ```grok-ui {json}``` fence mid-prose", () => {
    const payload = {
      version: 1,
      blocks: [
        { type: "callout", tone: "info", title: "Hosting rule", body: "Plan 4–6 sides." },
      ],
    };
    const src =
      "Make most sides ahead. ```grok-ui " +
      JSON.stringify(payload) +
      " ``` ### Sauces\n- Tare";
    const lifted = liftUnfencedRichUi(src);
    assert.match(lifted, /```grok-ui\n\{/);
    assert.ok(lifted.includes("### Sauces"));
    assert.ok(lifted.includes("Make most sides ahead."));
    assert.ok(!lifted.includes("```grok-ui {"));
  });

  it("lifts two same-line grok-ui fences without swallowing the rest of the answer", () => {
    const first = {
      version: 1,
      blocks: [{ type: "callout", tone: "info", title: "Hosting rule", body: "Plan 4–6 sides." }],
    };
    const second = {
      version: 1,
      blocks: [
        { type: "tabs", tabs: [{ label: "Simple menu", body: "Rice + kimchi." }] },
        { type: "checklist", title: "Shopping", items: [{ text: "Rice", done: false }] },
      ],
    };
    const src =
      "Between bites. ```grok-ui " +
      JSON.stringify(first) +
      " ``` ### Sauces (put 2–3 on the table)\n- Tare\n```grok-ui " +
      JSON.stringify(second) +
      " ``` ### Easy namul";
    const lifted = liftUnfencedRichUi(src);
    const fences = lifted.split("```grok-ui\n");
    assert.equal(fences.length, 3);
    assert.ok(lifted.includes("### Sauces"));
    assert.ok(lifted.includes("### Easy namul"));
    assert.ok(lifted.includes("- Tare"));
  });
});
