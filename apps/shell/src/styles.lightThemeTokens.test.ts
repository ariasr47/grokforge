import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// F2: --surface-1, --surface-2, --surface-float, --stroke and --stroke-live
// (tokens.css:32-36) were defined only on :root. html[data-theme="light"]
// (settings.css) overrode --bg/--card/--border/--text/--accent but none of
// the new ones, so --stroke (used ~45x across review.css/dock.css/chrome.css/
// run.css) vanished on a light background, and --surface-float (near-black)
// backed .menu/.skills-palette/.overview-popover/.at-menu with no light
// override, so those panels rendered near-black with dark --text on top —
// unreadable. Assert each of the five tokens is redefined inside the light
// block so this cannot regress silently.

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(here, "styles");
const read = (f: string) => fs.readFileSync(path.join(stylesDir, f), "utf8");

/** The body of the first `html[data-theme="light"] { ... }` rule. */
function lightThemeBlock(css: string): string {
  const m = /html\[data-theme="light"\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'expected an html[data-theme="light"] rule in settings.css');
  return m![1]!;
}

describe("F2 — the light theme redefines the new surface/stroke tokens", () => {
  const block = lightThemeBlock(read("settings.css"));

  for (const token of ["--surface-1", "--surface-2", "--surface-float", "--stroke", "--stroke-live"]) {
    it(`redefines ${token}`, () => {
      const declared = new RegExp(`${token}\\s*:`).test(block);
      assert.equal(declared, true, `expected ${token} to be redefined inside html[data-theme="light"]`);
    });
  }

  it("does not redefine --stroke as a bare prefix of --stroke-live only", () => {
    // Guard against a regex false-positive: --stroke must appear as its own
    // declaration, not only as part of --stroke-live's name.
    const strokeOwnDeclaration = /(^|[^-])--stroke\s*:/.test(block);
    assert.equal(strokeOwnDeclaration, true, "expected a standalone --stroke: declaration");
  });

  it("gives --surface-float a light, near-opaque backdrop (not the dark near-black default)", () => {
    const m = /--surface-float\s*:\s*([^;]+);/.exec(block);
    assert.ok(m, "expected --surface-float: <value>; inside the light block");
    const value = m![1]!.trim();
    // The dark default is rgba(14, 16, 22, 0.92) — near-black. The light
    // override must not reuse that literal.
    assert.equal(value.includes("14, 16, 22"), false, "still using the dark near-black literal");
  });
});
