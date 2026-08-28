import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ArtifactPanel } from "./ArtifactPanel.js";

afterEach(() => cleanup());

const carouselDoc = {
  version: 1,
  blocks: [
    {
      type: "choices",
      prompt: "Pick one",
      options: [{ label: "Alpha", description: "first" }],
    },
  ],
};

function fencedChoices(): string {
  return "```grok-ui\n" + JSON.stringify(carouselDoc) + "\n```";
}

describe("ArtifactPanel", () => {
  it("render-ok shows Artifact heading, same-kind body, Close", () => {
    render(
      createElement(ArtifactPanel, {
        body: fencedChoices(),
        contentKind: "rich-document",
        onClose: () => {},
      }),
    );
    assert.ok(screen.getByRole("heading", { name: /^Artifact$/i }));
    assert.ok(screen.getByRole("button", { name: /^Close$/i }));
    assert.ok(screen.getByText("Pick one"));
    assert.ok(screen.getByText("Alpha"));
  });

  it("onChoose fills via callback and does not auto-send", () => {
    const choices: string[] = [];
    render(
      createElement(ArtifactPanel, {
        body: fencedChoices(),
        contentKind: "rich-document",
        onClose: () => {},
        onChoose: (label) => choices.push(label),
      }),
    );
    fireEvent.click(screen.getByText("Alpha"));
    assert.deepEqual(choices, ["Alpha"]);
  });

  it("shared renderer throw → Couldn't open this artifact. (distinct from empty)", () => {
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
      if (text.includes("forced shared renderer") || text.includes("ThrowOnRender")) return;
      prevError.apply(console, args);
    };
    try {
    render(
      createElement(ArtifactPanel, {
        body: fencedChoices(),
        contentKind: "rich-document",
        onClose: () => {},
        // Test-only seam: force the shared boundary to throw once.
        forceRenderError: true,
      }),
    );
    assert.ok(screen.getByText("Couldn't open this artifact."));
    assert.equal(screen.queryByText("Pick one"), null);
    assert.ok(screen.getByRole("button", { name: /^Close$/i }));
    } finally {
      console.error = prevError;
    }
  });

  it("absent props paint nothing (honest empty)", () => {
    const { container } = render(
      createElement(ArtifactPanel, {
        body: null,
        contentKind: null,
        onClose: () => {},
      }),
    );
    assert.equal(container.querySelector(".artifact-panel"), null);
  });
});
