import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("from-source start/dev boot DEV channel, not prod origins", () => {
  assert.match(pkg.scripts.start, /run-host\.mjs --channel=dev/);
  assert.match(pkg.scripts["dev:host"], /run-host\.mjs --channel=dev/);
  assert.equal(pkg.scripts.dev, "node scripts/dev-web.mjs");
  assert.doesNotMatch(
    pkg.scripts.start,
    /npm run start --workspace @grokforge\/host/,
  );
  assert.match(pkg.scripts["host:prod"], /--channel=prod/);
});
