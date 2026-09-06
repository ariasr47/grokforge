import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SkillArmedChip } from "./SkillArmedChip";
import { SKILLS_ARMED, SKILLS_ARMED_TITLE } from "../projections/skillsCatalogComposer";

afterEach(() => cleanup());

test("armed chip uses Skill · /name and exact send tooltip", () => {
  const { container } = render(
    <SkillArmedChip name="/forge-skill-fixture" onClear={() => undefined} />,
  );
  const chip = screen.getByRole("status");
  assert.equal(chip.textContent?.includes(SKILLS_ARMED("/forge-skill-fixture")), true);
  assert.equal(chip.getAttribute("title"), SKILLS_ARMED_TITLE("/forge-skill-fixture"));
  assert.equal(container.textContent?.includes("Started ·"), false);
  assert.equal(/before it thinks/i.test(container.textContent ?? ""), false);
  assert.equal(/Running/i.test(container.textContent ?? ""), false);
});

test("clear button disarms", () => {
  let cleared = false;
  render(
    <SkillArmedChip
      name="/forge-skill-fixture"
      onClear={() => {
        cleared = true;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear /forge-skill-fixture" }));
  assert.equal(cleared, true);
});
