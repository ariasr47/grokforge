import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoBannedPositiveTrustClaims,
  isPackagedWindowsInstallerSession,
  paintInstallerSha,
  SETTINGS_UNSIGNED_LINE,
  WELCOME_EXPECTED_WARNING,
} from "./installerHonesty";

const HEX64 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("paintInstallerSha — SPEC §4 exact strings", () => {
  it("pending paints loading on Welcome and Settings (not unavailable)", () => {
    const welcome = paintInstallerSha({ status: "pending" }, "welcome");
    const settings = paintInstallerSha({ status: "pending" }, "settings");
    assert.equal(welcome.statusText, "Loading installer SHA-256…");
    assert.equal(settings.statusText, "Loading installer SHA-256…");
    assert.equal(welcome.hex, null);
    assert.equal(settings.hex, null);
    assert.notEqual(welcome.statusText, "Installer SHA-256 unavailable.");
    assert.notEqual(settings.statusText, "Installer SHA-256 unavailable");
  });

  it("live hex paints the label + hex and Welcome compare hint", () => {
    const welcome = paintInstallerSha({ status: "live", value: HEX64 }, "welcome");
    const settings = paintInstallerSha({ status: "live", value: HEX64 }, "settings");
    assert.equal(welcome.statusText, "Installer SHA-256:");
    assert.equal(welcome.hex, HEX64);
    assert.equal(
      welcome.hint,
      "Compare with the SHA-256 in the release notes for this version.",
    );
    assert.equal(settings.statusText, "Installer SHA-256:");
    assert.equal(settings.hex, HEX64);
    assert.equal(settings.hint, null);
  });

  it("live null paints successful-absent; Welcome and Settings copy differ; distinct from unreachable", () => {
    const welcome = paintInstallerSha({ status: "live", value: null }, "welcome");
    const settings = paintInstallerSha({ status: "live", value: null }, "settings");
    assert.equal(welcome.statusText, "Installer SHA-256 unavailable.");
    assert.equal(welcome.hint, "Find it in Settings when available.");
    assert.equal(settings.statusText, "Installer SHA-256 unavailable");
    assert.equal(settings.hint, null);
    assert.equal(welcome.hex, null);
    assert.equal(settings.hex, null);
    assert.notEqual(welcome.statusText, "Installer SHA-256 unreachable — host is offline.");
    assert.notEqual(settings.statusText, "Installer SHA-256 unreachable — host is offline.");
  });

  it("unreachable paints host-offline copy and does not point at Settings", () => {
    const welcome = paintInstallerSha({ status: "unreachable" }, "welcome");
    const settings = paintInstallerSha({ status: "unreachable" }, "settings");
    assert.equal(welcome.statusText, "Installer SHA-256 unreachable — host is offline.");
    assert.equal(settings.statusText, "Installer SHA-256 unreachable — host is offline.");
    assert.equal(welcome.hint, null);
    assert.equal(settings.hint, null);
    assert.equal(welcome.hex, null);
    assert.notEqual(welcome.statusText, "Installer SHA-256 unavailable.");
    assert.notEqual(settings.statusText, "Installer SHA-256 unavailable");
  });
});

describe("assertNoBannedPositiveTrustClaims", () => {
  it("fails on Verified publisher", () => {
    assert.throws(
      () => assertNoBannedPositiveTrustClaims("Verified publisher"),
      /banned positive/i,
    );
  });

  it("fails on this build is signed", () => {
    assert.throws(
      () => assertNoBannedPositiveTrustClaims("this build is signed"),
      /banned positive/i,
    );
  });

  it("fails on this build is Authenticode-signed", () => {
    assert.throws(
      () => assertNoBannedPositiveTrustClaims("this build is Authenticode-signed"),
      /banned positive/i,
    );
  });

  it("fails on Windows trusts this", () => {
    assert.throws(
      () => assertNoBannedPositiveTrustClaims("Windows trusts this"),
      /banned positive/i,
    );
  });

  it("passes on required negative not Authenticode-signed", () => {
    assert.doesNotThrow(() =>
      assertNoBannedPositiveTrustClaims(
        "this Windows installer is not Authenticode-signed",
      ),
    );
  });

  it("passes on required negative unsigned", () => {
    assert.doesNotThrow(() =>
      assertNoBannedPositiveTrustClaims("unsigned Windows current-user installer"),
    );
  });

  it("passes on SPEC expected-warning and Settings unsigned line", () => {
    assert.doesNotThrow(() =>
      assertNoBannedPositiveTrustClaims(WELCOME_EXPECTED_WARNING),
    );
    assert.doesNotThrow(() =>
      assertNoBannedPositiveTrustClaims(SETTINGS_UNSIGNED_LINE),
    );
  });
});

describe("isPackagedWindowsInstallerSession", () => {
  it("is false when tauri is false", () => {
    assert.equal(
      isPackagedWindowsInstallerSession({
        tauri: false,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
      false,
    );
  });

  it("is true for tauri + Windows UA", () => {
    assert.equal(
      isPackagedWindowsInstallerSession({
        tauri: true,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
      true,
    );
  });

  it("is false for tauri + non-Windows UA", () => {
    assert.equal(
      isPackagedWindowsInstallerSession({
        tauri: true,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
      false,
    );
  });
});
