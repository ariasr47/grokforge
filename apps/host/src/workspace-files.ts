import fs from "node:fs/promises";
import path from "node:path";

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  ".spire",
  "coverage",
  ".desktop-profile",
]);

export async function listWorkspaceFiles(
  workspaceRoot: string,
  maxFiles = 20_000,
): Promise<string[]> {
  const root = path.resolve(workspaceRoot);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      // Skip heavy dirs; allow common dotfiles used by devs (.env.example, .github is dir)
      if (SKIP.has(ent.name)) continue;
      if (ent.name.startsWith(".") && ent.isDirectory() && ent.name !== ".github") {
        continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}
