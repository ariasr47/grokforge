import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(here, "styles");
const read = (f: string) => fs.readFileSync(path.join(stylesDir, f), "utf8");
const ALL_STYLESHEETS = fs.readdirSync(stylesDir).filter((f) => f.endsWith(".css"));
const motionCss = read("motion.css");

/** Every `@keyframes NAME {` defined at the top level of a stylesheet. */
function keyframeNames(css: string): string[] {
  const names: string[] = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) names.push(m[1]!);
  return names;
}

/** The first balanced `header { ... }` block (header included) plus the index
 *  just past its closing brace, so a caller can keep scanning after it. */
function extractBlock(css: string, header: RegExp): { text: string; end: number } | null {
  const m = header.exec(css);
  if (!m) return null;
  const braceStart = css.indexOf("{", m.index);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return { text: css.slice(m.index, i + 1), end: i + 1 };
    }
  }
  return null;
}

/** True if `name` (which may itself contain hyphens) appears as a whole token —
 *  not merely as a run inside a longer hyphenated word (e.g. "spin" must not
 *  match inside "tool-spinner"). */
function referencesToken(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`);
  return re.test(text);
}

describe("Motion system (motion.css is the single home for @keyframes)", () => {
  const names = keyframeNames(motionCss);
  const reducedMotion = extractBlock(motionCss, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);

  it("motion.css actually defines keyframes to check", () => {
    assert.ok(names.length > 0, "expected at least one @keyframes rule in motion.css");
    for (const expected of [
      "pulse",
      "breathe",
      "rise",
      "check-draw",
      "shimmer",
      "caret-blink",
      "dock-slide",
      "mint-sweep",
    ]) {
      assert.ok(names.includes(expected), `motion.css is missing @keyframes ${expected}`);
    }
  });

  it("has exactly one @media (prefers-reduced-motion: reduce) block, and it references every keyframe", () => {
    assert.ok(reducedMotion, "no @media (prefers-reduced-motion: reduce) block found in motion.css");
    const occurrences = motionCss.match(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g) ?? [];
    assert.equal(occurrences.length, 1, "expected exactly one prefers-reduced-motion block in motion.css");
    for (const name of names) {
      assert.ok(
        referencesToken(reducedMotion!.text, name),
        `@media (prefers-reduced-motion: reduce) does not reference keyframe "${name}"`,
      );
    }
  });

  it("has one html[data-motion=\"calm\"] block (after the reduced-motion block), and it references every keyframe", () => {
    assert.ok(reducedMotion, "reduced-motion block must be found first to search past it");
    // Everything after the reduced-motion block is the calm section — sliced
    // from there (not from a fresh indexOf) so a comment documenting a
    // selector group is still included, not chopped off at the selector
    // text itself. A prose mention of the same attribute selector earlier
    // in the file (e.g. a header comment) can never stand in for this,
    // because it necessarily falls before reducedMotion.end.
    const block = motionCss.slice(reducedMotion!.end);
    assert.ok(block.includes('html[data-motion="calm"]'), 'no html[data-motion="calm"] rule found after the reduced-motion block');
    for (const name of names) {
      assert.ok(referencesToken(block, name), `html[data-motion="calm"] block does not reference keyframe "${name}"`);
    }
  });

  it("no aeon- keyframe name remains in any stylesheet", () => {
    const retired = ["aeon-breathe", "aeon-pulse", "aeon-rise", "aeon-fade-in", "side-mode-in", "tool-pulse"];
    for (const file of ALL_STYLESHEETS) {
      const css = read(file);
      for (const name of retired) {
        assert.equal(referencesToken(css, name), false, `${file} still references retired keyframe "${name}"`);
      }
    }
  });

  it("no stylesheet other than motion.css defines @keyframes", () => {
    for (const file of ALL_STYLESHEETS) {
      if (file === "motion.css") continue;
      const css = read(file);
      assert.equal(/@keyframes\s+[\w-]+\s*\{/.test(css), false, `${file} defines @keyframes — motion.css should be the only home`);
    }
  });
});
