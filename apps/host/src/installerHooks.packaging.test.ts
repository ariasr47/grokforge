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
const helperPath = path.join(
  root,
  "apps",
  "shell",
  "src-tauri",
  "windows",
  "write-installer-pin.ps1",
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
    const helper = fs.readFileSync(helperPath, "utf8");
    assert.match(helper, /Get-FileHash|certutil/);
    assert.match(helper, /installer-digest\.pin/);
    assert.match(hook, /write-installer-pin\.ps1/);
  });

  it("hash helper resets PSModulePath or uses certutil (not bare Get-FileHash)", () => {
    const helper = fs.readFileSync(helperPath, "utf8");
    const usesCertutil = /\bcertutil\b/i.test(helper);
    const pinsPs51Modules = /WindowsPowerShell\\v1\.0\\Modules/i.test(helper);
    assert.ok(
      usesCertutil || pinsPs51Modules,
      "bare Get-FileHash without a 5.1 module path fails when setup.exe inherits pwsh 7 PSModulePath",
    );
    if (!usesCertutil) {
      assert.match(helper, /Get-FileHash/);
    }
  });

  it("hook branches Forge Dev /.grokforge-dev and prod /.grokforge", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    assert.match(hook, /dev\.grokforge\.shell\.dev|Forge Dev/);
    assert.match(hook, /\$PROFILE\\?\.grokforge-dev/);
    assert.match(hook, /\$PROFILE\\?\.grokforge(?!-dev)/);
  });

  it("hook writes version= and sha256= lines", () => {
    const helper = fs.readFileSync(helperPath, "utf8");
    assert.match(helper, /version=/);
    assert.match(helper, /sha256=/);
  });

  it("POSTINSTALL launches write-installer-pin.ps1 with -File so stdout length is not the pin gate", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    assert.match(hook, /write-installer-pin\.ps1/);
    assert.match(hook, /-File/);
    assert.equal(
      /IntCmp\s+\$R6\s+64/.test(hook),
      false,
      "64-char stdout IntCmp drops the pin when nsExec captures extra bytes",
    );
  });

  it("packs write-installer-pin.ps1 via include-time GROKFORGE_WRITE_PIN_PS1 (not __FILEDIR__ inside the macro)", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    const defineIdx = hook.search(
      /!define\s+GROKFORGE_WRITE_PIN_PS1\s+"\$\{__FILEDIR__\}\\write-installer-pin\.ps1"/,
    );
    const macroIdx = hook.search(/!macro\s+NSIS_HOOK_POSTINSTALL\b/);
    assert.ok(
      defineIdx >= 0,
      "GROKFORGE_WRITE_PIN_PS1 must capture __FILEDIR__ at !include time",
    );
    assert.ok(macroIdx >= 0);
    assert.ok(
      defineIdx < macroIdx,
      "GROKFORGE_WRITE_PIN_PS1 must be defined before NSIS_HOOK_POSTINSTALL — inside the macro __FILEDIR__ is the generated installer.nsi dir",
    );
    const macroBody = hook.slice(macroIdx);
    assert.match(
      macroBody,
      /File\s+"\/oname=\$TEMP\\grokforge-write-pin\.ps1"\s+"\$\{GROKFORGE_WRITE_PIN_PS1\}"/,
    );
    assert.equal(
      /\$\{__FILEDIR__\}/.test(macroBody),
      false,
      "${__FILEDIR__} inside the macro is the generated nsis/x64 dir; File then misses write-installer-pin.ps1",
    );
  });
});
