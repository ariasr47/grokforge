// The dogfood scripts under scripts/dogfood-*.mjs drive the real app in
// Playwright and assert on class selectors and on rendered copy. Nothing wires
// them into `npm test` or CI, so when a redesign renames or deletes a surface
// their probes go quietly false instead of failing: 2819b97 deleted the "Your
// turn" delimiter and three probes kept "passing" against nothing for weeks.
//
// This guard is the cheap half of that problem — every selector and every copy
// string a probe asserts on must still exist in product source. It cannot prove
// the probe is *correct*, only that its subject still exists. Copy that the
// agent supplies over ACP, and fixtures the script itself types, can never be
// found here; those live in ALLOWED_ABSENT with a reason.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Strings no static scan can resolve. Keep each one justified. */
const ALLOWED_ABSENT = new Map([
  ["FORGE-CODE-OK", "the script types this itself, then reads it back"],
  ["Decline", "an ACP permission option label the agent supplies at runtime"],
]);

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out = out.concat(walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|vitest)\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/** Comments have to go: this codebase documents retired copy where it used to
 *  live ("the retired Your turn delimiter"), which is exactly the string a dead
 *  probe still matches on. A trailing comment after code on the same line
 *  survives — biome keeps statements on their own lines, so that is rare. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Product source only — test files would let a probe verify itself. */
function productSource(): string {
  const roots: string[] = [];
  for (const group of ["apps", "packages"]) {
    const base = join(root, group);
    for (const pkg of readdirSync(base)) {
      const src = join(base, pkg, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // package without a src/ — nothing to contribute
      }
    }
  }
  return roots
    .flatMap(walk)
    .map((f) => stripComments(readFileSync(f, "utf8")))
    .join("\n");
}

function dogfoodScripts(): { file: string; text: string }[] {
  const dir = join(root, "scripts");
  return readdirSync(dir)
    .filter((f) => /^dogfood-.*\.mjs$/.test(f))
    .map((f) => ({ file: `scripts/${f}`, text: readFileSync(join(dir, f), "utf8") }));
}

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** Class tokens from the selector sinks — `body`, attribute and role selectors
 *  carry no class and drop out on their own. */
function selectorsIn(text: string): string[] {
  const args = matchAll(
    text,
    /(?:locator|querySelectorAll|querySelector|waitForSelector)\("([^"]+)"/g,
  );
  return args.flatMap((sel) => matchAll(sel, /\.([a-z][a-z0-9-]*)/g));
}

/** Copy the probes assert on: accessible names, text queries, body substrings,
 *  the label arrays the click loops walk, and plain-prose regex alternations.
 *  A regex with any metacharacter beyond `|` is skipped rather than guessed at. */
function copyIn(text: string): string[] {
  const out = [
    ...matchAll(text, /getByRole\("[a-z]+",\s*\{\s*name:\s*"([^"]+)"/g),
    ...matchAll(text, /getBy(?:Label|Text|Placeholder)\("([^"]+)"/g),
    ...matchAll(text, /\.includes\("([^"]+)"\)/g),
  ];
  for (const list of matchAll(text, /for \(const \w+ of \[([^\]]+)\]\)/g)) {
    out.push(...matchAll(list, /"([^"]+)"/g));
  }
  for (const pattern of matchAll(text, /\/([^/\n]+)\/\.test\(/g)) {
    if (!/^[A-Za-z0-9 '’…—|]+$/.test(pattern)) continue;
    out.push(...pattern.split("|"));
  }
  return out;
}

test("every class a dogfood probe selects still exists in product source", () => {
  const source = productSource();
  const dead: string[] = [];
  for (const { file, text } of dogfoodScripts()) {
    for (const cls of new Set(selectorsIn(text))) {
      if (source.includes(cls)) continue;
      dead.push(`${file}: .${cls}`);
    }
  }
  assert.deepEqual(
    dead,
    [],
    `dogfood probes select classes nothing renders any more — repoint or delete them:\n${dead.join("\n")}`,
  );
});

test("every copy string a dogfood probe asserts on still exists in product source", () => {
  const source = productSource();
  const dead: string[] = [];
  for (const { file, text } of dogfoodScripts()) {
    for (const phrase of new Set(copyIn(text))) {
      if (ALLOWED_ABSENT.has(phrase)) continue;
      if (source.includes(phrase)) continue;
      dead.push(`${file}: "${phrase}"`);
    }
  }
  assert.deepEqual(
    dead,
    [],
    `dogfood probes assert on copy nothing renders any more — repoint them, or add an ALLOWED_ABSENT entry with a reason:\n${dead.join("\n")}`,
  );
});
