import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { setRuntimePort } from "../lib/api";

export interface ReliableRunHost {
  baseUrl: string;
  workspace: string;
  home: string;
  process: ChildProcess;
  ws: WebSocket;
  startupOutput: () => string;
  killPreservingData(): Promise<void>;
  close(): Promise<void>;
}

export async function startReliableRunHost(fixture = "", port = 0, existing?: { home: string; workspace: string }): Promise<ReliableRunHost> {
  const home = existing?.home ?? await mkdtemp(path.join(os.tmpdir(), "forge-rar-home-"));
  const workspace = existing?.workspace ?? await mkdtemp(path.join(os.tmpdir(), "forge-rar-workspace-"));
  const dataDir = path.join(home, "data");
  await mkdir(dataDir, { recursive: true });
  const actualPort = port || 18_000 + Math.floor(Math.random() * 1_000);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const agent = fixture === "all-events"
    ? path.join(root, "apps", "shell", "src", "test-support", "all-events-agent.mjs")
    : fixture === "live-turn-burst"
      ? path.join(root, "apps", "host", "src", "test-support", "live-turn-burst-agent.mjs")
      : fixture === "git-review-surface"
        ? path.join(root, "apps", "host", "src", "test-support", "git-review-surface-agent.mjs")
        : path.join(root, "apps", "host", "src", "test-support", "fake-acp-agent.mjs");
  // Inherit the operator environment except PATH. A real `grok` CLI on PATH
  // makes Code acquire vendor `grok agent stdio` instead of GROKFORGE_AGENT_ENTRY,
  // so fixture agents never see the prompt and run-event waits time out.
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() === "path" || key.toLowerCase() === "pathext") continue;
    env[key] = value;
  }
  env.PATH = "";
  if (process.platform === "win32") {
    env.Path = "";
    env.PATHEXT = ".EXE;.CMD";
  }
  env.XAI_API_KEY = "fixture-test-key";
  env.GROKFORGE_API_KEY = "fixture-test-key";
  env.GROKFORGE_PORT = String(actualPort);
  env.GROKFORGE_DATA_DIR = dataDir;
  env.GROKFORGE_AGENT_ENTRY = agent;
  env.GROKFORGE_FIXTURE = fixture;
  const child = spawn(process.execPath, ["--import", "tsx", path.join(root, "apps", "host", "src", "index.ts")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const MAX_LOG = 64 * 1024;
  let output = "";
  const appendLog = (chunk: unknown) => {
    output += String(chunk);
    if (output.length > MAX_LOG) output = output.slice(output.length - MAX_LOG);
  };
  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  // Browser-mounted joined flows consume the same resolved port as the
  // production launcher instead of falling back to 8787.
  setRuntimePort(actualPort);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const health = await fetch(`${baseUrl}/api/health`).catch((error) => { throw new Error(`reliable host health transport failed: ${String(error)} pid=${child.pid}\n${output}`); });
  if (!health.ok) { child.kill(); throw new Error(`reliable host did not become healthy: ${health.status} pid=${child.pid}\n${output}`); }
  const ws = new WebSocket(`ws://127.0.0.1:${actualPort}/ws`);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("WS open timeout")), 5_000); ws.once("open", () => { clearTimeout(timer); resolve(); }); ws.once("error", reject); });
  const killProcess = async () => {
    ws.close();
    if (!child.killed) {
      if (process.platform === "win32" && child.pid) {
        // The host owns an ACP grandchild; killing only the Node parent leaks
        // handles/processes and eventually makes the full shell suite fail
        // with esbuild `spawn UNKNOWN`.
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else child.kill();
    }
    await new Promise<void>((resolve) => { if (child.exitCode !== null) return resolve(); child.once("exit", () => resolve()); setTimeout(resolve, 1_000); });
  };
  return { baseUrl, workspace, home, process: child, ws, startupOutput: () => output, killPreservingData: killProcess, close: async () => {
    await killProcess();
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await rm(home, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true }); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1))); }
    }
  } };
}

export function waitForRunEvent(ws: WebSocket, predicate: (event: any) => boolean, timeout = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error("run event timeout")); }, timeout);
    const onMessage = (data: unknown) => { try { const event = JSON.parse(String(data)); if (predicate(event)) { clearTimeout(timer); ws.off("message", onMessage); resolve(event); } } catch { /* ignore non-json */ } };
    ws.on("message", onMessage);
  });
}
