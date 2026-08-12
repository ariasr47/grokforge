#!/usr/bin/env node
/**
 * Launch Prod + Dev side-by-side (hosts + Tauri).
 * Usage: node scripts/launch-both.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, args, envExtra = {}) {
  console.log(`[both] start ${label}: ${args.join(" ")}`);
  const child = spawn(args[0], args.slice(1), {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...envExtra },
    detached: false,
  });
  child.on("exit", (code) => {
    console.log(`[both] ${label} exited (${code})`);
  });
  return child;
}

console.log("[both] Forge Prod (:8787 / UI :5173) + Forge Dev (:8788 / UI :5174)");
console.log("[both] Dev window has a DEV banner; Prod has no banner.");

// Hosts first (background)
const hostProd = run("host-prod", ["node", "scripts/run-host.mjs", "--channel=prod"], {
  GROKFORGE_CHANNEL: "prod",
  GROKFORGE_PORT: "8787",
});
const hostDev = run("host-dev", ["node", "scripts/run-host.mjs", "--channel=dev"], {
  GROKFORGE_CHANNEL: "dev",
  GROKFORGE_PORT: "8788",
});

await new Promise((r) => setTimeout(r, 2500));

// Tauri windows
const tauriProd = run("tauri-prod", ["node", "scripts/tauri-dev.mjs", "--channel=prod"]);
await new Promise((r) => setTimeout(r, 8000));
const tauriDev = run("tauri-dev", ["node", "scripts/tauri-dev.mjs", "--channel=dev"]);

function shutdown() {
  for (const c of [tauriDev, tauriProd, hostDev, hostProd]) {
    try {
      if (process.platform === "win32" && c.pid) {
        spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        c.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
