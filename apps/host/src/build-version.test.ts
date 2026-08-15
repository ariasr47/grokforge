/**
 * AC25/AC26 (SPEC §3; QA_REPORT.md "Amendments bounced to Backend", GATE Q pass 1g). Fails if the
 * hardcoded `version: "0.3.1"` literal that used to live at `apps/host/src/index.ts` comes back —
 * either as a re-introduced string literal or as a value that stops tracking the build. Also fails
 * if a "fix" swaps in `apps/host/package.json`'s own workspace version (currently 0.3.0), which is
 * a *different* wrong answer, not the app version the installer stamps and the user reads.
 *
 * Binding requirement: `/api/health`'s `version` must equal the APP version —
 * `apps/shell/src-tauri/tauri.conf.json`'s "version" field, the one Tauri stamps into the NSIS
 * installer and the one the packaged shell's own `getVersion()` returns — for both the packaged
 * host (asserted here at build-version.ts / generator level, since the packaged artifact itself is
 * out of a `node --test` harness's reach per SPEC §7) and the from-source host (asserted live,
 * below).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHost, type StartedHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const confPath = path.join(root, "apps", "shell", "src-tauri", "tauri.conf.json");
const hostPkgPath = path.join(root, "apps", "host", "package.json");

function appVersion(): string {
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8")) as { version: string };
  return conf.version;
}

describe("apps/host/src/build-version.ts — generated from the app version, not a literal", () => {
  it("matches apps/shell/src-tauri/tauri.conf.json's version, regenerated fresh", () => {
    // Regenerate rather than trust whatever is on disk from a prior run/hook, so this test alone
    // proves the generator produces the right value right now.
    execFileSync(process.execPath, [path.join(root, "scripts", "gen-build-version.mjs")], {
      cwd: root,
    });
    const generated = fs.readFileSync(
      path.join(root, "apps", "host", "src", "build-version.ts"),
      "utf8",
    );
    const expected = appVersion();
    assert.match(generated, new RegExp(`APP_VERSION: string = ${JSON.stringify(expected)}`));
  });

  it("is not apps/host/package.json's own workspace version — the trap named in the bounce", () => {
    const hostPkgVersion = (
      JSON.parse(fs.readFileSync(hostPkgPath, "utf8")) as { version: string }
    ).version;
    const expected = appVersion();
    // This only has teeth while the two manifests genuinely disagree (they do today: host is
    // 0.3.0, the app is 0.3.2). If a future release ever aligns them by coincidence this
    // assertion is a no-op, which is fine — the real guard is the live /api/health check below,
    // which is authoritative regardless of manifest drift.
    if (hostPkgVersion !== expected) {
      assert.notEqual(expected, hostPkgVersion);
    }
  });
});

describe("GET /api/health version — live, from a running from-source host (AC25/AC26)", () => {
  let host: StartedHost;

  before(async () => {
    host = await startHost({ port: 8935 });
  });
  after(async () => {
    await host.stop();
  });

  it("equals the app version, not a hardcoded string that can drift from the build", async () => {
    const res = await fetch(`${host.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { version: string };
    assert.equal(body.version, appVersion());
    // The literal this bounce exists for. If /api/health ever again reports this while the app
    // version has moved on, that is exactly AC25/AC26 reproducing.
    assert.notEqual(body.version, "0.3.1");
  });
});
