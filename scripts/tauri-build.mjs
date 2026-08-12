#!/usr/bin/env node
/**
 * Build Tauri installer for a channel.
 * Usage: node scripts/tauri-build.mjs --channel=prod|dev
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellDir = path.join(root, "apps", "shell");

const arg = process.argv.find((a) => a.startsWith("--channel="));
const channelRaw = (arg?.split("=")[1] || process.env.GROKFORGE_CHANNEL || "prod")
  .toLowerCase();
const isDev = ["dev", "development", "tst", "test", "qa"].includes(channelRaw);
const channel = isDev ? "dev" : "prod";
const hostPort = process.env.GROKFORGE_PORT || (isDev ? "8788" : "8787");

const channelEnv = {
  ...process.env,
  GROKFORGE_CHANNEL: channel,
  GROKFORGE_PORT: hostPort,
  VITE_GROKFORGE_CHANNEL: channel,
  VITE_GROKFORGE_PORT: hostPort,
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

const tauriScript = isDev ? "tauri:build:dev" : "tauri:build";

console.log(
  `[tauri-build] channel=${channel} host=:${hostPort} → npm run ${tauriScript}`,
);

if (process.platform !== "win32") {
  const child = spawn("npm", ["run", tauriScript], {
    cwd: shellDir,
    stdio: "inherit",
    shell: true,
    env: channelEnv,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const vsdev = findVsDevCmd();
  if (!vsdev) {
    console.error("MSVC Build Tools not found");
    process.exit(1);
  }
  const bat = `@echo off\r
set GROKFORGE_CHANNEL=${channel}\r
set GROKFORGE_PORT=${hostPort}\r
set VITE_GROKFORGE_CHANNEL=${channel}\r
set VITE_GROKFORGE_PORT=${hostPort}\r
call "${vsdev}" -arch=x64 -host_arch=x64\r
if errorlevel 1 exit /b 1\r
cd /d "${shellDir}"\r
npm run ${tauriScript}\r
`;
  const tmp = path.join(root, ".tauri-build-run.cmd");
  fs.writeFileSync(tmp, bat, "utf8");
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
