import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { CodeBlock, MarkdownBody } from "./markdown.js";
import { classifyFence } from "./codeHighlight.js";
import {
  __resetHighlighterForTests,
  __setHighlighterLoaderForTests,
} from "./codeHighlightAsync.js";
import { applyPrefsToDom, patchPrefs } from "./prefs.js";

afterEach(() => {
  cleanup();
  __setHighlighterLoaderForTests(null);
  __resetHighlighterForTests();
  try {
    localStorage.removeItem("grokforge.prefs.v1");
  } catch {
    /* jsdom */
  }
  document.documentElement.removeAttribute("data-theme");
});

describe("CodeBlock orchestration", () => {
  it("typed-unknown body has no tok-* spans and keeps typed label", async () => {
    render(createElement(CodeBlock, { code: "fn main() {}", lang: "zig" }));
    assert.equal(screen.getByText("zig").textContent, "zig");
    assert.equal(document.querySelectorAll("[class^=tok-]").length, 0);
    assert.equal(document.querySelector(".md-code-hl[dangerouslysetinnerhtml]") , null);
  });
});

describe("AC7 unknown plain via CodeBlock gate", () => {
  it("body is not tokenizer-painted and not Shiki-mapped onto a loaded grammar", async () => {
    const code = "const x = 1; function nope() { return true; }";
    // Same gate CodeBlock uses:
    assert.equal(classifyFence(code, "zig").class, "typed-unknown");
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: () => "<pre class='shiki'>FORGED</pre>",
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    render(createElement(CodeBlock, { code, lang: "zig" }));
    assert.equal(screen.getByText("zig").textContent, "zig");
    assert.equal(document.querySelectorAll("[class^=tok-]").length, 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(document.querySelector(".md-code-hl .shiki"), null);
    assert.ok(screen.getByText(/const x = 1/));
  });
});

describe("AC9 highlighter failure keeps tokenizer text", () => {
  it("gate-passed fence survives on tokenizer when rich fails", async () => {
    __setHighlighterLoaderForTests(async () => null);
    const code = "const alive = true;";
    render(createElement(CodeBlock, { code, lang: "typescript" }));
    await waitFor(() => {
      assert.ok(document.querySelector(".tok-kw"));
    });
    assert.ok(screen.getByText("const"));
    assert.ok(screen.getByText(/alive/));
  });
});

describe("AC10 empty fence", () => {
  it("empty body invents no sample and still shows chrome", () => {
    __setHighlighterLoaderForTests(async () => null);
    render(createElement(CodeBlock, { code: "", lang: "typescript" }));
    assert.equal(screen.getByText("typescript").textContent, "typescript");
    assert.match(screen.getByText(/lines/).textContent ?? "", /1 lines/);
    assert.ok(screen.getByRole("button", { name: "Copy" }));
    assert.equal(document.body.textContent?.includes("sample"), false);
  });
});

describe("warm settle + oversize drop", () => {
  it("settled codeToHtml throw/null clears rich to tokenizer", async () => {
    let n = 0;
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: () => {
        n += 1;
        if (n === 1) return "<pre class='shiki'>DARK</pre>";
        throw new Error("flip failed");
      },
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    const { rerender } = render(
      createElement(CodeBlock, { code: "const x = 1", lang: "ts" }),
    );
    await waitFor(() => assert.ok(document.querySelector(".shiki")));
    // Simulate appearance-driven remount of effect by forcing new highlight call:
    __resetHighlighterForTests();
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: () => {
        throw new Error("flip failed");
      },
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    rerender(createElement(CodeBlock, { code: "const x = 1", lang: "ts" }));
    // Trigger by changing code slightly then back is flaky; change lang alias twin:
    rerender(createElement(CodeBlock, { code: "const x = 1", lang: "typescript" }));
    await waitFor(() => {
      assert.equal(document.querySelector(".shiki"), null);
      assert.ok(document.querySelector(".tok-kw"));
    });
  });

  it("crossing 400 lines drops rich immediately (AC12)", async () => {
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: () => "<pre class='shiki'>RICH</pre>",
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    const almost = Array.from({ length: 400 }, (_, i) => `l${i}`).join("\n");
    const { rerender } = render(
      createElement(CodeBlock, { code: almost, lang: "ts" }),
    );
    await waitFor(() => assert.ok(document.querySelector(".shiki")));
    const over = almost + "\nextra";
    rerender(createElement(CodeBlock, { code: over, lang: "ts" }));
    assert.equal(document.querySelector(".shiki"), null);
    assert.equal(document.querySelectorAll("[class^=tok-]").length, 0);
    assert.match(screen.getByText(/lines/).textContent ?? "", /401 lines/);
  });
});

describe("CodeBlock partition states", () => {
  it("explicit-plain keeps typed label and skips tokenizer", () => {
    render(createElement(CodeBlock, { code: "const x = 1", lang: "plaintext" }));
    assert.equal(screen.getByText("plaintext").textContent, "plaintext");
    assert.equal(document.querySelectorAll("[class^=tok-]").length, 0);
    assert.ok(screen.getByRole("button", { name: "Copy" }));
  });

  it("unlabeled multi-line uses tokenizer until rich and does not invent CODE", async () => {
    __setHighlighterLoaderForTests(
      () =>
        new Promise(() => {
          /* pending */
        }),
    );
    render(createElement(CodeBlock, { code: "hello world\nsecond", lang: "" }));
    assert.equal(document.querySelector(".md-code-bar"), null);
    assert.ok(document.querySelector(".md-code-wrap.is-plain"));
    assert.ok(document.querySelector(".tok-plain"));
    assert.equal(document.querySelector(".shiki"), null);
  });

  it("cold first paint is tokenizer, not blank, while highlighter pending", async () => {
    let release: ((h: {
      codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
      getLoadedLanguages: () => string[];
    }) => void) | undefined;
    __setHighlighterLoaderForTests(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(createElement(CodeBlock, { code: "const alive = true;", lang: "typescript" }));
    assert.ok(document.querySelector(".tok-kw"));
    assert.ok(screen.getByText("const"));
    assert.equal(document.querySelector(".shiki"), null);
    release?.({
      codeToHtml: () => "<pre class='shiki'>RICH</pre>",
      getLoadedLanguages: () => ["typescript", "plaintext"],
    });
    await waitFor(() => assert.ok(document.querySelector(".shiki")));
  });

  it("gate-passed streaming chunks hold last rich HTML (no blank)", async () => {
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: (code) => `<pre class='shiki'>RICH:${code}</pre>`,
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    const { rerender } = render(
      createElement(CodeBlock, { code: "const a = 1", lang: "ts" }),
    );
    await waitFor(() => assert.ok(document.body.textContent?.includes("RICH:const a = 1")));
    rerender(
      createElement(CodeBlock, { code: "const a = 1\nconst b = 2", lang: "ts" }),
    );
    assert.ok(document.querySelector(".shiki"));
    await waitFor(() =>
      assert.ok(document.body.textContent?.includes("RICH:const a = 1\nconst b = 2")),
    );
  });

  it("warm appearance flip holds prior rich HTML then swaps theme", async () => {
    const seen: string[] = [];
    let pending: ((html: string) => void) | undefined;
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: (_code, opts) => {
        seen.push(opts.theme);
        if (seen.length === 1) {
          return `<pre class='shiki' data-theme="${opts.theme}">DARK</pre>`;
        }
        return new Promise<string>((resolve) => {
          pending = resolve;
        });
      },
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    render(createElement(CodeBlock, { code: "const x = 1", lang: "ts" }));
    await waitFor(() => assert.ok(document.querySelector(".shiki")));
    patchPrefs({ theme: "light" });
    applyPrefsToDom();
    await waitFor(() => assert.equal(seen.length, 2));
    assert.ok(document.querySelector(".shiki"));
    assert.equal(document.querySelectorAll("[class^=tok-]").length, 0);
    pending?.(`<pre class='shiki' data-theme="github-light">LIGHT</pre>`);
    await waitFor(() => {
      assert.equal(document.querySelector(".shiki")?.getAttribute("data-theme"), "github-light");
    });
    assert.equal(document.body.textContent?.includes("LIGHT"), true);
  });
});

describe("MarkdownBody shared Chat/Code fence path", () => {
  it("loaded fence colors, unknown stays plain, empty invents nothing", async () => {
    __setHighlighterLoaderForTests(async () => ({
      codeToHtml: () => "<pre class='shiki'>RICH</pre>",
      getLoadedLanguages: () => ["typescript", "plaintext"],
    }));
    const src = [
      "```ts",
      "const ready = true;",
      "```",
      "",
      "```zig",
      "const x = 1; function nope() { return true; }",
      "```",
      "",
      "```typescript",
      "",
      "```",
    ].join("\n");
    render(createElement(MarkdownBody, { text: src }));
    assert.equal(screen.getByText("ts").textContent, "ts");
    assert.equal(screen.getByText("zig").textContent, "zig");
    await waitFor(() => assert.ok(document.querySelector(".shiki")));
    const unknownWrap = screen.getByText("zig").closest(".md-code-wrap");
    assert.ok(unknownWrap);
    assert.equal(unknownWrap.querySelectorAll("[class^=tok-]").length, 0);
    assert.equal(unknownWrap.querySelector(".shiki"), null);
    assert.ok(screen.getByText(/const x = 1/));
    assert.equal(document.body.textContent?.includes("sample"), false);
    assert.ok(screen.getAllByRole("button", { name: "Copy" }).length >= 3);
  });
});
