import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SkillsPalette } from "./SkillsPalette";
import {
  SKILLS_CHECKING,
  SKILLS_EMPTY,
  SKILLS_FAILED,
  SKILLS_NO_MATCHES,
  SKILLS_RECONNECT,
  SKILLS_TITLE,
  type SkillsPaletteProjection,
} from "./skillsCatalogComposer";

afterEach(() => cleanup());

const ready: SkillsPaletteProjection = {
  state: "ready",
  commands: [
    { name: "/forge-skill-fixture", description: "Forge skill fixture" },
    { name: "/other", description: null },
  ],
};

describe("SkillsPalette", () => {
  it("absent or closed renders nothing", () => {
    const { container, rerender } = render(
      <SkillsPalette
        open={false}
        projection={ready}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.equal(container.textContent, "");
    rerender(
      <SkillsPalette
        open
        projection={{ state: "absent" }}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.equal(container.textContent, "");
    assert.equal(screen.queryByRole("listbox", { name: SKILLS_TITLE }), null);
  });

  it("checking shows Checking skills… and no armable options", () => {
    render(
      <SkillsPalette
        open
        projection={{ state: "checking", reconnectHint: false }}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.ok(screen.getByText(SKILLS_TITLE));
    assert.ok(screen.getByText(SKILLS_CHECKING));
    assert.equal(screen.queryByRole("option"), null);
    assert.equal(screen.queryByText(SKILLS_EMPTY), null);
    assert.equal(screen.queryByText(SKILLS_RECONNECT), null);
  });

  it("optional reconnect hint is non-selectable status only", () => {
    render(
      <SkillsPalette
        open
        projection={{ state: "checking", reconnectHint: true }}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.ok(screen.getByText(SKILLS_RECONNECT));
    assert.equal(screen.queryByRole("option"), null);
  });

  it("ready empty copy is No skills from Grok Code", () => {
    render(
      <SkillsPalette
        open
        projection={{ state: "empty" }}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.ok(screen.getByText(SKILLS_EMPTY));
    assert.equal(screen.queryByText(SKILLS_FAILED), null);
    assert.equal(screen.queryByRole("option"), null);
  });

  it("obtain_failed copy is Couldn't load skills.", () => {
    render(
      <SkillsPalette
        open
        projection={{ state: "failed" }}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.ok(screen.getByText(SKILLS_FAILED));
    assert.equal(screen.queryByText(SKILLS_EMPTY), null);
    assert.equal(screen.queryByRole("option"), null);
  });

  it("ready lists vouched /name rows and descriptions only when vouched", () => {
    let selected: string | null = null;
    render(
      <SkillsPalette
        open
        projection={ready}
        filter=""
        activeIndex={0}
        onSelect={(name) => {
          selected = name;
        }}
        onDismiss={() => undefined}
      />,
    );
    assert.ok(screen.getByRole("listbox", { name: SKILLS_TITLE }));
    const fixture = screen.getByRole("option", { name: "/forge-skill-fixture" });
    assert.ok(fixture.textContent?.includes("Forge skill fixture"));
    const other = screen.getByRole("option", { name: "/other" });
    assert.equal(other.textContent?.includes("null"), false);
    fireEvent.click(fixture);
    assert.equal(selected, "/forge-skill-fixture");
  });

  it("filter miss shows No matches — not invented rows", () => {
    render(
      <SkillsPalette
        open
        projection={ready}
        filter="zzzz"
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    assert.ok(screen.getByText(SKILLS_NO_MATCHES));
    assert.equal(screen.queryByRole("option"), null);
  });

  it("Escape dismisses and never paints Started ·", () => {
    let dismissed = false;
    const { container } = render(
      <SkillsPalette
        open
        projection={ready}
        filter=""
        activeIndex={0}
        onSelect={() => undefined}
        onDismiss={() => {
          dismissed = true;
        }}
      />,
    );
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: "Escape" });
    assert.equal(dismissed, true);
    assert.equal(container.textContent?.includes("Started ·"), false);
    assert.equal(/before it thinks/i.test(container.textContent ?? ""), false);
  });
});
