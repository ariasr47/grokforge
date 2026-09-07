import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = here;
const read = (f: string) => fs.readFileSync(path.join(stylesDir, f), "utf8");
const ALL = ["tokens.css", "chrome.css", "run.css", "dock.css", "settings.css", "motion.css"];

describe("Voidglass tokens", () => {
  it("declares the surface, radius and height tokens", () => {
    const t = read("tokens.css");
    for (const name of ["--surface-1", "--surface-2", "--surface-float", "--stroke", "--stroke-live", "--r-control", "--r-card", "--r-float", "--h-sm", "--h-md", "--h-lg", "--h-icon", "--measure", "--attention"]) {
      assert.ok(t.includes(`${name}:`), `${name} missing`);
    }
  });
  it("has no Aeon hardcodes left", () => {
    for (const f of ALL) {
      const css = read(f);
      assert.equal(/rgba\(\s*125\s*,\s*255\s*,\s*232/.test(css), false, `${f} still has mint`);
      assert.equal(/rgba\(\s*196\s*,\s*181\s*,\s*253/.test(css), false, `${f} still has lilac`);
    }
  });
});
