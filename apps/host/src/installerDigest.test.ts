/**
 * Pin parse + Version-equality vouch (SPEC §2; INTERFACE installerSha256 present rules).
 * Present hex only when pin Version equals running APP_VERSION and sha256 is 64 lowercase hex.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseInstallerDigestPin, readInstallerSha256 } from "./installerDigest.js";

const APP = "0.6.6";
const HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function writePin(dir: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "installer-digest.pin"), body, "utf8");
}

describe("parseInstallerDigestPin", () => {
  it("accepts extra blank lines after trim for a valid two-line pin", () => {
    const parsed = parseInstallerDigestPin(`\nversion=${APP}\n\nsha256=${HEX}\n\n`);
    assert.deepEqual(parsed, { version: APP, sha256: HEX });
  });

  it("rejects a garbage third significant line", () => {
    assert.equal(
      parseInstallerDigestPin(`version=${APP}\nsha256=${HEX}\nextra=nope\n`),
      null,
    );
  });
});

describe("readInstallerSha256", () => {
  const dirs: string[] = [];
  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "installer-digest-"));
    dirs.push(dir);
    return dir;
  }
  after(() => {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("returns null when the pin file is missing", () => {
    assert.equal(readInstallerSha256({ dataDir: tmp(), appVersion: APP }), null);
  });

  it("vouches lowercase hex when pin Version equals APP_VERSION", () => {
    const dataDir = tmp();
    writePin(dataDir, `version=${APP}\nsha256=${HEX}\n`);
    assert.equal(readInstallerSha256({ dataDir, appVersion: APP }), HEX);
  });

  it("returns null on Version mismatch (anti-drift)", () => {
    const dataDir = tmp();
    writePin(dataDir, `version=0.6.5\nsha256=${HEX}\n`);
    assert.equal(readInstallerSha256({ dataDir, appVersion: APP }), null);
  });

  it("returns null for uppercase hex (no silent casefold on vouch)", () => {
    const dataDir = tmp();
    writePin(dataDir, `version=${APP}\nsha256=${HEX.toUpperCase()}\n`);
    assert.equal(readInstallerSha256({ dataDir, appVersion: APP }), null);
  });

  it("returns null for truncated, prefixed, or non-hex digests", () => {
    const truncated = tmp();
    writePin(truncated, `version=${APP}\nsha256=${HEX.slice(0, 63)}\n`);
    assert.equal(readInstallerSha256({ dataDir: truncated, appVersion: APP }), null);

    const prefixed = tmp();
    writePin(prefixed, `version=${APP}\nsha256=0x${HEX}\n`);
    assert.equal(readInstallerSha256({ dataDir: prefixed, appVersion: APP }), null);

    const nonHex = tmp();
    writePin(nonHex, `version=${APP}\nsha256=${"g".repeat(64)}\n`);
    assert.equal(readInstallerSha256({ dataDir: nonHex, appVersion: APP }), null);
  });

  it("never invents a digest when the pin is absent", () => {
    const dataDir = tmp();
    const got = readInstallerSha256({ dataDir, appVersion: APP });
    assert.equal(got, null);
    assert.equal(/^[0-9a-f]{64}$/.test(String(got ?? "")), false);
  });
});
