import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(path.join(root, "settings.css"), "utf8");

describe("light-axis code tokens", () => {
  it("overrides .md-code and tok-* under html[data-theme=light] with var(--*) tokens", () => {
    assert.match(css, /html\[data-theme="light"\]\s+\.md-code\s*\{[^}]*color:\s*var\(--text\)/s);
    assert.match(css, /html\[data-theme="light"\]\s+\.tok-kw\s*\{[^}]*var\(--/s);
    assert.match(css, /html\[data-theme="light"\]\s+\.tok-str\s*\{[^}]*var\(--/s);
    assert.match(css, /html\[data-theme="light"\]\s+\.tok-num\s*\{[^}]*var\(--/s);
    assert.match(css, /html\[data-theme="light"\]\s+\.tok-cmt\s*\{[^}]*var\(--/s);
    assert.match(css, /html\[data-theme="light"\]\s+\.tok-pun\s*\{[^}]*var\(--/s);
    assert.match(
      css,
      /html\[data-theme="light"\]\s+\.md-code-ln\s*\{[^}]*color:\s*var\(--muted\)/s,
    );
  });
});
