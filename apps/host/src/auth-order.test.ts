/**
 * Documented auth hierarchy for product: subscription preferred, API key backup.
 * Pure unit of ordering helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors resolveApiKeyAsync priority (sources only). */
function pickAuthSource(flags: {
  env?: boolean;
  oauth?: boolean;
  grok_build?: boolean;
  config?: boolean;
}): string {
  // Explicit env wins for CI/dev
  if (flags.env) return "env";
  // Subscription pool preferred over stored API key
  if (flags.oauth) return "oauth";
  if (flags.grok_build) return "grok_build";
  // API key is backup
  if (flags.config) return "config";
  return "none";
}

describe("auth hierarchy (sub preferred, key backup)", () => {
  it("prefers oauth over config api key", () => {
    assert.equal(
      pickAuthSource({ oauth: true, config: true }),
      "oauth",
    );
  });
  it("uses config key when no pool", () => {
    assert.equal(pickAuthSource({ config: true }), "config");
  });
  it("env overrides all for dev", () => {
    assert.equal(
      pickAuthSource({ env: true, oauth: true, config: true }),
      "env",
    );
  });
  it("signed out when empty", () => {
    assert.equal(pickAuthSource({}), "none");
  });
});
