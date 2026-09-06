import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prod = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { identifier: string; mainBinaryName?: string };
const dev = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.dev.json", import.meta.url), "utf8"),
) as { identifier: string; mainBinaryName?: string };
const cargo = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const cargoBinaryName = /^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];

test("Dev installer uses a distinct executable identity from Prod", () => {
  assert.notEqual(dev.identifier, prod.identifier, "bundle identifiers must differ");
  assert.ok(cargoBinaryName, "Cargo package name must define the Prod binary fallback");
  const prodBinaryName = prod.mainBinaryName ?? cargoBinaryName;
  assert.equal(typeof dev.mainBinaryName, "string", "Dev must override mainBinaryName");
  assert.notEqual(
    dev.mainBinaryName,
    prodBinaryName,
    "NSIS process shutdown is executable-name based and must not terminate Prod",
  );
  assert.match(dev.mainBinaryName!, /dev/i);
});
