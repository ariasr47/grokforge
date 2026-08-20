#!/usr/bin/env node
/**
 * Run Tauri dev with channel isolation (prod | dev).
 * Usage: node scripts/tauri-dev.mjs --channel=dev
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellDir = path.join(root, "apps", "shell");

const arg = process.argv.find((a) => a.startsWith("--channel="));
const channelRaw = (arg?.split("=")[1] || process.env.GROKFORGE_CHANNEL || "dev")
  .toLowerCase();
const isDev = ["dev", "development", "tst", "test", "qa"].includes(channelRaw);
const channel = isDev ? "dev" : "prod";
const hostPort = process.env.GROKFORGE_PORT || (isDev ? "8788" : "8787");
const uiPort = process.env.VITE_PORT || (isDev ? "5174" : "5173");

// Separate cargo target so Prod + Dev can run side-by-side (Windows file lock).
// Keep OUTSIDE src-tauri so Tauri's watcher does not rebuild-loop on target artifacts.
const cargoTarget = isDev
  ? path.join(root, ".cargo-target-dev")
  : path.join(shellDir, "src-tauri", "target");

const channelEnv = {
  ...process.env,
  GROKFORGE_CHANNEL: channel,
  GROKFORGE_PORT: hostPort,
  VITE_GROKFORGE_CHANNEL: channel,
  VITE_GROKFORGE_PORT: hostPort,
  VITE_PORT: uiPort,
  CARGO_TARGET_DIR: cargoTarget,
  // Compile-time channel for the Rust launcher (option_env!), matching tauri-build.mjs.
  // Without this, `desktop:dev` bakes BUILD_CHANNEL=prod and the host allowlist
  // refuses http://localhost:5174 — "Forge couldn't reach its engine."
  GROKFORGE_BUILD_CHANNEL: channel,
  GROKFORGE_ROOT: root,
  GROKFORGE_NODE: process.execPath,
};

function findVsDevCmd() {
  const bases = [
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env["ProgramFiles"] || "C:\\Program Files",
  ];
  for (const base of bases) {
    for (const edition of [
      "BuildTools",
      "Community",
      "Professional",
      "Enterprise",
    ]) {
      const p = path.join(
        base,
        "Microsoft Visual Studio",
        "2022",
        edition,
        "Common7",
        "Tools",
        "VsDevCmd.bat",
      );
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const tauriScript = isDev ? "tauri:dev:channel" : "tauri:dev";

function generateChannelArtifacts() {
  // `tauri dev` spawns the host via node+tsx, which skips npm prestart. Bake
  // the channel allowlist (dev includes :5174) and build version first.
  execFileSync(
    process.execPath,
    [path.join(root, "scripts", "gen-allowed-origins.mjs"), `--channel=${channel}`],
    { cwd: root, stdio: "inherit", env: channelEnv },
  );
  execFileSync(process.execPath, [path.join(root, "scripts", "gen-build-version.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: channelEnv,
  });
}

async function main() {
  console.log(
    `[tauri-dev] channel=${channel} host=:${hostPort} ui=:${uiPort} product=${isDev ? "Forge Dev" : "Forge"}`,
  );
  generateChannelArtifacts();

  if (process.platform !== "win32") {
    const child = spawn("npm", ["run", tauriScript], {
      cwd: shellDir,
      stdio: "inherit",
      shell: true,
      env: channelEnv,
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  const vsdev = findVsDevCmd();
  if (!vsdev) {
    console.error(
      "MSVC Build Tools not found. Install Visual Studio Build Tools with C++ workload.",
    );
    console.error("Fallback: npm run desktop:web:dev");
    process.exit(1);
  }

  // Pass channel env into the nested npm process
  const bat = `@echo off\r
set GROKFORGE_CHANNEL=${channel}\r
set GROKFORGE_PORT=${hostPort}\r
set VITE_GROKFORGE_CHANNEL=${channel}\r
set VITE_GROKFORGE_PORT=${hostPort}\r
set VITE_PORT=${uiPort}\r
set CARGO_TARGET_DIR=${cargoTarget}\r
set GROKFORGE_BUILD_CHANNEL=${channel}\r
set GROKFORGE_ROOT=${root}\r
set GROKFORGE_NODE=${process.execPath}\r
call "${vsdev}" -arch=x64 -host_arch=x64\r
if errorlevel 1 exit /b 1\r
cd /d "${shellDir}"\r
npm run ${tauriScript}\r
`;
  const tmp = path.join(root, ".tauri-dev-run.cmd");
  fs.writeFileSync(tmp, bat, "utf8");

  console.log("[tauri-dev] Using MSVC environment via VsDevCmd");
  const child = spawn("cmd.exe", ["/d", "/c", tmp], {
    cwd: shellDir,
    stdio: "inherit",
    env: channelEnv,
  });
  child.on("exit", (code) => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    process.exit(code ?? 1);
  });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
