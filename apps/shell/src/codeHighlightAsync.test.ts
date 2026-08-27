import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  appearanceToShikiTheme,
  highlightToHtml,
  __resetHighlighterForTests,
  __setHighlighterLoaderForTests,
} from "./codeHighlightAsync.js";

afterEach(() => {
  __setHighlighterLoaderForTests(null);
  __resetHighlighterForTests();
});

describe("appearanceToShikiTheme", () => {
  it("maps light → github-light; voidglass/aeon → github-dark", () => {
    assert.equal(appearanceToShikiTheme("light"), "github-light");
    assert.equal(appearanceToShikiTheme("voidglass"), "github-dark");
    assert.equal(appearanceToShikiTheme("aeon"), "github-dark");
  });
});

describe("highlightToHtml gate", () => {
  it("skips Shiki for typed-unknown / explicit-plain / oversize", async () => {
    let calls = 0;
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: () => {
        calls += 1;
        return "<pre>nope</pre>";
      },
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    assert.equal(await highlightToHtml("x", "zig", "voidglass"), null);
    assert.equal(await highlightToHtml("x", "plaintext", "voidglass"), null);
    const oversize = Array.from({ length: 401 }, (_, i) => `l${i}`).join("\n");
    assert.equal(await highlightToHtml(oversize, "ts", "voidglass"), null);
    assert.equal(calls, 0);
  });

  it("uses resolved alias lang and plaintext for unlabeled", async () => {
    const seen: Array<{ lang: string; theme: string }> = [];
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: (_code, opts) => {
        seen.push({ lang: opts.lang, theme: opts.theme });
        return `<pre data-lang="${opts.lang}"></pre>`;
      },
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    assert.match(
      (await highlightToHtml("const x = 1", "ts", "light")) ?? "",
      /data-lang="typescript"/,
    );
    assert.match(
      (await highlightToHtml("hello", "", "aeon")) ?? "",
      /data-lang="plaintext"/,
    );
    assert.deepEqual(seen, [
      { lang: "typescript", theme: "github-light" },
      { lang: "plaintext", theme: "github-dark" },
    ]);
  });

  it("cold load failure → null (tokenizer path upstream)", async () => {
    __setHighlighterLoaderForTests(async () => null);
    assert.equal(await highlightToHtml("const x = 1", "ts", "voidglass"), null);
  });
});
