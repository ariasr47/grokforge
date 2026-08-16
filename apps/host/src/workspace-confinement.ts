import fs from "node:fs/promises";
import path from "node:path";

export type ConfinedTarget = {
  path: string;
  canonicalPath: string;
  recheck: () => Promise<ConfinedTarget>;
};

function isWithin(root: string, candidate: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const r = normalize(root);
  const c = normalize(candidate);
  return c === r || c.startsWith(r + path.sep) || c.startsWith(r + "/");
}

function hasParentSegment(target: string): boolean {
  return target.split(/[\\/]/).some((part) => part === "..");
}

/** Resolve a structured target against the canonical workspace root. */
export async function resolveConfinedTarget(input: {
  workspace: string;
  target: string;
  kind?: string;
}): Promise<ConfinedTarget> {
  if (!path.isAbsolute(input.workspace) || hasParentSegment(input.target)) {
    throw new Error("outside_workspace");
  }
  const root = await fs.realpath(input.workspace).catch(() => {
    throw new Error("outside_workspace");
  });
  const candidate = path.isAbsolute(input.target)
    ? path.resolve(input.target)
    : path.resolve(root, input.target);
  if (!isWithin(root, candidate)) throw new Error("outside_workspace");

  let probe = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      const real = await fs.realpath(probe);
      if (!isWithin(root, real)) throw new Error("outside_workspace");
      const canonicalPath = missing.length
        ? path.join(real, ...missing)
        : real;
      if (!isWithin(root, canonicalPath)) throw new Error("outside_workspace");
      return {
        path: candidate,
        canonicalPath,
        recheck: () => resolveConfinedTarget(input),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw new Error("outside_workspace");
      missing.unshift(path.basename(probe));
      probe = parent;
    }
  }
}
