import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// F7: amber (--accent3 / rgba(240,180,90,…)) is reserved for "needs you" —
// the only sanctioned exceptions are the context ring at >=80% and the
// unsigned-installer warning. Extracts one CSS rule's own declaration block
// (not the whole file) so this only fails on the specific rules F7 named,
// not on the legitimate amber uses elsewhere (e.g. GateHeader's "needs" dot).

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(here, "styles");
const read = (f: string) => fs.readFileSync(path.join(stylesDir, f), "utf8");

/** First `.selector { ... }` block's own body text, or null if the selector
 *  is not found. Good enough for the flat, non-nested rules under test. */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1]! : null;
}

describe("F7 — amber stays reserved for needs-you", () => {
  it(".channel-banner-tst (non-production build notice) is not amber", () => {
    const css = read("chrome.css");
    const banner = ruleBody(css, ".channel-banner-tst");
    assert.ok(banner, "expected a .channel-banner-tst rule in chrome.css");
    assert.equal(/--accent3/.test(banner!), false, "still references --accent3");
    assert.equal(/rgba\(\s*240\s*,\s*180\s*,\s*90/.test(banner!), false, "still has the raw amber literal");

    const strong = ruleBody(css, ".channel-banner-tst strong");
    assert.ok(strong, "expected a .channel-banner-tst strong rule in chrome.css");
    assert.equal(/--accent3/.test(strong!), false, "strong badge still references --accent3");
  });

  it(".sub-ico.plan (plan icon) is violet, not amber", () => {
    const css = read("run.css");
    const rule = ruleBody(css, ".sub-ico.plan");
    assert.ok(rule, "expected a .sub-ico.plan rule in run.css");
    assert.equal(/--accent3/.test(rule!), false, "plan icon still uses --accent3 (amber)");
    assert.ok(/--accent2/.test(rule!), "plan icon should use --accent2 (violet)");
  });
});
