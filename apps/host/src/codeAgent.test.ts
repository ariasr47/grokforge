import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  resolveVendorCliPath,
  stampCodeAgentFact,
  vendorSpawnEnv,
  type CodeAgentFact,
} from "./codeAgent.js";

describe("resolveVendorCliPath", () => {
  it("prefers grok.exe on win32 when both exist", () => {
    const hit = resolveVendorCliPath({
      platform: "win32",
      pathEnv: "C:\\fake-bin",
      pathExt: ".EXE;.CMD",
      isFile: (p) => /grok\.exe$/i.test(p) || /grok$/i.test(p),
    });
    assert.ok(hit && /grok\.exe$/i.test(hit));
  });
  it("returns null when neither grok.exe nor grok exists", () => {
    assert.equal(
      resolveVendorCliPath({
        platform: "win32",
        pathEnv: "C:\\empty",
        pathExt: ".EXE",
        isFile: () => false,
      }),
      null,
    );
  });
});

describe("stampCodeAgentFact", () => {
  it("cli miss → ready/fallback/cli_missing", () => {
    assert.deepEqual(stampCodeAgentFact({ kind: "cli_missing" }), {
      resolveStatus: "ready",
      identity: "fallback",
      fallbackReason: "cli_missing",
    } satisfies CodeAgentFact);
  });
  it("vendor hit → ready/vendor/null reason", () => {
    assert.deepEqual(stampCodeAgentFact({ kind: "vendor" }), {
      resolveStatus: "ready",
      identity: "vendor",
      fallbackReason: null,
    });
  });
  it("hard_fail pairs both fields", () => {
    assert.deepEqual(stampCodeAgentFact({ kind: "hard_fail" }), {
      resolveStatus: "hard_fail",
      identity: "hard_fail",
      fallbackReason: null,
    });
  });
  it("resolving has null identity", () => {
    assert.deepEqual(stampCodeAgentFact({ kind: "resolving" }), {
      resolveStatus: "resolving",
      identity: null,
      fallbackReason: null,
    });
  });
});

describe("vendorSpawnEnv", () => {
  it("omits XAI_API_KEY even when present in base", () => {
    const env = vendorSpawnEnv({
      PATH: "x",
      XAI_API_KEY: "host-secret",
      GROK_API_KEY: "also-secret",
      GROKFORGE_MODE: "code",
    });
    assert.equal("XAI_API_KEY" in env, false);
    assert.equal("GROK_API_KEY" in env, false);
    assert.equal(env.GROKFORGE_MODE, "code");
  });
});
