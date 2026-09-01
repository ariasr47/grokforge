import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { CodeBlock } from "./markdown.js";
import {
  __resetHighlighterForTests,
  __setHighlighterLoaderForTests,
} from "./codeHighlightAsync.js";

afterEach(() => {
  cleanup();
  __setHighlighterLoaderForTests(null);
  __resetHighlighterForTests();
});

describe("one-line unlabeled fence", () => {
  it("is compact: no CODE / 1 LINES bar", () => {
    __setHighlighterLoaderForTests(async () => null);
    const { container } = render(createElement(CodeBlock, { code: "NEXT-OK" }));
    assert.match(container.textContent ?? "", /NEXT-OK/);
    assert.equal(container.querySelector(".md-code-bar"), null);
    assert.ok(container.querySelector(".md-code-wrap.is-oneline"));
  });

  it("typed one-line fence keeps the language bar", () => {
    __setHighlighterLoaderForTests(async () => null);
    const { container } = render(
      createElement(CodeBlock, { code: "Set-Location apps/shell", lang: "powershell" }),
    );
    assert.ok(container.querySelector(".md-code-bar"));
    assert.match(container.textContent ?? "", /powershell/i);
  });
});

describe("unlabeled multi-line fence is not a CODE card", () => {
  it("checkmark test dump has no invented CODE / N LINES bar", () => {
    __setHighlighterLoaderForTests(async () => null);
    const code = "✔ collapsed write header shows the path, not write\n✔ collapsed run-tools header shows the shell command";
    const { container } = render(createElement(CodeBlock, { code }));
    assert.equal(container.querySelector(".md-code-bar"), null);
    assert.ok(container.querySelector(".md-code-wrap.is-plain"));
    assert.equal(/\bCODE\b/i.test(container.textContent ?? ""), false);
    assert.equal(/lines/i.test(container.textContent ?? ""), false);
    assert.ok(container.querySelector(".md-copy-btn"));
    assert.match(container.textContent ?? "", /collapsed write header/);
  });

  it("typed multi-line fence still has a language bar", () => {
    __setHighlighterLoaderForTests(async () => null);
    const { container } = render(
      createElement(CodeBlock, { code: "const a = 1\nconst b = 2", lang: "ts" }),
    );
    assert.ok(container.querySelector(".md-code-bar"));
    assert.ok(container.querySelector(".md-code-lang"));
  });
});
