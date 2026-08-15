/**
 * Per-install partition key (SPEC §2.8 amendment, GATE Z ruling 2026-08-13, option A: "The prod
 * data root stays frozen and shared. The workspace-scoped fields are partitioned by install
 * identity inside it.").
 *
 * Derived from the absolute, symlink-resolved directory this exact running module was loaded
 * from:
 *   - packaged build:  `%LOCALAPPDATA%\<productName>\resources\host\` (the esbuild single-file
 *     bundle staged by `scripts/bundle-host.mjs`, SPEC §2.2)
 *   - from-source dev: `apps/host/src` (via `tsx`) or `apps/host/dist` (built)
 *
 * These are two physically different locations on the same machine and there is no environment
 * variable that changes which directory a module was loaded from — this is deliberately the same
 * trap class as `resolveChannel()` reading `process.env.GROKFORGE_CHANNEL` (SPEC §2.7) and the
 * Rust launcher's `option_env!` rule (SPEC §2.7/§9): identity is baked into *where the code
 * physically is*, never read from something the running process claims about itself at runtime.
 * `GROKFORGE_AGENT_ENTRY` and every other `GROKFORGE_*` env var are deliberately not consulted
 * here for that reason, even though `GROKFORGE_AGENT_ENTRY` already carries an absolute path for
 * a different purpose (§2.3 resource resolution).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

function resolveModuleDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    return fs.realpathSync(here);
  } catch {
    return here;
  }
}

/**
 * Pure hash step, exported separately so tests can exercise the partitioning property (same input
 * → same key, different directories → different keys, case-insensitive on Windows) without having
 * to fake `import.meta.url`.
 */
export function hashInstallDir(dir: string): string {
  // Windows paths are case-insensitive; normalize so the same physical install never straddles
  // two partition keys because of drive-letter or path casing.
  const normalized = process.platform === "win32" ? dir.toLowerCase() : dir;
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** The current process's install identity. Memoized: a running host's module location never moves. */
export function installIdentity(): string {
  if (cached == null) cached = hashInstallDir(resolveModuleDir());
  return cached;
}
