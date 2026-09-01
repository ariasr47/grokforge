#!/usr/bin/env node
/**
 * From-source `npm run dev`: DEV channel host + Vite.
 * Sets env here so Windows concurrently does not need `ENV=value cmd`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  GROKFORGE_CHANNEL: "dev",
  GROKFORGE_PORT: process.env.GROKFORGE_PORT || "8788",
  VITE_GROKFORGE_CHANNEL: "dev",
  VITE_GROKFORGE_PORT: process.env.VITE_GROKFORGE_PORT || process.env.GROKFORGE_PORT || "8788",
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(
  npmCmd,
  [
    "exec",
    "--",
    "concurrently",
    "-k",
    "-n",
    "host,ui",
    "-c",
    "cyan,magenta",
    "node scripts/run-host.mjs --channel=dev",
    "npm run dev --workspace @grokforge/shell",
  ],
  { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" },
);
child.on("exit", (code) => process.exit(code ?? 1));
