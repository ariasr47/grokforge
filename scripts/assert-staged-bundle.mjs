#!/usr/bin/env node
/**
 * AC-S4: the staged PROD host bundle must contain no dev-channel origin literal. Covers the ALLOW
 * side, which the deny-side criteria structurally cannot reach. Also fails when the per-channel
 * allowlist file was never generated (missing bundle).
 * Usage: node scripts/assert-staged-bundle.mjs --channel=prod|dev
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.find((a) => a.startsWith("--channel="));
const channel = (arg?.split("=")[1] || "prod").toLowerCase() === "dev" ? "dev" : "prod";
const staged = path.join(root, "apps", "shell", "src-tauri", "resources", "host", "index.js");

if (!fs.existsSync(staged)) {
  console.error(`[assert-staged-bundle] FAIL: staged host bundle missing at ${staged}`);
  process.exit(1);
}
const src = fs.readFileSync(staged, "utf8");
if (!src.includes("http://tauri.localhost")) {
  console.error("[assert-staged-bundle] FAIL: packaged origin absent from the staged bundle — the");
  console.error("  per-channel allowlist was not generated, or the wrong file was bundled.");
  process.exit(1);
}
if (channel === "prod") {
  // "localhost:" — WITH the colon — not bare "localhost": http://tauri.localhost legitimately
  // contains the substring "localhost", and a bare match would fail every correct prod build
  // (SPEC's own shorthand names "5173, 5174, localhost" as the grep target; this is the reading
  // that survives the packaged origin, per desktop-self-host B6 / AC-S4).
  const banned = ["5173", "5174", "localhost:"];
  const hits = banned.filter((b) => src.includes(b));
  if (hits.length) {
    console.error(`[assert-staged-bundle] FAIL: prod bundle contains dev literals: ${hits.join(", ")}`);
    process.exit(1);
  }
}
console.log(`[assert-staged-bundle] OK (channel=${channel})`);
