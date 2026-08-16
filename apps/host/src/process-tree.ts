import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

/** Kill an owned process and all descendants. The argv is fixed (never shell parsed). */
export async function terminateProcessTree(pid: number, platform = process.platform): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
    return;
  }
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
}

export function detachedSpawnOptions(platform = process.platform): { detached?: boolean } {
  return platform === "win32" ? {} : { detached: true };
}
