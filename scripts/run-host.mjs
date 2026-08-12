#!/usr/bin/env node
/**
 * Start host with channel isolation (prod | dev).
 * Usage: node scripts/run-host.mjs --channel=dev
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.find((a) => a.startsWith("--channel="));
const channel = (arg?.split("=")[1] || process.env.GROKFORGE_CHANNEL || "prod")
  .toLowerCase();
const isDev = ["dev", "development", "tst", "test", "qa"].includes(channel);
const env = {
  ...process.env,
  GROKFORGE_CHANNEL: isDev ? "dev" : "prod",
  GROKFORGE_PORT: process.env.GROKFORGE_PORT || (isDev ? "8788" : "8787"),
};

console.log(
  `[host] channel=${env.GROKFORGE_CHANNEL} port=${env.GROKFORGE_PORT}`,
);

const child = spawn(
  "npm",
  ["run", "start", "--workspace", "@grokforge/host"],
  { cwd: root, stdio: "inherit", shell: true, env },
);
child.on("exit", (code) => process.exit(code ?? 1));
