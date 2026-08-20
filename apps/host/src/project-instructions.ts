import fs from "node:fs/promises";
import path from "node:path";
import { resolveConfinedTarget } from "./workspace-confinement.js";

export const PROJECT_INSTRUCTION_CANDIDATES = ["AGENTS.md", "CLAUDE.md"] as const;
export const PROJECT_INSTRUCTIONS_MAX_BYTES = 100_000;

export type RecipeSnapshot = {
  status: "present" | "absent" | "failed";
  path: string | null;
  body: string;
};

export function composeSystemWithRecipe(
  base: string,
  snap: RecipeSnapshot,
): string {
  if (snap.status !== "present" || !snap.path) return base;
  return `${base}\n\n## Project instructions (\`${snap.path}\`)\n\n${snap.body}\n`;
}

export function inclusionFromStatus(
  status: RecipeSnapshot["status"],
): "included" | "not_included" | "failed" {
  if (status === "present") return "included";
  if (status === "failed") return "failed";
  return "not_included";
}

export async function resolveProjectInstructions(
  workspaceRoot: string,
): Promise<RecipeSnapshot> {
  for (const name of PROJECT_INSTRUCTION_CANDIDATES) {
    const candidate = path.join(workspaceRoot, name);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      return { status: "failed", path: name, body: "" };
    }

    let canonicalPath = candidate;
    try {
      const confined = await resolveConfinedTarget({
        workspace: workspaceRoot,
        target: name,
        kind: "read",
      });
      const verified = await confined.recheck();
      canonicalPath = verified.canonicalPath;
    } catch (error) {
      if ((error as Error).message === "outside_workspace") continue;
      return { status: "failed", path: name, body: "" };
    }

    if (st.size >= PROJECT_INSTRUCTIONS_MAX_BYTES) {
      return { status: "failed", path: name, body: "" };
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(canonicalPath);
    } catch {
      return { status: "failed", path: name, body: "" };
    }

    const sample = buf.subarray(0, Math.min(buf.length, 8192));
    if (sample.includes(0)) {
      return { status: "failed", path: name, body: "" };
    }

    let text = buf.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const trimmed = text.trim();
    if (!trimmed) continue;
    return { status: "present", path: name, body: trimmed };
  }

  return { status: "absent", path: null, body: "" };
}
