import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Best-effort current branch (or short SHA if detached). */
export async function getGitBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: 5000, windowsHide: true },
    );
    const branch = stdout.trim();
    if (!branch || branch === "HEAD") {
      const sha = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
        cwd,
        timeout: 5000,
        windowsHide: true,
      });
      return `detached-${sha.stdout.trim()}` || null;
    }
    return branch;
  } catch {
    return null;
  }
}
