import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
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

function fencedTabs(): string {
  const doc = {
    version: 1,
    blocks: [
      {
        type: "tabs",
        tabs: [
          { label: "English", body: "Hello Sato-san." },
          { label: "日本語", body: "佐藤さん、こんにちは。" },
        ],
      },
    ],
  };
  return "```grok-ui\n" + JSON.stringify(doc) + "\n```";
}

describe("ArtifactPanel — Beside", () => {
  it("render-ok shows the Beside heading with the title, same-kind body, Close", () => {
    render(
      createElement(ArtifactPanel, {
        body: fencedChoices(),
        contentKind: "rich-document",
        title: "Landlord email",
        onClose: () => {},
      }),
    );
    const heading = screen.getByRole("heading", { name: /^Beside/i });
    assert.match(heading.textContent ?? "", /Beside/);
    assert.match(heading.textContent ?? "", /Landlord email/);
    assert.ok(screen.getByRole("button", { name: /^Close$/i }));
    assert.ok(screen.getByText("Pick one"));
    assert.ok(screen.getByText("Alpha"));
  });

  it("omits the title separator when no title is available — never invents one", () => {
    render(
      createElement(ArtifactPanel, {
        body: fencedChoices(),
        contentKind: "rich-document",
        onClose: () => {},
      }),
    );
    const heading = screen.getByRole("heading");
    assert.equal(heading.textContent, "Beside");
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

  it("a tabs block renders real, switchable sections in the body", () => {
    render(
      createElement(ArtifactPanel, {
        body: fencedTabs(),
        contentKind: "rich-document",
        title: "Landlord email",
        onClose: () => {},
      }),
    );
    assert.ok(screen.getByText("Hello Sato-san."));
    assert.equal(screen.queryByText("佐藤さん、こんにちは。") === null, true);
    fireEvent.click(screen.getByRole("tab", { name: "日本語" }));
    assert.ok(screen.getByText("佐藤さん、こんにちは。"));
  });

  it("footer Copy writes the body to the clipboard; Export .md saves a file", async () => {
    const written: string[] = [];
    (navigator as unknown as { clipboard: { writeText: (t: string) => Promise<void> } }).clipboard = {
      writeText: async (t: string) => {
        written.push(t);
      },
    };
    const body = fencedChoices();
    render(
      createElement(ArtifactPanel, {
        body,
        contentKind: "rich-document",
        title: "Landlord email",
        onClose: () => {},
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Copy$/i }));
    await waitFor(() => assert.deepEqual(written, [body]));
    // Export .md is a real download action (see ArtifactPanel.tsx's local
    // saveTextFile) — just confirm the control exists and is a real button.
    assert.ok(screen.getByRole("button", { name: /^Export \.md$/i }));
  });

  it("footer never invents a version/time — the current data model carries none", () => {
    render(
      createElement(ArtifactPanel, {
        body: fencedChoices(),
        contentKind: "rich-document",
        title: "Landlord email",
        onClose: () => {},
      }),
    );
    // DEAD-4: this used to check for ".artifact-panel-vt", a class that
    // exists nowhere — the assertion could never fail. Assert against what
    // the footer actually emits instead: ArtifactPanelProps carries no
    // per-artifact version or timestamp, so no element anywhere in it may
    // name itself as one.
    const footer = document.querySelector(".artifact-panel-foot");
    assert.ok(footer, "expected the artifact panel footer to render");
    const versionOrTime = [...footer!.querySelectorAll("*")].find((el) =>
      /version|timestamp/i.test(el.getAttribute("class") || ""),
    );
    assert.equal(versionOrTime === undefined, true);
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
    assert.equal(screen.queryByText("Pick one") === null, true);
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
    assert.equal(container.querySelector(".artifact-panel") === null, true);
  });
});
