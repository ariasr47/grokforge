import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ORIGINS as PROD } from "./allowed-origins.prod.js";
import { ALLOWED_ORIGINS as DEV } from "./allowed-origins.dev.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("per-channel allowlist variants (SPEC §2.7 rule 4)", () => {
  it("prod contains the packaged origin and nothing else", () => {
    assert.deepEqual([...PROD], ["http://tauri.localhost"]);
  });

  it("dev contains the packaged origin plus the localhost x 5173/5174 cross-product", () => {
    assert.deepEqual([...DEV].sort(), [
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://tauri.localhost",
    ]);
  });

  it("prod carries no dev-channel literal — the artifact assertion in miniature (AC-S4)", () => {
    const src = fs.readFileSync(path.join(here, "allowed-origins.prod.ts"), "utf8");
    for (const banned of ["5173", "5174", "localhost:"]) {
      assert.equal(src.includes(banned), false, `prod variant contains ${banned}`);
    }
  });

  it("request-lockdown never keys the allowlist on the runtime channel (SPEC §2.7 trap)", () => {
    const src = fs.readFileSync(path.join(here, "request-lockdown.ts"), "utf8");
    assert.equal(src.includes("resolveChannel"), false);
    assert.equal(src.includes("process.env"), false);
    assert.equal(src.includes("./channel"), false);
  });
});
