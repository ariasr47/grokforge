import fs from "node:fs/promises";
import path from "node:path";

// Project instructions are host-read AGENTS.md, not a Forge skills catalog.
export const PROJECT_INSTRUCTION_CANDIDATES = ["AGENTS.md", "CLAUDE.md"] as const;
export const PROJECT_INSTRUCTIONS_MAX_BYTES = 100_000;

export type RecipeSnapshot = {
  status: "present" | "absent" | "failed";
  path: string | null;
  body: string;
};

function isWithin(root: string, candidate: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const r = normalize(root);
  const c = normalize(candidate);
  return c === r || c.startsWith(r + path.sep) || c.startsWith(r + "/");
}

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
  let realRoot: string;
  try {
    realRoot = await fs.realpath(workspaceRoot);
  } catch {
    return { status: "absent", path: null, body: "" };
  }

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

    let realCandidate: string;
    try {
      realCandidate = await fs.realpath(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      return { status: "failed", path: name, body: "" };
    }
    if (!isWithin(realRoot, realCandidate)) continue;

    if (st.size >= PROJECT_INSTRUCTIONS_MAX_BYTES) {
      return { status: "failed", path: name, body: "" };
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(candidate);
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
