/**
 * Request-level admission rules for the host HTTP/WS surface (GATE Z amendment, 2026-08-12).
 * SPEC §8 "host-origin-locked" / INTERFACE_CONTRACT.md "Request lockdown". Not authentication —
 * closes the browser path only (full host auth is a deferred, separate feature).
 *
 * Pure decision functions only — no Node http types here — so the rules are unit-testable without
 * standing up a server, and `index.ts` (the only caller) stays the single place that turns a
 * decision into a response.
 */

/**
 * The allowlist is a COMPILE-TIME constant, selected per build channel at packaging time by
 * scripts/gen-allowed-origins.mjs, which copies `allowed-origins.prod.ts` or `allowed-origins.dev.ts`
 * over the generated `./allowed-origins.ts`. That generated file is gitignored and absent by
 * default, so a skipped copy fails the build with a missing module instead of silently shipping the
 * dev list under the prod name (SPEC §2.7 rule 4).
 *
 * It is deliberately NOT keyed on the runtime channel resolver (the helper that reads the
 * `GROKFORGE_CHANNEL` environment variable at request time): a runtime override of that variable on
 * a prod install would otherwise yield the dev allowlist and reopen rule 2 through the back door.
 * No env var, config.json field, data file or argv may extend this list.
 */
export { ALLOWED_ORIGINS } from "./allowed-origins.js";
import { ALLOWED_ORIGINS } from "./allowed-origins.js";

/**
 * A request's `Origin` is acceptable when it is absent (loopback CLI tooling, the conformance
 * runner, and same-process callers never send one — a browser always attaches `Origin` cross-
 * origin) or when it is exactly one of the shell's own origins. Anything else — including a
 * near-miss like a trailing slash or a different port — is refused.
 */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (origin == null || origin === "") return true;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * `content-type: application/json` (optionally with a `; charset=...` suffix) is the only body
 * shape a route may parse. Case-insensitive on the media type per RFC 9110.
 */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const primary = contentType.split(";")[0]?.trim().toLowerCase();
  return primary === "application/json";
}

/**
 * True when the request is understood to carry a body worth content-type checking — a non-zero
 * `Content-Length`, or `Transfer-Encoding` (chunked bodies never send `Content-Length`). A bare
 * POST with no body (`/api/cancel`) reports false and is therefore unaffected by the JSON-only
 * rule, matching INTERFACE_CONTRACT.md's "Request lockdown" table.
 */
export function requestHasBody(headers: {
  "content-length"?: string | string[];
  "transfer-encoding"?: string | string[];
}): boolean {
  if (headers["transfer-encoding"]) return true;
  const raw = headers["content-length"];
  const len = Array.isArray(raw) ? raw[0] : raw;
  if (len == null) return false;
  const n = Number(len);
  return Number.isFinite(n) && n > 0;
}
