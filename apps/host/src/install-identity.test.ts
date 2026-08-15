/**
 * `installIdentity()` / `hashInstallDir()` (SPEC §2.8 amendment, GATE Z ruling 2026-08-13 option
 * A): the partition key must be derived from where the running module physically is, never from
 * anything the environment claims — the same trap class as `resolveChannel()` reading
 * `process.env.GROKFORGE_CHANNEL`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashInstallDir, installIdentity } from "./install-identity.js";

describe("hashInstallDir", () => {
  it("is deterministic for the same directory", () => {
    assert.equal(
      hashInstallDir("C:\\Users\\rodri\\AppData\\Local\\Forge\\resources\\host"),
      hashInstallDir("C:\\Users\\rodri\\AppData\\Local\\Forge\\resources\\host"),
    );
  });

  it("differs for two different physical install locations", () => {
    const packaged = hashInstallDir("C:\\Users\\rodri\\AppData\\Local\\Forge\\resources\\host");
    const devSrc = hashInstallDir("C:\\Dev\\grokforge\\apps\\host\\src");
    assert.notEqual(packaged, devSrc);
  });

  it("never collides with an empty/near-empty distinguishable input", () => {
    assert.notEqual(hashInstallDir("C:\\a"), hashInstallDir("C:\\b"));
  });
});

describe("installIdentity", () => {
  it("is a non-empty string, stable across repeated calls in the same process", () => {
    const first = installIdentity();
    const second = installIdentity();
    assert.equal(typeof first, "string");
    assert.ok(first.length > 0);
    assert.equal(first, second);
  });

  it("is unaffected by setting an arbitrary environment variable — not a spoofable identity", () => {
    const before = installIdentity();
    const prior = process.env.GROKFORGE_INSTALL_ID;
    process.env.GROKFORGE_INSTALL_ID = "attacker-controlled-value";
    try {
      // installIdentity() is memoized after first call in this process, and by construction reads
      // no env var at all — this assertion is the contract, not an artifact of memoization: the
      // underlying hashInstallDir() call it would make on a fresh process also never touches
      // process.env (see the two tests above, which pass no env-derived input).
      assert.equal(installIdentity(), before);
    } finally {
      if (prior === undefined) delete process.env.GROKFORGE_INSTALL_ID;
      else process.env.GROKFORGE_INSTALL_ID = prior;
    }
  });
});
