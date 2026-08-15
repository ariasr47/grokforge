/**
 * Host-level replay tests for the GATE Z lockdown (SPEC §8 "host-origin-locked", AC13-AC17).
 *
 * `request-lockdown.test.ts` covers the pure predicates (`isOriginAllowed`, `isJsonContentType`,
 * `requestHasBody`) in isolation; this file replays the same forged shapes against the *running*
 * host (`index.ts`), because a predicate that is correct but never wired in — or wired in and later
 * deleted — leaves those unit tests green. Per QA_REPORT.md's bounce yardstick: deleting the
 * lockdown block from `index.ts`, or restoring `ACAO: *` in `sendJson`, must fail these tests.
 *
 * One host boots for the whole file — every scenario below is a *refusal* path (403/415/400/404),
 * so nothing here mutates host state across tests.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startHost, type StartedHost } from "./test-support/host-process.js";
import { hasWildcardCors, rawRequest, type RawResponse } from "./test-support/raw-http.js";
import { ALLOWED_ORIGINS } from "./allowed-origins.js";

const PORT = 8793;
const EVIL_ORIGIN = "https://evil.example";
// Deliberately read from the generated allowlist rather than hard-coding a dev origin: the
// allowlist is channel-generated at test-run time (SPEC §2.7 rule 4 / desktop-self-host B1), and
// ALLOWED_ORIGINS[0] is the packaged origin in every channel variant.
const ALLOWED_ORIGIN = ALLOWED_ORIGINS[0];

let host: StartedHost;
/** Every response observed in this file — asserted at the end to never carry the `*` wildcard. */
const allResponses: RawResponse[] = [];

async function req(
  method: string,
  path: string,
  opts: { headers?: Record<string, string | string[]>; body?: string } = {},
): Promise<RawResponse> {
  const res = await rawRequest(host.baseUrl, method, path, opts);
  allResponses.push(res);
  return res;
}

async function stateNoOrigin(): Promise<Record<string, unknown>> {
  const res = await req("GET", "/api/state");
  assert.equal(res.status, 200, "GET /api/state (loopback, no Origin) must succeed");
  return JSON.parse(res.body) as Record<string, unknown>;
}

before(async () => {
  host = await startHost({ port: PORT });
});

after(async () => {
  await host.stop();
  // AC13: across every response this file observed, the wildcard must never appear.
  for (const res of allResponses) {
    assert.equal(
      hasWildcardCors(res),
      false,
      `response carried Access-Control-Allow-Origin: * (status ${res.status})`,
    );
  }
});

describe("AC13 — foreign-origin preflight refused, no wildcard ever", () => {
  it("OPTIONS with a foreign Origin on /api/chat-root answers 403, no ACAO for that origin", async () => {
    const res = await req("OPTIONS", "/api/chat-root", {
      headers: { Origin: EVIL_ORIGIN },
    });
    assert.equal(res.status, 403);
    assert.notEqual(res.headers["access-control-allow-origin"], EVIL_ORIGIN);
  });

  it("OPTIONS with a foreign Origin on /api/state answers 403 too (every /api/* route)", async () => {
    const res = await req("OPTIONS", "/api/state", { headers: { Origin: EVIL_ORIGIN } });
    assert.equal(res.status, 403);
  });

  it("a legitimate shell origin still gets a 204 preflight (allow side intact)", async () => {
    const res = await req("OPTIONS", "/api/state", { headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
  });

  it("an origin-less request succeeds — the deliberate loopback carve-out", async () => {
    const res = await req("GET", "/api/health");
    assert.equal(res.status, 200);
  });
});

describe("AC14 — foreign-origin actual request refused with no state change", () => {
  it("POST /api/chat-root with a foreign Origin is refused and chatRoot does not move", async () => {
    const before_ = await stateNoOrigin();
    const res = await req("POST", "/api/chat-root", {
      headers: { Origin: EVIL_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ path: null }),
    });
    assert.equal(res.status, 403);
    const after_ = await stateNoOrigin();
    assert.equal(after_.chatRoot, before_.chatRoot);
  });

  it("GET /api/workspace/read with a foreign Origin is refused with no file bytes", async () => {
    const res = await req("GET", "/api/workspace/read?path=README.md", {
      headers: { Origin: EVIL_ORIGIN },
    });
    assert.equal(res.status, 403);
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    assert.equal("content" in parsed, false, "refusal body must not carry file content");
  });

  it("forged-origin shapes are each refused (null, trailing slash, suffix domain, case variation)", async () => {
    const shapes = [
      "null",
      "http://localhost:5173/",
      "http://localhost:5173.evil.example",
      "HTTP://LOCALHOST:5173",
    ];
    for (const origin of shapes) {
      const res = await req("GET", "/api/state", { headers: { Origin: origin } });
      assert.equal(res.status, 403, `origin shape "${origin}" should be refused`);
      assert.notEqual(
        res.headers["access-control-allow-origin"],
        origin,
        `origin shape "${origin}" must not be reflected back`,
      );
    }
  });

  it("a duplicated Origin header (allowed + evil) is refused, not allowed-through", async () => {
    const res = await req("GET", "/api/state", {
      headers: { Origin: [ALLOWED_ORIGIN, EVIL_ORIGIN] },
    });
    assert.equal(res.status, 403);
  });
});

describe("AC15 — non-JSON body refused, host state unmoved", () => {
  it("POST /api/effort with content-type text/plain returns 415 and effort is unchanged", async () => {
    const before_ = await stateNoOrigin();
    const res = await req("POST", "/api/effort", {
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ effort: "heavy" }),
    });
    assert.equal(res.status, 415);
    const after_ = await stateNoOrigin();
    assert.equal(after_.effort, before_.effort);
    // Sanity: the value we tried to smuggle in never took hold.
    assert.notEqual(after_.effort, "heavy");
  });

  it("a bodyless POST (/api/cancel) is unaffected by the JSON-only rule", async () => {
    const res = await req("POST", "/api/cancel");
    assert.equal(res.status, 200);
  });
});

describe("AC16 — relative chat root refused, chatRoot unmoved", () => {
  it("rejects several non-absolute path shapes with 400 and leaves chatRoot untouched", async () => {
    const before_ = await stateNoOrigin();
    const shapes = ["src", "notes/sub", "../parent", ".\\rel", "relative-folder"];
    for (const p of shapes) {
      const res = await req("POST", "/api/chat-root", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      assert.equal(res.status, 400, `relative path "${p}" should be refused`);
      const after_ = await stateNoOrigin();
      assert.equal(after_.chatRoot, before_.chatRoot, `chatRoot moved after "${p}"`);
    }
  });
});

describe("AC17 — host no longer serves POST /api/prefetch-mode", () => {
  // SPEC §3 AC17 / §1 name only the POST route as removed ("the POST /api/prefetch-mode route
  // built for this feature ... is REMOVED"). GET on an unmatched path is deliberately NOT asserted
  // 404 here: index.ts's unmatched-GET branch falls through to serving the built shell's
  // index.html (SPA client-routing fallback, pre-existing and unrelated to this feature) whenever
  // apps/shell/dist exists, so a bare "GET is 404" assertion would depend on build state rather
  // than on whether the prefetch route itself was re-added.
  it("POST /api/prefetch-mode is absent (404) — a re-added route must not silently pass", async () => {
    const res = await req("POST", "/api/prefetch-mode", {
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 404);
  });
});
