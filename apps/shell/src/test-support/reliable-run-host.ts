import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { setRuntimePort } from "../api";

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

interface HostHealth { ok: boolean; port: number; pid: number; dataDir: string }

/** How many times a requested port may be re-attempted before we give up. */
const START_ATTEMPTS = 3;

/** The host's first stdout line: `GROKFORGE_HOST_LISTENING port=<n> pid=<n>`. */
const LISTENING_LINE = /GROKFORGE_HOST_LISTENING port=(\d+) pid=(\d+)/;

/**
 * A host that never came up. `portTaken` marks the one cause worth retrying —
 * somebody else already owns the port we asked for.
 */
class StartupFailure extends Error {
  constructor(message: string, readonly portTaken: boolean) {
    super(message);
    this.name = "StartupFailure";
  }
}

const looksPortTaken = (output: string) => /EADDRINUSE|already in use/i.test(output);

/** Kill the host and its ACP grandchildren; never throws. */
async function hardKill(child: ChildProcess): Promise<void> {
  try {
    if (!child.killed) {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else child.kill();
    }
  } catch { /* already gone */ }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(resolve, 1_000);
  });
}

/**
 * Resolve the port the host actually bound, or reject saying why it never
 * bound. Racing the child's own `exit` is the point: a bind failure used to be
 * invisible here, so a dead child looked exactly like a slow one and the caller
 * waited out a health timeout with the real reason (`Port N already in use`)
 * sitting unread in the captured output.
 */
function waitForListeningPort(child: ChildProcess, readOutput: () => string, timeoutMs = 30_000): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const settle = () => { clearTimeout(timer); clearInterval(poll); child.off("exit", onExit); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle();
      const output = readOutput();
      reject(new StartupFailure(
        `reliable host exited before it listened (code=${code} signal=${signal} pid=${child.pid})\n${output}`,
        looksPortTaken(output),
      ));
    };
    const poll = setInterval(() => {
      const match = LISTENING_LINE.exec(readOutput());
      if (!match) return;
      settle();
      resolve(Number(match[1]));
    }, 25);
    const timer = setTimeout(() => {
      settle();
      const output = readOutput();
      reject(new StartupFailure(
        `reliable host never reported a listening port within ${timeoutMs}ms (pid=${child.pid})\n${output}`,
        looksPortTaken(output),
      ));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

/** Poll /api/health, but give up the moment the child dies underneath us. */
async function waitForHealth(child: ChildProcess, actualPort: number, readOutput: () => string, timeoutMs = 15_000): Promise<HostHealth> {
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt made";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const output = readOutput();
      throw new StartupFailure(
        `reliable host exited during the health probe (code=${child.exitCode} signal=${child.signalCode} pid=${child.pid})\n${output}`,
        looksPortTaken(output),
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return await response.json() as HostHealth;
      last = `status ${response.status}`;
    } catch (error) { last = String(error); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new StartupFailure(
    `reliable host did not become healthy on ${baseUrl} within ${timeoutMs}ms: ${last} (pid=${child.pid})\n${readOutput()}`,
    false,
  );
}

export async function startReliableRunHost(fixture = "", port = 0, existing?: { home: string; workspace: string }): Promise<ReliableRunHost> {
  const home = existing?.home ?? await mkdtemp(path.join(os.tmpdir(), "forge-rar-home-"));
  const workspace = existing?.workspace ?? await mkdtemp(path.join(os.tmpdir(), "forge-rar-workspace-"));
  const dataDir = path.join(home, "data");
  await mkdir(dataDir, { recursive: true });
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
  // `port` 0 — the default — asks the OS for an ephemeral port and reads back
  // the one it actually assigned. Two hosts can then never draw the same
  // number, which a random pick from a fixed 1000-wide range emphatically can:
  // a losing child dies on bind while the winner keeps answering /api/health,
  // so the loser's test silently drove a FOREIGN host (wrong data dir, wrong
  // fixture) and failed much later as `run event timeout`. Callers that need a
  // specific port (host-replacement tests rebinding a dead host's port) still
  // pass one and get exactly it.
  env.GROKFORGE_DATA_DIR = dataDir;
  env.GROKFORGE_AGENT_ENTRY = agent;
  env.GROKFORGE_FIXTURE = fixture;
  const hostEntry = path.join(root, "apps", "host", "src", "index.ts");
  let child!: ChildProcess;
  let output = "";
  let actualPort = 0;
  let health!: HostHealth;
  const startupOutput = () => output;
  for (let attempt = 0; ; attempt++) {
    env.GROKFORGE_PORT = String(port);
    child = spawn(process.execPath, ["--import", "tsx", hostEntry], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const MAX_LOG = 64 * 1024;
    output = "";
    const appendLog = (chunk: unknown) => {
      output += String(chunk);
      if (output.length > MAX_LOG) output = output.slice(output.length - MAX_LOG);
    };
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);
    try {
      actualPort = await waitForListeningPort(child, startupOutput);
      health = await waitForHealth(child, actualPort, startupOutput);
      // The port answered, but by whom? An explicitly requested port can still
      // be held by a stranger. Only our own child counts as this host.
      if (health.pid !== child.pid) {
        throw new StartupFailure(
          `reliable host: port ${actualPort} is answered by pid=${health.pid}, not our child pid=${child.pid} `
            + `(dataDir=${health.dataDir}) — a foreign host owns this port`,
          true,
        );
      }
      break;
    } catch (error) {
      await hardKill(child);
      const retryable = error instanceof StartupFailure && error.portTaken && attempt < START_ATTEMPTS - 1;
      if (!retryable) throw error;
      // Only reachable for an explicitly requested port (an ephemeral one is
      // free by construction): the previous owner may still be letting go.
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  // Browser-mounted joined flows consume the same resolved port as the
  // production launcher instead of falling back to 8787.
  setRuntimePort(actualPort);
  const ws = new WebSocket(`ws://127.0.0.1:${actualPort}/ws`);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("WS open timeout")), 5_000); ws.once("open", () => { clearTimeout(timer); resolve(); }); ws.once("error", reject); });
  const killProcess = async () => {
    ws.close();
    // `hardKill` takes the whole tree: the host owns an ACP grandchild, and
    // killing only the Node parent leaks handles/processes and eventually makes
    // the full shell suite fail with esbuild `spawn UNKNOWN`.
    await hardKill(child);
  };
  return { baseUrl, workspace, home, process: child, ws, startupOutput, killPreservingData: killProcess, close: async () => {
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
