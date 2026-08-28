/**
 * Static packaging fixtures for NSIS installerHooks (SPEC §9 / PLAN B3).
 * Does not run a Tauri build — GATE Q still observes a real install/upgrade hash+write.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const confPath = path.join(root, "apps", "shell", "src-tauri", "tauri.conf.json");
const hookPath = path.join(
  root,
  "apps",
  "shell",
  "src-tauri",
  "windows",
  "installer-hooks.nsh",
);

describe("NSIS installerHooks packaging fixtures", () => {
  it("tauri.conf.json nsis.installerHooks equals ./windows/installer-hooks.nsh", () => {
    const conf = JSON.parse(fs.readFileSync(confPath, "utf8")) as {
      bundle?: { windows?: { nsis?: { installerHooks?: string } } };
    };
    assert.equal(
      conf.bundle?.windows?.nsis?.installerHooks,
      "./windows/installer-hooks.nsh",
    );
  });

  it("hook file defines NSIS_HOOK_POSTINSTALL", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    assert.match(hook, /!macro\s+NSIS_HOOK_POSTINSTALL\b/);
  });

  it("hook hashes locally (Get-FileHash or certutil) and names installer-digest.pin", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    assert.match(hook, /Get-FileHash|certutil/);
    assert.match(hook, /installer-digest\.pin/);
  });

  it("hash helper resets PSModulePath or uses certutil (not bare Get-FileHash)", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    const hashLines = hook
      .split(/\r?\n/)
      .filter((line) => /nsExec::ExecToStack/.test(line));
    assert.ok(hashLines.length > 0, "POSTINSTALL must nsExec a hash helper");
    const hashBlock = hashLines.join("\n");
    const usesCertutil = /\bcertutil\b/i.test(hashBlock);
    const resetsPsModulePath =
      /\$\$env:PSModulePath/.test(hashBlock) ||
      /Remove-Item\s+Env:\\PSModulePath/i.test(hashBlock);
    assert.ok(
      usesCertutil || resetsPsModulePath,
      "bare Get-FileHash without PSModulePath reset fails when setup.exe inherits pwsh 7 PSModulePath",
    );
    if (!usesCertutil) {
      assert.match(hashBlock, /Get-FileHash/);
    }
  });

  it("hook branches Forge Dev /.grokforge-dev and prod /.grokforge", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    assert.match(hook, /dev\.grokforge\.shell\.dev|Forge Dev/);
    assert.match(hook, /\$PROFILE\\?\.grokforge-dev/);
    assert.match(hook, /\$PROFILE\\?\.grokforge(?!-dev)/);
  });

  it("hook writes version= and sha256= lines", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    assert.match(hook, /version=/);
    assert.match(hook, /sha256=/);
  });
});
