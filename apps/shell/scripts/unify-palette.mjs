#!/usr/bin/env node
// One-off codemod: unify the old Aeon mint/lilac literals onto the Voidglass
// --accent / --accent2 tokens via color-mix(), so every stylesheet (including
// the legacy html[data-theme="aeon"] block in tokens.css, which redefines
// --accent/--accent2 to the matching hex itself) tracks whichever theme is
// active instead of hardcoding one palette. Kept for the record; safe to
// re-run (it is idempotent — once the rgba() literals are gone, it is a
// no-op).
//
// Usage (from apps/shell): node scripts/unify-palette.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(here, "..", "src", "styles");

const FILES = ["tokens.css", "chrome.css", "run.css", "dock.css", "settings.css", "motion.css"];

// rgba(125, 255, 232, A) -> mint  -> var(--accent)
// rgba(196, 181, 253, A) -> lilac -> var(--accent2)
const REPLACEMENTS = [
  { re: /rgba\(\s*125\s*,\s*255\s*,\s*232\s*,\s*([0-9]*\.?[0-9]+)\s*\)/g, token: "--accent" },
  { re: /rgba\(\s*196\s*,\s*181\s*,\s*253\s*,\s*([0-9]*\.?[0-9]+)\s*\)/g, token: "--accent2" },
];

let totalReplacements = 0;

for (const file of FILES) {
  const filePath = path.join(stylesDir, file);
  const original = fs.readFileSync(filePath, "utf8");
  let updated = original;
  let fileReplacements = 0;

  for (const { re, token } of REPLACEMENTS) {
    updated = updated.replace(re, (_match, alpha) => {
      fileReplacements += 1;
      const percent = Math.round(parseFloat(alpha) * 100);
      return `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;
    });
  }

  if (updated !== original) {
    fs.writeFileSync(filePath, updated, "utf8");
  }
  console.log(`${file}: ${fileReplacements} replacement(s)`);
  totalReplacements += fileReplacements;
}

console.log(`Total: ${totalReplacements} replacement(s) across ${FILES.length} file(s).`);
