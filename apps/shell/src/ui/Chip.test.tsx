import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { Chip } from "./Chip";

afterEach(() => cleanup());

describe("Chip", () => {
  it("renders a span when no onPress is given", () => {
    render(createElement(Chip, {}, "Idle"));
    const el = screen.getByText("Idle");
    assert.equal(el.tagName, "SPAN");
    assert.ok(el.classList.contains("chip"));
  });

  it("renders a button when onPress is given", () => {
    let pressed = false;
    render(createElement(Chip, { onPress: () => (pressed = true) }, "Dismiss"));
    const el = screen.getByRole("button", { name: "Dismiss" });
    assert.ok(el.classList.contains("chip"));
    fireEvent.click(el);
    assert.equal(pressed, true);
  });

  it("defaults to tone default", () => {
    render(createElement(Chip, {}, "Plain"));
    const el = screen.getByText("Plain");
    assert.ok(el.classList.contains("chip-default"));
  });

  it("applies the requested tone class", () => {
    render(createElement(Chip, { tone: "attention" }, "Flagged"));
    const el = screen.getByText("Flagged");
    assert.ok(el.classList.contains("chip-attention"));
  });

  it("keeps quiet and on tone classes distinct", () => {
    render(createElement(Chip, { tone: "quiet" }, "Quiet"));
    assert.ok(screen.getByText("Quiet").classList.contains("chip-quiet"));
    render(createElement(Chip, { tone: "on" }, "Live"));
    assert.ok(screen.getByText("Live").classList.contains("chip-on"));
  });

  it("renders icon and trailing content alongside children", () => {
    render(
      createElement(
        Chip,
        {
          icon: createElement("span", { "data-testid": "lead" }, "*"),
          trailing: createElement("span", { "data-testid": "tail" }, "x"),
        },
        "Label",
      ),
    );
    assert.ok(screen.getByTestId("lead"));
    assert.ok(screen.getByTestId("tail"));
    assert.ok(screen.getByText("Label"));
  });

  it("forwards title and extra className", () => {
    render(
      createElement(Chip, { title: "hover text", className: "extra" }, "Tip"),
    );
    const el = screen.getByText("Tip");
    assert.equal(el.getAttribute("title"), "hover text");
    assert.ok(el.classList.contains("extra"));
    assert.ok(el.classList.contains("chip"));
  });
});
