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

describe("write-installer-pin.ps1 writes a vouched pin", () => {
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
    "hashes a payload and writes version=/sha256= under the data dir",
    { skip: process.platform !== "win32" },
    () => {
      const script = path.join(
        root,
        "apps",
        "shell",
        "src-tauri",
        "windows",
        "write-installer-pin.ps1",
      );
      assert.equal(fs.existsSync(script), true, "write-installer-pin.ps1 must exist beside installer-hooks.nsh");

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokforge-write-pin-"));
      dirs.push(dir);
      const payload = path.join(dir, "Forge_setup.exe");
      const dataDir = path.join(dir, "data");
      const bytes = Buffer.from("grokforge-pin-write-helper\n");
      fs.writeFileSync(payload, bytes);
      const expected = crypto.createHash("sha256").update(bytes).digest("hex");

      const sysps = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const r = spawnSync(
        sysps,
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-ExePath",
          payload,
          "-DataDir",
          dataDir,
          "-Version",
          "0.6.7",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PSModulePath: pwsh7StylePsModulePath() },
          windowsHide: true,
          timeout: 30_000,
        },
      );
      assert.equal(
        r.status,
        0,
        `write-installer-pin.ps1 exit ${r.status} stdout=${r.stdout} stderr=${r.stderr.slice(0, 400)}`,
      );
      const pin = fs.readFileSync(path.join(dataDir, "installer-digest.pin"), "utf8");
      assert.equal(pin, `version=0.6.7\r\nsha256=${expected}\r\n`);
    },
  );
});

describe("NSIS POSTINSTALL hash helper under pwsh-7 PSModulePath", () => {
  it("nsExec launches write-installer-pin.ps1 with -File (no PowerShell $ in the command line)", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    const execLine = hook.split(/\r?\n/).find((line) => /nsExec::ExecToStack/.test(line)) ?? "";
    assert.match(execLine, /-File/);
    assert.match(execLine, /grokforge-write-pin\.ps1/);
    assert.equal(/\$env\b/.test(execLine.replaceAll("$$", "")), false);
  });
});
