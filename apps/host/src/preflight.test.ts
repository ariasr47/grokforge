/**
 * AC-S1/AC-S2/AC-S3/AC23 asserted at host level, not at predicate level (SPEC §2.7, INTERFACE_CONTRACT.md
 * "Request lockdown"). Getting the allow-side preflight wrong is a TOTAL connect failure in the
 * packaged WebView, so it gets its own replay test rather than riding on the deny side.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startHost, type StartedHost } from "./test-support/host-process.js";
import { ALLOWED_ORIGINS } from "./allowed-origins.js";

const ALLOWED = ALLOWED_ORIGINS[0]; // http://tauri.localhost in both variants
const EVIL = "https://evil.example";
let host: StartedHost;

before(async () => {
  host = await startHost({ port: 8931 });
});
after(async () => {
  await host.stop();
});

describe("AC-S1 — preflight from an allowed origin is answered, and the real request follows", () => {
  it("OPTIONS /api/state with Access-Control-Request-Headers: content-type", async () => {
    const res = await fetch(`${host.baseUrl}/api/state`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.ok(res.status >= 200 && res.status < 300, `preflight status ${res.status}`);
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
    assert.equal(res.headers.get("vary"), "Origin");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(
      (res.headers.get("access-control-allow-headers") ?? "").toLowerCase(),
      /content-type/,
    );
  });

  it("the subsequent POST from that origin is accepted", async () => {
    const res = await fetch(`${host.baseUrl}/api/effort`, {
      method: "POST",
      headers: { Origin: ALLOWED, "Content-Type": "application/json" },
      body: JSON.stringify({ effort: "auto" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
  });
});

describe("AC-S2 / AC-S3 — deny side and the absent-Origin carve-out", () => {
  it("OPTIONS from a foreign origin is 403 with no ACAO for it", async () => {
    const res = await fetch(`${host.baseUrl}/api/state`, {
      method: "OPTIONS",
      headers: { Origin: EVIL, "Access-Control-Request-Headers": "content-type" },
    });
    assert.equal(res.status, 403);
    assert.notEqual(res.headers.get("access-control-allow-origin"), EVIL);
  });

  it("GET /api/health with NO Origin header is 200 — the native probe path (AC-S3)", async () => {
    const res = await fetch(`${host.baseUrl}/api/health`);
    assert.equal(res.status, 200);
  });

  it("no response ever carries the wildcard (AC23)", async () => {
    for (const [p, h] of [
      ["/api/health", {}],
      ["/api/state", { Origin: ALLOWED }],
      ["/api/state", { Origin: EVIL }],
    ] as const) {
      const res = await fetch(`${host.baseUrl}${p}`, { headers: h as HeadersInit });
      assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
    }
  });
});
