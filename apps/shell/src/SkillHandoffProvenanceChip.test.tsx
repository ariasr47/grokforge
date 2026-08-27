import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillHandoffProvenanceChip } from "./SkillHandoffProvenanceChip";
import { SKILLS_SENT } from "./skillsCatalogComposer";

afterEach(() => cleanup());

test("consumed paints quieter Skill · /name sent — never Started ·", () => {
  const { container } = render(
    <SkillHandoffProvenanceChip
      provenance={{ kind: "consumed", name: "/forge-skill-fixture" }}
    />,
  );
  assert.equal(
    screen.getByRole("status").textContent,
    SKILLS_SENT("/forge-skill-fixture"),
  );
  assert.equal(container.textContent?.includes("Started ·"), false);
  assert.equal(/before it thinks/i.test(container.textContent ?? ""), false);
});

test("none / null / missing name render nothing", () => {
  const { container, rerender } = render(
    <SkillHandoffProvenanceChip provenance={{ kind: "none", name: null }} />,
  );
  assert.equal(container.textContent, "");
  rerender(<SkillHandoffProvenanceChip provenance={null} />);
  assert.equal(container.textContent, "");
  rerender(
    <SkillHandoffProvenanceChip provenance={{ kind: "consumed", name: null }} />,
  );
  assert.equal(container.textContent, "");
});
