#!/usr/bin/env node
/**
 * Build Tauri installer for a channel.
 * Usage: node scripts/tauri-build.mjs --channel=prod|dev
 */
import { execFileSync, spawn } from "node:child_process";
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

const updaterKey = path.join(root, ".tauri", "updater.key");
function updaterSigningEnv() {
  if (!fs.existsSync(updaterKey)) return {};
  // Tauri 2 reads TAURI_SIGNING_PRIVATE_KEY (contents), not PATH.
  const key = fs.readFileSync(updaterKey, "utf8").trim();
  if (!key) return {};
  return {
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "",
  };
}
const channelEnv = {
  ...process.env,
  GROKFORGE_CHANNEL: channel,
  GROKFORGE_PORT: hostPort,
  VITE_GROKFORGE_CHANNEL: channel,
  VITE_GROKFORGE_PORT: hostPort,
  // D3: compile-time channel constant baked into the Rust launcher via option_env! — never a
  // runtime std::env::var read, so GROKFORGE_CHANNEL on the shipped binary can never move the
  // data root, port or allowlist (AC-S8).
  GROKFORGE_BUILD_CHANNEL: channel,
  ...updaterSigningEnv(),
};

function step(label, args) {
  console.log(`[tauri-build] ${label}`);
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit", env: channelEnv });
}

// Ordered packaging pipeline (SPEC §2.1, §2.2, §2.7 rule 4/5). Aborts on the first non-zero exit —
// execFileSync throws, which propagates past this module's top level and exits non-zero.
step("generate per-channel allowlist", [path.join(root, "scripts", "gen-allowed-origins.mjs"), `--channel=${channel}`]);
// AC25/AC26: the packaged host's /api/health version must equal the app version this same build
// stamps into the installer. bundle-host.mjs invokes esbuild directly (not `npm run build`, whose
// prebuild hook would otherwise cover this), so the generation step is explicit here.
step("generate build version", [path.join(root, "scripts", "gen-build-version.mjs")]);
step("fetch + verify node runtime", [path.join(root, "scripts", "fetch-node-runtime.mjs")]);
step("bundle host + agent", [path.join(root, "scripts", "bundle-host.mjs")]);
step("assert staged bundle (AC-S4)", [path.join(root, "scripts", "assert-staged-bundle.mjs"), `--channel=${channel}`]);

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

const tauriArgs = isDev
  ? ["tauri", "build", "--config", "src-tauri/tauri.conf.dev.json"]
  : ["tauri", "build"];
const updaterArtifacts = path.join(shellDir, "src-tauri", ".updater-artifacts.json");
if (fs.existsSync(updaterKey)) {
  fs.writeFileSync(
    updaterArtifacts,
    JSON.stringify({ bundle: { createUpdaterArtifacts: true } }),
  );
  tauriArgs.push("--config", "src-tauri/.updater-artifacts.json");
  console.log("[tauri-build] updater artifacts ON (signing key present)");
} else {
  console.log("[tauri-build] updater artifacts OFF (no .tauri/updater.key)");
}

console.log(
  `[tauri-build] channel=${channel} host=:${hostPort} → npx ${tauriArgs.join(" ")}`,
);

if (process.platform !== "win32") {
  const child = spawn("npx", tauriArgs, {
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
  const tauriLine = `npx ${tauriArgs.join(" ")}`;
  const bat = `@echo off\r
set GROKFORGE_CHANNEL=${channel}\r
set GROKFORGE_PORT=${hostPort}\r
set VITE_GROKFORGE_CHANNEL=${channel}\r
set VITE_GROKFORGE_PORT=${hostPort}\r
set GROKFORGE_BUILD_CHANNEL=${channel}\r
call "${vsdev}" -arch=x64 -host_arch=x64\r
if errorlevel 1 exit /b 1\r
cd /d "${shellDir}"\r
${tauriLine}\r
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
