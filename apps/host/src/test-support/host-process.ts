/**
 * Test-only helper: boots the real host (`src/index.ts`) as a child process so host-level tests
 * exercise the actual request handler in `index.ts` — origin allowlist, content-type gate, route
 * dispatch — rather than re-testing the pure predicates in isolation (which is what left AC13-AC16
 * uncovered against the deployed handler; see QA_REPORT.md "Amendments bounced to Backend").
 *
 * Not imported by any shipped code path — `src/**\/*.test.ts` only.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hostEntry = path.resolve(here, "../index.ts");

export interface StartedHost {
  port: number;
  baseUrl: string;
  proc: ChildProcess;
  homeDir: string;
  stop: () => Promise<void>;
}

export async function startHost(opts: {
  port: number;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<StartedHost> {
  const port = opts.port;
  // Fully isolated fake home per boot — never touches the operator's real ~/.grokforge or
  // ~/.grokforge-dev (mirrors the isolation QA used for AC2's virgin-install run).
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokforge-host-test-"));

  const proc = spawn(
    process.execPath,
    ["--import", "tsx", hostEntry],
    {
      cwd: path.resolve(here, "../.."),
      env: {
        ...process.env,
        GROKFORGE_PORT: String(port),
        GROKFORGE_CHANNEL: "test",
        USERPROFILE: homeDir,
        HOME: homeDir,
        ...opts.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stderr = "";
  let stdout = "";
  proc.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
  });
  proc.stdout?.on("data", (c: Buffer) => {
    stdout += c.toString("utf8");
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let lastErr: unknown;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(
        `host process exited early (code=${proc.exitCode}, signal=${proc.signalCode})\n` +
          `stdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        return { port, baseUrl, proc, homeDir, stop: () => stopHost(proc, homeDir) };
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await stopHost(proc, homeDir);
  throw new Error(
    `host did not become healthy on :${port} within timeout: ${String(lastErr)}\n` +
      `stdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`,
  );
}

function stopHost(proc: ChildProcess, homeDir: string): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = () => {
      try {
        fs.rmSync(homeDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      resolve();
    };
    if (proc.exitCode !== null || proc.signalCode !== null) {
      cleanup();
      return;
    }
    const t = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 3000);
    proc.once("exit", () => {
      clearTimeout(t);
      cleanup();
    });
    try {
      proc.kill();
    } catch {
      clearTimeout(t);
      cleanup();
    }
  });
}
