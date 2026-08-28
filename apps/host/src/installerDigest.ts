import fs from "node:fs";
import path from "node:path";

const HEX64 = /^[0-9a-f]{64}$/;

export function parseInstallerDigestPin(
  text: string,
): { version: string; sha256: string } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 2) return null;
  const v = /^version=(.+)$/.exec(lines[0] ?? "");
  const s = /^sha256=([0-9a-f]+)$/.exec(lines[1] ?? "");
  if (!v || !s) return null;
  const version = v[1] ?? "";
  const sha256 = s[1] ?? "";
  if (!version || !HEX64.test(sha256)) return null;
  return { version, sha256 };
}

export function readInstallerSha256(opts: {
  dataDir: string;
  appVersion: string;
  readFileSync?: (p: string, enc: "utf8") => string;
}): string | null {
  const read = opts.readFileSync ?? ((p, enc) => fs.readFileSync(p, enc));
  const pinPath = path.join(opts.dataDir, "installer-digest.pin");
  let raw: string;
  try {
    raw = read(pinPath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseInstallerDigestPin(raw);
  if (!parsed) return null;
  if (parsed.version !== opts.appVersion) return null;
  return parsed.sha256;
}
