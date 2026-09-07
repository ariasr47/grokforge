import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
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

interface HostHealth { ok: boolean; port: number; pid: number; dataDir: string }

/** How many times a requested port may be re-attempted before we give up. */
const START_ATTEMPTS = 5;

/**
 * Wait until `port` can actually be bound again.
 *
 * Killing the host does not immediately hand its port back: the forced exit
 * leaves accepted sockets draining, and an OS-assigned port lives in the
 * dynamic range, where an unrelated process can also claim it. The
 * host-replacement tests kill a host and rebind that exact port, so "the host
 * is gone" has to mean "its port is free" or the replacement races the kill.
 */
async function waitForPortFree(port: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

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

/**
 * Every host child still believed alive.
 *
 * `afterEach` reaps hosts through the returned object's `close()`, which covers
 * the normal path completely. It cannot cover a test process that dies before
 * its hooks run — an abort, an uncaught throw, a harness timeout — and every
 * host alive at that moment is orphaned, keeps its port, and outlives the run.
 * A synchronous best-effort sweep on `exit` catches those. A forced tree-kill
 * from outside takes the children with it, so this only has to handle the
 * in-process endings.
 */
const liveChildren = new Set<ChildProcess>();
let sweepInstalled = false;

function trackChild(child: ChildProcess): void {
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  if (sweepInstalled) return;
  sweepInstalled = true;
  process.on("exit", () => {
    for (const orphan of liveChildren) {
      if (!orphan.pid || orphan.exitCode !== null) continue;
      try {
        // `exit` handlers may only do synchronous work.
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(orphan.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } else orphan.kill("SIGKILL");
      } catch { /* best effort — the run is already ending */ }
    }
  });
}

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
  // Every throw below happens before the returned object — the one carrying
  // `close()` — exists, so `hosts.push(h)` never runs and `afterEach` has
  // nothing to tear down. Whatever this call created, this call must reap.
  const abandonStartup = async () => {
    await hardKill(child);
    if (existing) return; // the caller owns these dirs and is still using them
    for (const dir of [home, workspace]) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  for (let attempt = 0; ; attempt++) {
    env.GROKFORGE_PORT = String(port);
    child = spawn(process.execPath, ["--import", "tsx", hostEntry], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    trackChild(child);
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
      const retryable = error instanceof StartupFailure && error.portTaken && attempt < START_ATTEMPTS - 1;
      if (!retryable) { await abandonStartup(); throw error; }
      // Another attempt reuses the same dirs, so only the child goes.
      await hardKill(child);
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
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("WS open timeout")), 5_000); ws.once("open", () => { clearTimeout(timer); resolve(); }); ws.once("error", reject); });
  } catch (error) {
    // The host is healthy and fully alive here, so this is the costliest place
    // to give up without reaping: the caller never receives the object holding
    // `close()`, and the host would keep its port for the rest of the run.
    try { ws.close(); } catch { /* never opened */ }
    await abandonStartup();
    throw new Error(`reliable host socket never opened on ${baseUrl}: ${String(error)} pid=${child.pid}\n${output}`);
  }
  const killProcess = async () => {
    ws.close();
    // `hardKill` takes the whole tree: the host owns an ACP grandchild, and
    // killing only the Node parent leaks handles/processes and eventually makes
    // the full shell suite fail with esbuild `spawn UNKNOWN`.
    await hardKill(child);
    // Callers that rebind this exact port next (host-replacement tests) must
    // not race the kernel still letting go of it.
    await waitForPortFree(actualPort);
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
