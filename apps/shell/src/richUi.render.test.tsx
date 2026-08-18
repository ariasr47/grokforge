import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MarkdownBody } from "./markdown";

afterEach(() => cleanup());

describe("unfenced grok-ui dump renders components", () => {
  it("turns the chat dump into metrics + callout, not a JSON paste", () => {
    const src =
      "Building it the clean OAuth way is the hard part. grok-ui " +
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: "metrics",
            title: "Quick verdict",
            items: [
              { label: "Demand", value: "Real", hint: "People already pay for this" },
              { label: "Money", value: "Possible", hint: "High churn" },
            ],
          },
          {
            type: "callout",
            tone: "warn",
            title: "The blocker is not the UI",
            body: "Official APIs do not give those lists.",
          },
          {
            type: "choices",
            prompt: "Where do you want to go next?",
            options: [
              { id: "legal-scope", label: "Official API scope", recommended: true },
              { id: "pivot", label: "Safer nearby products" },
            ],
          },
        ],
      }) +
      "  ## Judgment\nThe job-to-be-done is proven.";

    render(createElement(MarkdownBody, { text: src }));
    assert.ok(screen.getByText("Quick verdict"));
    assert.ok(screen.getByText("Demand"));
    assert.ok(screen.getByText("The blocker is not the UI"));
    assert.ok(screen.getByRole("heading", { name: /Judgment/i }));
    assert.ok(screen.getByText("Official API scope"));
    assert.ok(screen.getByText("Recommended"));
    assert.equal(document.body.textContent?.includes('"version": 1'), false);
    assert.equal(document.body.textContent?.includes("grok-ui {"), false);
  });

  it("renders a constructed map embed, not a caller-supplied iframe src", () => {
    const src =
      "```grok-ui\n" +
      JSON.stringify({
        blocks: [{ type: "map", query: "Tokyo Tower", label: "Tokyo Tower" }],
      }) +
      "\n```";
    render(createElement(MarkdownBody, { text: src }));
    const frame = document.querySelector("iframe.rich-map-frame");
    assert.ok(frame);
    const srcAttr = frame!.getAttribute("src") || "";
    assert.ok(srcAttr.startsWith("https://www.google.com/maps"));
    assert.ok(srcAttr.includes("output=embed"));
    assert.ok(!srcAttr.includes("evil"));
  });
});
