import path from "node:path";
import fs from "node:fs";

/**
 * Resolve a user-supplied path under workspace root.
 * Rejects absolute paths outside root and `..` escapes.
 */
// Workspace confinement: user paths must stay under the bound root.
export function resolveUnderWorkspace(
  workspaceRoot: string,
  userPath: string,
): string {
  const root = path.resolve(workspaceRoot);
  const raw = String(userPath ?? "").trim() || ".";
  // Treat absolute paths as only valid if already inside root
  const joined = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(root, raw);
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  // Windows: also block different drive
  if (process.platform === "win32") {
    const rootDrive = path.parse(root).root.toLowerCase();
    const joinedDrive = path.parse(joined).root.toLowerCase();
    if (rootDrive !== joinedDrive) {
      throw new Error(`Path escapes workspace: ${userPath}`);
    }
  }
  return joined;
}

export function relativeToWorkspace(
  workspaceRoot: string,
  absolutePath: string,
): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath));
}

export function ensureDirForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
