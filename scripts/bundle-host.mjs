#!/usr/bin/env node
/**
 * Bundle the host and the ACP agent to single-file ESM for the packaged build (SPEC §2.2).
 * One output per process. `ws`'s optional native addons are external and omitted; tsx disappears
 * from the runtime entirely. No npm install ever runs on the user's machine.
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "apps", "shell", "src-tauri", "resources");

const EXTERNAL = ["bufferutil", "utf-8-validate"]; // ws optional native addons (SPEC §2.2)

async function one(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: EXTERNAL,
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
    logLevel: "info",
  });
}

fs.rmSync(path.join(out, "host"), { recursive: true, force: true });
fs.rmSync(path.join(out, "agents"), { recursive: true, force: true });

await one(
  path.join(root, "apps", "host", "src", "index.ts"),
  path.join(out, "host", "index.js"),
);
await one(
  path.join(root, "packages", "grok-acp", "src", "index.ts"),
  path.join(out, "agents", "grok-acp", "index.js"),
);
console.log("[bundle-host] wrote", out);
