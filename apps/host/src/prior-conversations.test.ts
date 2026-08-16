/**
 * Host-level read path for `priorConversations` (SPEC §2.8/§9.1, INTERFACE_CONTRACT.md, D1).
 * Seeds `shells.json` directly in the fake home rather than driving a live model turn, which keeps
 * this row deterministic — the *live* end-to-end read is AC12d, a `review` row by design (SPEC §7).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startHost, type StartedHost } from "./test-support/host-process.js";
import { ALLOWED_ORIGINS } from "./allowed-origins.js";

const ALLOWED = ALLOWED_ORIGINS[0]; // http://tauri.localhost in both variants
let host: StartedHost;

before(async () => {
  host = await startHost({ port: 8933 });
});
after(async () => {
  await host.stop();
});

describe("GET /api/state priorConversations — origin-keyed, deterministic on a fresh host", () => {
  it("is false and boolean-typed on a fresh host, for an allowed origin", async () => {
    const res = await fetch(`${host.baseUrl}/api/state`, { headers: { Origin: ALLOWED } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(typeof body.priorConversations, "boolean");
    assert.equal(body.priorConversations, false);
  });

  it("is false for a header-less request too (the conformance runner's own path)", async () => {
    const res = await fetch(`${host.baseUrl}/api/state`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(typeof body.priorConversations, "boolean");
    assert.equal(body.priorConversations, false);
  });

  it("flips true for the origin recorded in shells.json, stays false for a header-less caller", async () => {
    // Full cross-shell attribution (AC12e: a DIFFERENT allowed origin must read false) is proven at
    // the pure-function level in shell-history.test.ts, because it needs two distinct allowlisted
    // origins and the prod-channel allowlist generated for this suite by default has exactly one
    // (SPEC §2.7 rule 4) — that asymmetry is itself the property under test, not a gap. Here we
    // prove the HTTP edge actually reads the seeded store rather than always answering false, and
    // that a header-less request (the conformance runner's own path) still reads false regardless.
    const store = {
      version: 1,
      shells: { [ALLOWED]: { conversations: 1, firstAt: 1, lastAt: 1 } },
    };
    // startHost runs the host with GROKFORGE_CHANNEL=test, which channel.ts resolves to the "dev"
    // data-root isolation (.grokforge-dev) — mirrors the fake-home isolation the harness documents.
    fs.mkdirSync(host.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(host.dataDir, "shells.json"),
      JSON.stringify(store),
      "utf8",
    );

    const resAllowed = await fetch(`${host.baseUrl}/api/state`, { headers: { Origin: ALLOWED } });
    const bodyAllowed = (await resAllowed.json()) as Record<string, unknown>;
    assert.equal(bodyAllowed.priorConversations, true);

    const resHeaderless = await fetch(`${host.baseUrl}/api/state`);
    const bodyHeaderless = (await resHeaderless.json()) as Record<string, unknown>;
    assert.equal(bodyHeaderless.priorConversations, false);
  });
});
