import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MarkdownBody } from "./markdown.js";
import {
  MERMAID_EMPTY_COPY,
  MERMAID_FAIL_COPY,
  __setMermaidRendererForTests,
  isMermaidLang,
} from "./mermaidFence.js";
import { parseMarkdownBlocks } from "./markdownParse.js";

afterEach(() => {
  cleanup();
  __setMermaidRendererForTests(null);
});

describe("isMermaidLang", () => {
  it("only mermaid token, not a second highlighter", () => {
    assert.equal(isMermaidLang("mermaid"), true);
    assert.equal(isMermaidLang("Mermaid title=flow"), true);
    assert.equal(isMermaidLang("ts"), false);
    assert.equal(isMermaidLang("grok-ui"), false);
  });
});

describe("parse mermaid fence", () => {
  it("stays a code block, not grok-ui rich", () => {
    const blocks = parseMarkdownBlocks("```mermaid\nflowchart LR\nA-->B\n```");
    assert.deepEqual(blocks, [
      { type: "code", lang: "mermaid", code: "flowchart LR\nA-->B" },
    ]);
  });
});

describe("MarkdownBody mermaid C2", () => {
  it("drawn svg from renderer, not a shiki fence", async () => {
    __setMermaidRendererForTests(async () => '<svg data-test="mmd"><title>ok</title></svg>');
    render(
      createElement(MarkdownBody, {
        text: "```mermaid\nflowchart LR\nA-->B\n```",
      }),
    );
    await waitFor(() => {
      assert.ok(document.querySelector('[data-mermaid="drawn"]'));
    });
    assert.ok(screen.getByRole("img", { name: "Mermaid diagram" }));
    assert.equal(document.querySelector(".shiki"), null);
  });

  it("failed render stays honest plain with source", async () => {
    __setMermaidRendererForTests(async () => {
      throw new Error("parse");
    });
    render(
      createElement(MarkdownBody, {
        text: "```mermaid\nnot a diagram\n```",
      }),
    );
    await waitFor(() => {
      assert.ok(document.querySelector('[data-mermaid="failed"]'));
    });
    assert.ok(screen.getAllByText(MERMAID_FAIL_COPY, { exact: false }).length >= 1);
    assert.ok(screen.getByText("not a diagram"));
    assert.equal(document.querySelector('[role="img"]'), null);
  });

  it("empty mermaid invents no chart", () => {
    render(createElement(MarkdownBody, { text: "```mermaid\n\n```" }));
    assert.ok(document.querySelector('[data-mermaid="empty"]'));
    assert.ok(screen.getByText(MERMAID_EMPTY_COPY));
    assert.equal(document.querySelector('[role="img"]'), null);
  });
});
