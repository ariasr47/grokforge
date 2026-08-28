/**
 * Executes the POSTINSTALL hash helper under a pwsh-7-style PSModulePath.
 * Bare Get-FileHash in Windows PowerShell 5.1 then fails (QA Z1 bounce).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const hookPath = path.join(
  root,
  "apps",
  "shell",
  "src-tauri",
  "windows",
  "installer-hooks.nsh",
);

const HEX64 = /^[0-9a-f]{64}$/;

function extractNsisExecCommands(source: string): string[] {
  const out: string[] = [];
  const needle = "nsExec::ExecToStack";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf(needle, i);
    if (at < 0) break;
    let p = at + needle.length;
    while (p < source.length && /\s/.test(source[p] ?? "")) p += 1;
    if (source[p] !== "'") {
      i = p;
      continue;
    }
    p += 1;
    let cmd = "";
    while (p < source.length) {
      const ch = source[p];
      if (ch === "'") {
        if (source[p + 1] === "'") {
          cmd += "'";
          p += 2;
          continue;
        }
        p += 1;
        break;
      }
      cmd += ch;
      p += 1;
    }
    out.push(cmd);
    i = p;
  }
  return out;
}

function expandNsisHashCommand(command: string, exePath: string): string {
  const sysdir = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const windir = process.env.SystemRoot ?? "C:\\Windows";
  const dollar = "\u0000";
  return command
    .replaceAll("$$", dollar)
    .replaceAll("$EXEPATH", exePath)
    .replaceAll("$SYSDIR", sysdir)
    .replaceAll("$WINDIR", windir)
    .replaceAll(dollar, "$");
}

function pwsh7StylePsModulePath(): string {
  const inherited = process.env.PSModulePath ?? "";
  const fromInherited = inherited
    .split(";")
    .filter(
      (p) =>
        /(?:^|[\\/])PowerShell[\\/]/i.test(p) && !/WindowsPowerShell/i.test(p),
    );
  return [
    path.join(os.homedir(), "Documents", "PowerShell", "Modules"),
    "C:\\Program Files\\PowerShell\\Modules",
    "C:\\Program Files\\PowerShell\\7\\Modules",
    ...fromInherited,
    inherited,
  ]
    .filter(Boolean)
    .join(";");
}

function runExpandedHashCommand(
  expanded: string,
  env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; status: number | null } {
  if (/\bcertutil\b/i.test(expanded) && !/-Command\b/i.test(expanded)) {
    const m = expanded.match(
      /-hashfile\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+SHA256/i,
    );
    const file = m?.[1] ?? m?.[2] ?? m?.[3];
    if (!file) throw new Error(`certutil path not found in: ${expanded}`);
    const r = spawnSync("certutil", ["-hashfile", file, "SHA256"], {
      encoding: "utf8",
      env,
      windowsHide: true,
      timeout: 30_000,
    });
    const noSpace = (r.stdout ?? "").replace(/\s+/g, "");
    const hex = noSpace.match(/[0-9a-fA-F]{64}/)?.[0]?.toLowerCase() ?? "";
    return { stdout: hex, stderr: r.stderr ?? "", status: r.status };
  }

  const quotedExe = expanded.match(/^"([^"]+)"/);
  const bareExe = expanded.match(/^(\S+)/);
  const exe = quotedExe?.[1] ?? bareExe?.[1];
  const cmdMatch = expanded.match(/-Command\s+"(.*)"\s*$/s);
  if (!exe || !cmdMatch) {
    throw new Error(`cannot parse hash helper command: ${expanded}`);
  }
  const r = spawnSync(exe, ["-NoProfile", "-Command", cmdMatch[1]], {
    encoding: "utf8",
    env,
    windowsHide: true,
    timeout: 30_000,
  });
  return {
    stdout: (r.stdout ?? "").replace(/[\r\n]+$/g, ""),
    stderr: r.stderr ?? "",
    status: r.status,
  };
}

describe("NSIS POSTINSTALL hash helper under pwsh-7 PSModulePath", () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it(
    "yields 64 lowercase hex matching node crypto when PSModulePath is pwsh-7",
    { skip: process.platform !== "win32" },
    () => {
      const hook = fs.readFileSync(hookPath, "utf8");
      const commands = extractNsisExecCommands(hook);
      const hashCmd = commands.find((c) =>
        /Get-FileHash|certutil|hashfile|SHA256/i.test(c),
      );
      assert.ok(
        hashCmd,
        "installer-hooks.nsh must nsExec a local SHA-256 helper",
      );

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokforge-hash-helper-"));
      dirs.push(dir);
      const payload = path.join(dir, "payload.bin");
      const bytes = Buffer.from("grokforge-z1-psmodulepath-hash-helper\n");
      fs.writeFileSync(payload, bytes);
      const expected = crypto.createHash("sha256").update(bytes).digest("hex");

      const expanded = expandNsisHashCommand(hashCmd, payload);
      const env = { ...process.env, PSModulePath: pwsh7StylePsModulePath() };
      const result = runExpandedHashCommand(expanded, env);
      const hex = result.stdout.trim().toLowerCase();
      assert.match(
        hex,
        HEX64,
        `hash helper stdout must be 64 lowercase hex under pwsh-7 PSModulePath (status=${result.status} stderr=${result.stderr.slice(0, 400)})`,
      );
      assert.equal(hex, expected);
    },
  );
});
