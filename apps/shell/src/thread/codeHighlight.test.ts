import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFence,
  fenceInfoToken,
  shouldHighlight,
} from "./codeHighlight.js";

const OVERSIZE = Array.from({ length: 401 }, (_, i) => `line-${i}`).join("\n");

describe("fenceInfoToken", () => {
  it("takes the first whitespace-delimited token and ASCII case-folds", () => {
    assert.equal(fenceInfoToken("TypeScript title=\"x\""), "typescript");
    assert.equal(fenceInfoToken("  TS  "), "ts");
    assert.equal(fenceInfoToken(""), "");
    assert.equal(fenceInfoToken(undefined), "");
  });
});

describe("classifyFence partition", () => {
  it("explicit-plain includes typed plaintext (never unlabeled rich)", () => {
    for (const lang of ["text", "plain", "txt", "output", "plaintext", "TEXT"]) {
      const g = classifyFence("hi", lang);
      assert.equal(g.class, "explicit-plain");
      assert.equal(g.gatePassed, false);
      assert.equal(g.resolvedLang, null);
    }
  });

  it("empty token ≤400 → unlabeled; >400 → oversize", () => {
    const u = classifyFence("const x = 1", "");
    assert.equal(u.class, "unlabeled");
    assert.equal(u.gatePassed, true);
    assert.equal(u.resolvedLang, "plaintext");
    assert.equal(u.lineCount, 1);

    const o = classifyFence(OVERSIZE, "");
    assert.equal(o.class, "oversize");
    assert.equal(o.gatePassed, false);
  });

  it("aliases resolve onto closed LANGS; label token stays the typed alias", () => {
    const g = classifyFence("const x = 1", "ts");
    assert.equal(g.class, "loaded");
    assert.equal(g.token, "ts");
    assert.equal(g.resolvedLang, "typescript");
    assert.equal(g.gatePassed, true);
  });

  it("canonical tsx/jsx are loaded members, not aliases", () => {
    assert.equal(classifyFence("x", "tsx").resolvedLang, "tsx");
    assert.equal(classifyFence("x", "jsx").resolvedLang, "jsx");
  });

  it("loaded >400 → oversize; typed-unknown (incl grok-ui) is plain", () => {
    assert.equal(classifyFence(OVERSIZE, "typescript").class, "oversize");
    const u = classifyFence("fn main() {}", "zig");
    assert.equal(u.class, "typed-unknown");
    assert.equal(u.gatePassed, false);
    assert.equal(classifyFence("{}", "grok-ui").class, "typed-unknown");
  });

  it("empty body line count is 1", () => {
    assert.equal(classifyFence("", "typescript").lineCount, 1);
    assert.equal(classifyFence("", "typescript").class, "loaded");
  });
});

describe("shouldHighlight (= gatePassed)", () => {
  it("unknown is false; alias loaded is true; explicit-plain false", () => {
    assert.equal(shouldHighlight("zig", "x"), false);
    assert.equal(shouldHighlight("ts", "x"), true);
    assert.equal(shouldHighlight("text", "x"), false);
    assert.equal(shouldHighlight("", "x"), true);
    assert.equal(shouldHighlight("rust", OVERSIZE), false);
  });
});
