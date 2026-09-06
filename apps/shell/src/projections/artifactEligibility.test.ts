import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LONG_MARKDOWN_T,
  elevateArtifact,
  type ElevateKind,
} from "./artifactEligibility.js";

const carousel = {
  version: 1,
  blocks: [
    {
      type: "carousel",
      title: "Sides",
      items: [{ title: "Rice", body: "Short-grain.", badge: "Essential" }],
    },
  ],
};

function fencedGrokUi(doc: unknown): string {
  return "```grok-ui\n" + JSON.stringify(doc) + "\n```";
}

function failedFence(): string {
  return "```grok-ui\nnot-json{{{{{\n```";
}

function prose(n: number, ch = "a"): string {
  return ch.repeat(n);
}

describe("elevateArtifact exclusive kind", () => {
  it("T constant is 1500 UTF-16", () => {
    assert.equal(LONG_MARKDOWN_T, 1500);
  });

  it("short fenced carousel → rich-document at any length", () => {
    const text = "Intro. " + fencedGrokUi(carousel);
    const r = elevateArtifact(text);
    assert.equal(r.kind, "rich-document");
    assert.equal(r.body, text);
  });

  it("mixed prose + successful grok-ui → rich-document", () => {
    const text = "Prep notes.\n\n" + fencedGrokUi(carousel) + "\n\n### Sauces\n- Tare";
    assert.equal(elevateArtifact(text).kind, "rich-document");
  });

  it("successful grok-ui + extra failed fence → still rich-document", () => {
    const text = fencedGrokUi(carousel) + "\n\n" + failedFence();
    assert.equal(elevateArtifact(text).kind, "rich-document");
  });

  it("long-markdown at exactly 1500 non-failed UTF-16; 1499 is none", () => {
    assert.equal(elevateArtifact(prose(1499)).kind, "none");
    assert.equal(elevateArtifact(prose(1500)).kind, "long-markdown");
    assert.equal(elevateArtifact(prose(1500)).body, prose(1500));
  });

  it("failed-only / incomplete-only never itself mints Open even at ≥ 1500", () => {
    const dump = "```grok-ui\n" + prose(1600, "x") + "\n```";
    assert.equal(elevateArtifact(dump).kind, "none");
    assert.equal(elevateArtifact(failedFence()).kind, "none");
  });

  it("mixed failed fence + ≥ 1500 non-failed remainder → long-markdown; body is remainder", () => {
    const remainder = prose(1500, "p");
    const text = failedFence() + "\n\n" + remainder;
    const r = elevateArtifact(text);
    assert.equal(r.kind, "long-markdown");
    assert.ok(r.body);
    assert.equal(r.body!.includes("```grok-ui"), false);
    assert.equal(r.body!.includes("not-json"), false);
    assert.ok(r.body!.length >= LONG_MARKDOWN_T);
    assert.match(r.body!, /p{1500}/);
  });

  it("never uses whole-string rich parse as the only elevatability path", () => {
    // Bare whole-body JSON is not the live Chat shape; elevatability must still
    // go through parseMarkdownBlocks → parseRichDocument(block.code).
    const bare = JSON.stringify(carousel);
    const kind = elevateArtifact(bare).kind as ElevateKind;
    // May be none or rich-document depending on lift — assert it is not long-markdown
    // solely from JSON length, and that a fenced twin is rich-document.
    assert.notEqual(elevateArtifact(fencedGrokUi(carousel)).kind, "none");
    assert.ok(kind === "none" || kind === "rich-document");
  });
});
