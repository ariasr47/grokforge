import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { MessageList, type ChatMessage } from "./MessageList.js";

afterEach(() => cleanup());

const carousel = {
  version: 1,
  blocks: [
    {
      type: "carousel",
      title: "Best sides",
      items: [{ title: "Steamed rice", body: "Short-grain.", badge: "Essential" }],
    },
  ],
};

function fencedCarousel(): string {
  return "```grok-ui\n" + JSON.stringify(carousel) + "\n```";
}

function msgs(overrides: Partial<ChatMessage> = {}): ChatMessage[] {
  return [
    { id: "u1", role: "user", content: "sibling question" },
    {
      id: "a1",
      role: "assistant",
      content: fencedCarousel(),
      streaming: false,
      ...overrides,
    },
  ];
}

describe("MessageList historical artifact Open + compact", () => {
  it("settled elevatable historical assistant offers a .beside card with Open", () => {
    render(
      createElement(MessageList, {
        messages: msgs(),
        title: "Landlord email",
        artifactOpenMessageId: null,
        onOpenArtifact: () => {},
      }),
    );
    const card = document.querySelector(".beside") as HTMLElement | null;
    assert.ok(card);
    assert.ok(within(card!).getByText("Landlord email"));
    assert.ok(within(card!).getByRole("button", { name: /^Open$/i }));
    assert.ok(screen.getByText("sibling question"));
    assert.ok(screen.getByText("Steamed rice"));
  });

  it(".beside sub line names the real content kind — never invents version/language counts", () => {
    render(
      createElement(MessageList, {
        messages: msgs(),
        title: "Landlord email",
        artifactOpenMessageId: null,
        onOpenArtifact: () => {},
      }),
    );
    const sub = document.querySelector(".beside .bs");
    assert.ok(sub);
    assert.equal(sub!.textContent, "Rich document");
    // The mockup's own copy ("English + Japanese · 2 versions") is specific
    // to its scenario and not real data here — must not leak into the DOM.
    assert.equal(document.body.textContent?.includes("2 versions"), false);
  });

  it("falls back to a generic title when no session title is available (never blank, never invented)", () => {
    render(
      createElement(MessageList, {
        messages: msgs(),
        artifactOpenMessageId: null,
        onOpenArtifact: () => {},
      }),
    );
    const bt = document.querySelector(".beside .bt");
    assert.ok(bt);
    assert.ok(bt!.textContent && bt!.textContent.length > 0);
  });

  it("user / streaming / short replies do not offer a .beside card", () => {
    render(
      createElement(MessageList, {
        messages: [
          { id: "u1", role: "user", content: "hello" },
          { id: "a-stream", role: "assistant", content: fencedCarousel(), streaming: true },
          { id: "a-short", role: "assistant", content: "short reply", streaming: false },
        ],
        artifactOpenMessageId: null,
        onOpenArtifact: () => {},
      }),
    );
    assert.equal(document.querySelector(".beside") === null, true);
    assert.equal(screen.queryByRole("button", { name: /^Open$/i }) === null, true);
  });

  it("when artifactOpenMessageId matches, bubble body is compact; sibling remains", () => {
    render(
      createElement(MessageList, {
        messages: msgs(),
        artifactOpenMessageId: "a1",
        onOpenArtifact: () => {},
      }),
    );
    const compact = document.querySelector(".msg-body--artifact-compact") as HTMLElement | null;
    assert.ok(compact);
    const cs = getComputedStyle(compact);
    assert.ok(
      cs.display === "none" ||
        compact.getAttribute("hidden") != null ||
        cs.visibility === "hidden",
    );
    assert.ok(cs.overflow !== "auto" && cs.overflow !== "scroll");
    assert.ok(cs.overflowY !== "auto" && cs.overflowY !== "scroll");
    assert.ok(screen.getByText("sibling question"));
  });

  it("Open click reports message.id", () => {
    let opened: string | null = null;
    render(
      createElement(MessageList, {
        messages: msgs(),
        artifactOpenMessageId: null,
        onOpenArtifact: (id) => {
          opened = id;
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
    assert.equal(opened, "a1");
  });
});
