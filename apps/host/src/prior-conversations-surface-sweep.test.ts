/**
 * AC12h (SPEC.md §3, §2.8 property 4; INTERFACE_CONTRACT.md "Which surfaces carry it") — the
 * host-level wire sweep behind N-8: read live against one running engine, EVERY response the app
 * repaints its engine state from carries `priorConversations`, attributed to that request's own
 * origin, and equal to what `GET /api/state` reports for that same origin in that same session.
 *
 * The endpoint list is NOT hardcoded here. It is parsed out of INTERFACE_CONTRACT.md's own
 * "Which surfaces carry it" table (the `yes`-carrying HTTP rows) at test-run time, so a ninth
 * endpoint that a future lane names in the interface file is picked up by this sweep automatically
 * instead of silently falling outside a list this test would otherwise have restated (the exact
 * failure shape N-8 demonstrated: "stamping only today's seven endpoints is a list an eighth
 * re-opens" — SPEC.md §2.8 "The fix binds both sides"). An endpoint the oracle finds that this file
 * has no request payload for fails LOUDLY (`no payload registered for <method> <path>`) rather than
 * being silently skipped, which is what keeps the oracle honest: it forces the payload map below to
 * be updated in the same change that adds a surface to the contract, instead of letting the sweep
 * quietly stop covering it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { startHost, type StartedHost } from "./test-support/host-process.js";
import { ALLOWED_ORIGINS } from "./allowed-origins.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(
  here,
  "../../..",
  ".spire/clusters/tech/contracts/desktop-self-host/INTERFACE_CONTRACT.md",
);
const ALLOWED = ALLOWED_ORIGINS[0]; // http://tauri.localhost in both channel variants

/**
 * Parses the "Which surfaces carry it" table out of INTERFACE_CONTRACT.md and returns every
 * `METHOD /api/...` surface whose "Carries the field" column reads `yes`. The socket surface
 * ("`state` frames on `ws://...`") and the open-ended "any later response..." row intentionally
 * produce no HTTP matches — they are not requests this sweep can drive directly.
 */
function readsStateSurfacesFromContract(): string[] {
  const text = fs.readFileSync(CONTRACT_PATH, "utf8");
  const headingIdx = text.indexOf("### Which surfaces carry it");
  assert.ok(headingIdx >= 0, "INTERFACE_CONTRACT.md must have a 'Which surfaces carry it' section");
  const rest = text.slice(headingIdx);
  const nextHeadingIdx = rest.slice(1).search(/\n##\s/);
  const section = nextHeadingIdx >= 0 ? rest.slice(0, nextHeadingIdx + 1) : rest;

  const surfaces = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // `| Surface | Carries the field | Note |` -> cells = ["", Surface, Carries, Note, ""]
    if (cells.length < 4) continue;
    const carries = cells[2] ?? "";
    if (!/^yes\b/.test(carries)) continue;
    const surfaceCell = cells[1] ?? "";
    const matches = surfaceCell.matchAll(/`(GET|POST) (\/api\/[a-zA-Z0-9\-/]*)`/g);
    for (const m of matches) surfaces.add(`${m[1]} ${m[2]}`);
  }
  assert.ok(
    surfaces.size > 0,
    "no `METHOD /api/...` surfaces parsed out of INTERFACE_CONTRACT.md — the table shape changed " +
      "under this oracle; fix the parser, do not hand-restate the list",
  );
  return [...surfaces];
}

/**
 * Minimal request payload per known state-returning surface — deliberately separate from the
 * enumeration above. If the contract names a surface this map does not cover, the test fails with
 * a named gap instead of silently not exercising it (see file header).
 */
function payloadFor(surface: string): { body?: unknown } {
  switch (surface) {
    case "GET /api/state":
      return {};
    case "POST /api/mode":
      return { body: { mode: "chat" } };
    case "POST /api/workspace":
      return { body: { path: os.tmpdir() } };
    case "POST /api/settings":
      return { body: {} };
    case "POST /api/effort":
      return { body: { effort: "auto" } };
    case "POST /api/chat-root":
      return { body: {} };
    case "POST /api/restart":
      return { body: {} };
    case "POST /api/oauth/logout":
      return { body: {} };
    default:
      throw new Error(
        `no payload registered for "${surface}" — INTERFACE_CONTRACT.md names a state-returning ` +
          `surface this test's payload map does not cover yet; add one`,
      );
  }
}

async function call(
  host: StartedHost,
  surface: string,
  origin: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const [method, urlPath] = surface.split(" ", 2);
  const { body } = payloadFor(surface);
  const res = await fetch(`${host.baseUrl}${urlPath}`, {
    method,
    headers: {
      Origin: origin,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

let host: StartedHost;

before(async () => {
  host = await startHost({ port: 8936 });
  // Seed a completed conversation for the allowed origin so `priorConversations` reads `true` on
  // this engine — a builder that hardcodes `false` (or that isn't wired at all, returning
  // `undefined`) must not accidentally match a `false` baseline. Same store shape/location as
  // shell-history.ts / prior-conversations.test.ts.
  const store = {
    version: 1,
    shells: { [ALLOWED]: { conversations: 1, firstAt: 1, lastAt: 1 } },
  };
  fs.mkdirSync(path.join(host.homeDir, ".grokforge-dev"), { recursive: true });
  fs.writeFileSync(
    path.join(host.homeDir, ".grokforge-dev", "shells.json"),
    JSON.stringify(store),
    "utf8",
  );
});

after(async () => {
  await host.stop();
});

describe("AC12h — every state-returning surface named in INTERFACE_CONTRACT.md carries priorConversations", () => {
  it("enumerates at least GET /api/state and the seven N-8 POSTs from the contract file itself", () => {
    const surfaces = readsStateSurfacesFromContract();
    for (const expected of [
      "GET /api/state",
      "POST /api/mode",
      "POST /api/workspace",
      "POST /api/settings",
      "POST /api/effort",
      "POST /api/chat-root",
      "POST /api/restart",
      "POST /api/oauth/logout",
    ]) {
      assert.ok(surfaces.includes(expected), `oracle did not find "${expected}" in the contract table`);
    }
  });

  it("every enumerated surface returns 200 with priorConversations equal to GET /api/state, for the requesting origin", async () => {
    const surfaces = readsStateSurfacesFromContract();
    for (const surface of surfaces) {
      const { status, body } = await call(host, surface, ALLOWED);
      assert.equal(status, 200, `${surface} did not answer 200 (got ${status}): ${JSON.stringify(body)}`);
      assert.ok(
        "priorConversations" in body,
        `${surface} response is missing priorConversations entirely: ${JSON.stringify(Object.keys(body))}`,
      );
      assert.equal(
        typeof body.priorConversations,
        "boolean",
        `${surface} priorConversations is not boolean-typed`,
      );

      const reference = await fetch(`${host.baseUrl}/api/state`, {
        headers: { Origin: ALLOWED },
      });
      const referenceBody = (await reference.json()) as Record<string, unknown>;

      assert.equal(
        body.priorConversations,
        referenceBody.priorConversations,
        `${surface} priorConversations (${body.priorConversations}) does not equal ` +
          `GET /api/state's (${referenceBody.priorConversations}) for the same origin`,
      );
      // Pinned expectation, not just internal self-consistency: on this seeded engine the value
      // must be true, so a builder that always answers `false` (e.g. one that forgot to read the
      // store) cannot pass by both sides coincidentally agreeing on the wrong constant.
      assert.equal(body.priorConversations, true, `${surface} priorConversations should be true`);
    }
  });

  it("a foreign/header-less caller never inherits another origin's value (per-requester, not global)", async () => {
    const res = await fetch(`${host.baseUrl}/api/state`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.priorConversations, false, "header-less GET /api/state must read false");
  });
});
