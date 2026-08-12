#!/usr/bin/env node
/**
 * One-command desktop loop (Windows-first):
 * 1. Ensure host on :8787
 * 2. Ensure Vite UI on :5173
 * 3. Open Edge/Chrome in app mode (native window, no browser chrome)
 *
 * Full Tauri: npm run desktop:tauri (requires VS C++ Build Tools / MSVC).
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const arg = process.argv.find((a) => a.startsWith("--channel="));
const channelRaw = (arg?.split("=")[1] || process.env.GROKFORGE_CHANNEL || "prod")
  .toLowerCase();
const isDev = ["dev", "development", "tst", "test", "qa"].includes(channelRaw);
const channel = isDev ? "dev" : "prod";
const HOST_PORT = Number(
  process.env.GROKFORGE_PORT || (isDev ? 8788 : 8787),
);
const UI_PORT = Number(process.env.VITE_PORT || (isDev ? 5174 : 5173));
const children = [];

process.env.GROKFORGE_CHANNEL = channel;
process.env.GROKFORGE_PORT = String(HOST_PORT);
process.env.VITE_GROKFORGE_CHANNEL = channel;
process.env.VITE_GROKFORGE_PORT = String(HOST_PORT);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = createConnection({ host: HOST, port }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(400, () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function healthOk() {
  try {
    const res = await fetch(`http://${HOST}:${HOST_PORT}/api/health`);
    const j = await res.json();
    return Boolean(j.ok);
  } catch {
    return false;
  }
}

function spawnNode(args, name) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });
  children.push({ name, child });
  child.on("exit", (code) => {
    console.log(`[desktop] ${name} exited (${code})`);
  });
  return child;
}

function spawnNpm(scriptArgs, name) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, scriptArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: true,
    windowsHide: false,
  });
  children.push({ name, child });
  child.on("exit", (code) => {
    console.log(`[desktop] ${name} exited (${code})`);
  });
  return child;
}

async function waitFor(fn, label, attempts = 80, delay = 250) {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return true;
    await sleep(delay);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

function findBrowser() {
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openAppWindow(url) {
  const browser = findBrowser();
  if (browser) {
    const child = spawn(
      browser,
      [`--app=${url}`, "--new-window", `--user-data-dir=${path.join(root, ".desktop-profile")}`],
      { stdio: "ignore", detached: true, windowsHide: false },
    );
    child.unref();
    console.log(`[desktop] Opened app window via ${path.basename(browser)}`);
    return;
  }
  // fallback
  spawn("cmd", ["/c", "start", "", url], { shell: true, detached: true }).unref();
  console.log("[desktop] Opened default browser (install Edge/Chrome for app mode)");
}

function shutdown() {
  for (const { name, child } of children) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGTERM");
      }
      console.log(`[desktop] stopped ${name}`);
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

async function main() {
  console.log(
    `[desktop] Forge [${channel.toUpperCase()}] host=:${HOST_PORT} ui=:${UI_PORT}`,
  );
  console.log("[desktop] (Tauri: npm run desktop:dev | desktop:prod)");

  if (!(await healthOk())) {
    console.log("[desktop] Starting host…");
    spawnNpm(
      [
        "run",
        "start",
        "--workspace",
        "@grokforge/host",
      ],
      "host",
    );
    await waitFor(healthOk, "host health");
  } else {
    console.log(`[desktop] Host already up on :${HOST_PORT}`);
  }

  if (!(await portOpen(UI_PORT))) {
    console.log("[desktop] Starting UI…");
    spawnNpm(["run", "dev", "--workspace", "@grokforge/shell"], "ui");
    await waitFor(() => portOpen(UI_PORT), `UI :${UI_PORT}`);
  } else {
    console.log(`[desktop] UI already up on :${UI_PORT}`);
  }

  // Brief settle for Vite
  await sleep(400);
  openAppWindow(`http://localhost:${UI_PORT}/`);

  console.log("");
  console.log("  App window should be open.");
  console.log("  Use Open folder… for native Windows picker.");
  console.log("  Ctrl+C here stops host/UI started by this launcher.");
  console.log("");

  // Keep process alive
  await new Promise(() => {});
}

main().catch((e) => {
  console.error("[desktop] failed:", e.message);
  shutdown();
  process.exit(1);
});
