import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { ContextRing } from "./ContextRing";

afterEach(() => cleanup());

describe("ContextRing — house/guest rule: renders only real engine data", () => {
  it("renders nothing when there is no usage at all", () => {
    const { container } = render(<ContextRing usage={null} />);
    assert.equal(container.querySelector(".ring"), null);
  });

  it("renders nothing when the model catalog has no context window for the active model", () => {
    const { container } = render(<ContextRing usage={{ promptTokens: 4200, contextWindow: null }} />);
    assert.equal(container.querySelector(".ring"), null);
  });

  it("renders the percentage and the exact arc offset from real usage", () => {
    const { container } = render(<ContextRing usage={{ promptTokens: 205_000, contextWindow: 500_000 }} />);
    const ring = container.querySelector(".ring");
    assert.ok(ring, "expected a .ring element");
    assert.equal(ring!.textContent, "41%");
    assert.equal(ring!.getAttribute("title"), "41% of context used · compacts at 80%");
    const progress = container.querySelector("circle.ring-progress");
    assert.ok(progress, "expected the progress circle");
    assert.equal(progress!.getAttribute("stroke-dasharray"), "47.1");
    const expectedOffset = 47.1 * (1 - 205_000 / 500_000);
    assert.equal(Number(progress!.getAttribute("stroke-dashoffset")), expectedOffset);
    assert.equal(progress!.getAttribute("stroke"), "var(--accent)");
    assert.equal(ring!.classList.contains("ring-amber"), false);
  });

  it("stays cyan just under the compaction threshold", () => {
    const { container } = render(<ContextRing usage={{ promptTokens: 395_000, contextWindow: 500_000 }} />);
    const ring = container.querySelector(".ring");
    assert.equal(ring!.textContent, "79%");
    assert.equal(ring!.classList.contains("ring-amber"), false);
    assert.equal(container.querySelector("circle.ring-progress")!.getAttribute("stroke"), "var(--accent)");
  });

  it("warns as soon as the label reads 80%, so the colour never denies the text", () => {
    // 79.6% raw: rounds to "80%" in the label, so the ring must warn too.
    const { container } = render(<ContextRing usage={{ promptTokens: 398_000, contextWindow: 500_000 }} />);
    const ring = container.querySelector(".ring");
    assert.equal(ring!.textContent, "80%");
    assert.equal(ring!.classList.contains("ring-amber"), true);
    assert.equal(container.querySelector("circle.ring-progress")!.getAttribute("stroke"), "var(--attention)");
  });

  it("turns amber at exactly the 80% compaction threshold — the one place amber is not \"needs you\"", () => {
    const { container } = render(<ContextRing usage={{ promptTokens: 400_000, contextWindow: 500_000 }} />);
    const ring = container.querySelector(".ring");
    assert.equal(ring!.textContent, "80%");
    assert.equal(ring!.classList.contains("ring-amber"), true);
    assert.equal(container.querySelector("circle.ring-progress")!.getAttribute("stroke"), "var(--attention)");
    assert.equal(ring!.getAttribute("title"), "80% of context used · compacts at 80%");
  });

  it("stays amber and keeps the honest (uncapped) percentage past 100% while the arc geometry clamps to a full circle", () => {
    const { container } = render(<ContextRing usage={{ promptTokens: 550_000, contextWindow: 500_000 }} />);
    const ring = container.querySelector(".ring");
    assert.equal(ring!.textContent, "110%");
    assert.equal(ring!.classList.contains("ring-amber"), true);
    assert.equal(Number(container.querySelector("circle.ring-progress")!.getAttribute("stroke-dashoffset")), 0);
  });
});
