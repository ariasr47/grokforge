import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MarkdownBody } from "./markdown";
import { RunSurface } from "./RunSurface";
import type { RunProjectionRun } from "./runReducer";

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

  it("renders same-line fenced grok-ui as components, not a JSON paste", () => {
    const src =
      "Make most sides ahead so you can sit and cook. ```grok-ui " +
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "Hosting rule",
            body: "Plan 4–6 sides, not 12.",
          },
          {
            type: "carousel",
            title: "Best sides for home yakiniku",
            items: [
              { title: "Steamed Japanese rice", body: "Short-grain rice.", badge: "Essential" },
              { title: "Kimchi", body: "The classic fat-cutter.", badge: "Must-have" },
            ],
          },
        ],
      }) +
      " ``` ### Sauces\n- **Tare**";
    render(createElement(MarkdownBody, { text: src }));
    assert.ok(screen.getByText("Hosting rule"));
    assert.ok(screen.getByText("Plan 4–6 sides, not 12."));
    assert.ok(screen.getByText("Best sides for home yakiniku"));
    assert.ok(screen.getByText("Steamed Japanese rice"));
    assert.ok(screen.getByRole("heading", { name: /Sauces/i }));
    assert.equal(document.body.textContent?.includes('"version": 1'), false);
    assert.equal(document.body.textContent?.includes("```grok-ui"), false);
  });

  it("RunSurface Chat answer renders same-line grok-ui as components, not a JSON paste", () => {
    const dump =
      "Sides should be make-ahead. ```grok-ui " +
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "Keep it to 5–6 sides",
            body: "Rice + kimchi + lettuce wraps.",
          },
          {
            type: "carousel",
            title: "Best sides",
            items: [{ title: "Steamed rice", body: "Short-grain.", badge: "Essential" }],
          },
        ],
      }) +
      " ``` ### Sauces\n- Tare";
    const run = {
      sessionId: "s",
      runId: "r",
      connectionGeneration: 1,
      state: "terminal",
      acceptedPrompt: "yakiniku sides",
      admittedAt: "",
      updatedAt: "",
      lastEventSeq: 2,
      policy: {},
      model: {},
      terminalKind: "answered",
      finalAnswer: dump,
      answerVouched: true,
      failure: null,
      reasoning: {},
      answer: {},
      activities: {},
      decisions: {},
      seenEventSeq: new Set([1]),
      terminalEventSeq: 2,
    } as RunProjectionRun;
    render(createElement(RunSurface, { run, productMode: "chat" }));
    const answer = document.querySelector(".assistant-answer");
    assert.ok(answer);
    assert.ok(answer!.querySelector(".rich-callout"));
    assert.ok(screen.getByText("Keep it to 5–6 sides"));
    assert.ok(screen.getByText("Steamed rice"));
    assert.equal(answer!.textContent?.includes("```grok-ui"), false);
    assert.equal(answer!.textContent?.includes('"version": 1'), false);
  });

  it("streaming incomplete grok-ui stays pre, not a Building rich layout placeholder", () => {
    render(createElement(MarkdownBody, {
      text: "Intro\n\n```grok-ui\nnot json yet",
      streaming: true,
    }));
    assert.equal(screen.queryByText("Building rich layout…") === null, true);
    assert.equal(document.querySelector(".rich-pending"), null);
    const pre = document.querySelector("pre");
    assert.ok(pre);
    assert.ok(pre!.textContent?.includes("not json yet"));
    assert.ok(screen.getByText("Intro"));
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
