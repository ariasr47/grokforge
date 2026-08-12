#!/usr/bin/env node
// interface_conformance.mjs — runtime FE↔BE conformance check (system-1).
//
// Proves the dangerous unguarded seam: the live backend EMITS the fields the INTERFACE_CONTRACT
// promises (= the fields the frontend CONSUMES, since the FE binds to the same interface).
// Integration stops being *asserted* and becomes *verified*.
//
// How it works: each `INTERFACE_CONTRACT.md` carries a machine-checkable **conformance spec** — a
// fenced ```json block under a "## Conformance spec" heading — listing each endpoint + the required
// field paths (name · type · presence). This tool hits the live endpoint (or a captured sample) and
// validates the emitted JSON against that spec. The interface stays the single source of truth;
// this just makes it executable.
//
// Usage:
//     # live: boot the backend yourself (see project.json `backend.serve_cmd`), then —
//     node .grok/tools/interface_conformance.mjs --contract .spire/clusters/tech/contracts/{F}/INTERFACE_CONTRACT.md --url <backend-base-url>
//     # or a standalone spec file:
//     node .grok/tools/interface_conformance.mjs --spec .spire/clusters/tech/state/conformance/<feature>.json --url <backend-base-url>
//     # offline: validate a captured response against one endpoint (CI / no server):
//     node .grok/tools/interface_conformance.mjs --spec SPEC.json --sample resp.json --endpoint /api/example
//     # receipt: write a machine-readable verdict alongside the human output (any mode):
//     node .grok/tools/interface_conformance.mjs --contract … --url … --report .spire/clusters/tech/contracts/{F}/conformance-receipt.json
//     # auth: an endpoint the spec marks "auth": true needs a session — replay one you already have
//     # (live mode only; --sample never sends a request, so a session has nothing to be replayed on):
//     node .grok/tools/interface_conformance.mjs --spec SPEC.json --url <base> --auth-cookie NAME=VALUE
//     # or let the tool bootstrap a throwaway one via project.json `conformance.auth.signup_path` +
//     # `signup_body` (each {{unique}} in signup_body becomes one random token per run):
//     node .grok/tools/interface_conformance.mjs --spec SPEC.json --url <base> --auth-signup
//     # override: project.json `conformance.command` delegates the whole run to a consumer-owned
//     # runner (protocols this tool doesn't cover — bearer tokens, OAuth, CSRF, GraphQL, gRPC). The
//     # kit still validates whatever receipt lands at --report; the runner itself is not verified.
//
// Spec schema (JSON):
//     {"endpoints": [{
//        "method": "GET", "path": "/api/example/{id}", "auth": true,
//        "path_params": {"id": "abc"}, "query": {"limit": 7},
//        "required": { "<dot.path>": "<typespec>", ... }
//     }]}
// Type specs: number | string | boolean | object | array | null ; unions "object|null"; trailing "?"
// = optional (absent ⇒ pass, present ⇒ must match). A path segment "name[]" means "the value at name
// is an array — apply the rest of the path to EACH element" (empty array ⇒ vacuously passes). `auth`
// (default false; anything not clearly false counts as needing a session) marks an endpoint that only
// receives the session cookie — never sent to an endpoint that doesn't ask for one.
//
// Receipt (--report): a JSON object {tool, verdict, mode, source, base_url, auth, checked_at, summary,
// endpoints}. `verdict` is PASS (live, all pass) | FAIL (any failure, either mode) | UNVERIFIABLE
// (sample, all pass — a captured response proves the shape at capture time, not that the live
// backend emits it now). `auth` is the session method actually replayed on at least one request —
// "cookie" | "signup" | null — never the credential itself; a flag supplied but never attached to a
// request (e.g. --sample, or a live spec with no `auth`-marked endpoint) records null. The flag never
// changes stdout or the exit code.
//
// Exit: 1 if any endpoint FAILs (missing field / type mismatch / non-200 / unreachable). 2 if the run
// could not be performed at all — bad/missing args, an unparseable spec or contract, neither --url nor
// --sample, a spec endpoint marked `auth` with no session supplied, --auth-signup with no (or
// malformed) `conformance.auth`, --auth-signup combined with --sample, or — under a `conformance.command`
// override — the delegated command failing to start, or writing a receipt that fails its own schema.
// Else 0. Node builtins only (node:fs / node:util / global fetch).

import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pyRepr, pyJsonDumps } from './_pyfmt.mjs';
import { validateReceipt } from './_receipt.mjs';
import { projectConfig } from './_project.mjs';

// §3.1: every regex lives at module scope so no call site recompiles one per invocation.
// re.S | re.I on the Python side: `.` spans newlines (→ [\s\S]) and the heading match is
// case-insensitive. Non-global, so `.exec()` cannot leak lastIndex between calls.
const CONFORMANCE_BLOCK_RE = /##\s*Conformance spec[\s\S]*?```json\s*([\s\S]*?)```/i;
// Python's Path.read_text() opens in universal-newline mode: \r\n and lone \r both become \n.
const UNIVERSAL_NEWLINE_RE = /\r\n?/g;
// Python's str.rstrip("/") removes EVERY trailing slash, not just one.
const TRAILING_SLASHES_RE = /\/+$/;
// urllib.parse.quote/quote_plus escape these; encodeURIComponent leaves them literal.
const QUOTE_EXTRA_RE = /[!'()*]/g;
const PERCENT_SLASH_RE = /%2F/g;
const PERCENT_SPACE_RE = /%20/g;
// A cookie value carrying CR/LF (pasted from a multi-line source, or two cookies joined) makes undici
// throw with the FULL CREDENTIAL in its message; the per-endpoint catch around fetchEndpoint would
// then write it to stdout and into endpoints[].failures[] of a receipt that gets committed. This shape
// check runs before any request is ever made — see its two call sites below, one for --auth-cookie
// and one for the cookie --auth-signup bootstraps from Set-Cookie.
const COOKIE_RE = /^[^\s=;,]+=[\x21-\x3a\x3c-\x7e]*$/;

// argparse auto-generates its usage block from the parser; parseArgs does not. Spec §4.1 N4: these
// paths are compared by exit code only, and this line is the hand-written close equivalent.
const USAGE =
  'usage: interface_conformance.mjs (--contract C | --spec S) [--url U] [--sample F] [--endpoint P] [--report F] [--auth-cookie NAME=VALUE] [--auth-signup]';

// A Map (not an object literal) so a typespec like "constructor" cannot reach Object.prototype.
const TYPE_CHECKS = new Map([
  // Python excludes bool from `number` explicitly; JS has no bool/number overlap to exclude.
  ['number', (v) => typeof v === 'number'],
  ['string', (v) => typeof v === 'string'],
  ['boolean', (v) => typeof v === 'boolean'],
  ['object', (v) => v !== null && typeof v === 'object' && !Array.isArray(v)],
  ['array', (v) => Array.isArray(v)],
  ['null', (v) => v === null],
]);

// --- small Python-semantics shims (local: _pyfmt.mjs owns only output formatting) -----------

/** Python `isinstance(v, dict)` for JSON-parsed values. */
function isDict(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Python `str(v)` for JSON-parsed values — str passes through, everything else reprs. */
function pyStr(v) {
  return typeof v === 'string' ? v : pyRepr(v);
}

/** Python truthiness — empty list/dict/string are falsy in Python; {} and [] are truthy in JS. */
function pyTruthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Python `len(v)` for JSON-parsed values (dict keys / list items / str chars). */
function pyLen(v) {
  if (Array.isArray(v) || typeof v === 'string') return v.length;
  if (v !== null && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

/** Python `d.get(k, dflt)` without reaching Object.prototype for a colliding JSON key. */
function pyGet(obj, key, dflt) {
  return isDict(obj) && Object.hasOwn(obj, key) ? obj[key] : dflt;
}

/** Python's Path.read_text(encoding="utf-8"): decode UTF-8 + universal newlines. */
function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(UNIVERSAL_NEWLINE_RE, '\n');
}

/** Python `str(e)` for an exception — the message, no class name. */
function pyErrStr(e) {
  return e && typeof e.message === 'string' ? e.message : String(e);
}

// `shell: true` with a separate args array makes Node concatenate them WITHOUT escaping (its own
// DEP0190), so a path containing a space — C:\Program Files\…, a OneDrive folder, any username with
// one — silently splits into extra tokens and the consumer's tool runs with mangled arguments, failing
// in a way that looks nothing like its cause. Build one quoted string instead; that also retires the
// deprecation warning this combination prints on every run.
export function shellQuote(arg) {
  const s = String(arg);
  if (process.platform === 'win32') {
    // A run of backslashes immediately before the closing quote is consumed as an escape by Windows'
    // CommandLineToArgvW, so the quote is swallowed and the argument runs into the next one. Doubling
    // the run makes each backslash literal and leaves the quote doing its job.
    return `"${s.replace(/(\\+)$/, '$1$1').replaceAll('"', '""')}"`;
  }
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/** urllib.parse.quote(s) — default safe="/". encodeURIComponent leaves !'()* literal and escapes
 *  "/", so both differences have to be undone to land on Python's byte-for-byte output. */
function pyQuote(s) {
  return encodeURIComponent(s)
    .replace(QUOTE_EXTRA_RE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(PERCENT_SLASH_RE, '/');
}

/** urllib.parse.urlencode(d) — quote_plus (safe="", space → "+") on str(k)/str(v), joined by "&". */
function pyUrlencode(d) {
  const quotePlus = (s) =>
    encodeURIComponent(s)
      .replace(QUOTE_EXTRA_RE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
      .replace(PERCENT_SPACE_RE, '+');
  return Object.entries(d)
    .map(([k, v]) => `${quotePlus(pyStr(k))}=${quotePlus(pyStr(v))}`)
    .join('&');
}

/** json.dumps(obj) with no indent — Python's default separators are ", " and ": " (JSON.stringify
 *  emits neither space), and ensure_ascii=True escapes every non-ASCII codepoint. Request bodies go
 *  on the wire, so the bytes have to match what urllib would have sent. */
function pyJsonCompact(v) {
  if (Array.isArray(v)) return `[${v.map(pyJsonCompact).join(', ')}]`;
  if (v !== null && typeof v === 'object') {
    // pyJsonDumps() on a bare string gives json.dumps's quoted, ensure_ascii-escaped form.
    return `{${Object.entries(v).map(([k, x]) => `${pyJsonDumps(k)}: ${pyJsonCompact(x)}`).join(', ')}}`;
  }
  return pyJsonDumps(v);
}

// --- the port, function-for-function in source order ----------------------------------------

export function typeOk(value, typespec) {
  for (const t of typespec.split('|')) {
    const check = TYPE_CHECKS.get(t.trim());
    if (check !== undefined && check(value)) return true;
  }
  return false;
}

export class Fail extends Error {}

/** Resolve a dot-path (with name[] array fan-out) and type-check the leaf(s). */
export function checkPath(obj, path, typespec, failures) {
  const optional = typespec.endsWith('?');
  const tspec = optional ? typespec.slice(0, -1) : typespec;
  const segs = path.split('.');
  walk(obj, segs, tspec, optional, path, failures);
}

function walk(node, segs, tspec, optional, full, failures) {
  if (segs.length === 0) {
    if (!typeOk(node, tspec)) {
      // Python's `{node!r:.40}` is format(repr(node), '.40') — the repr, truncated to 40 chars.
      failures.push(`${full}: expected ${tspec}, got ${typename(node)} (${pyRepr(node).slice(0, 40)})`);
    }
    return;
  }
  const seg = segs[0];
  const rest = segs.slice(1);
  const fan = seg.endsWith('[]');
  const key = fan ? seg.slice(0, -2) : seg;
  if (!isDict(node) || !Object.hasOwn(node, key)) {
    if (!optional) failures.push(`${full}: missing field (no '${key}')`);
    return;
  }
  const val = node[key];
  if (fan) {
    if (!Array.isArray(val)) {
      failures.push(`${full}: expected array at '${key}', got ${typename(val)}`);
      return;
    }
    for (const el of val) walk(el, rest, tspec, optional, full, failures); // empty list ⇒ vacuously passes
  } else {
    walk(val, rest, tspec, optional, full, failures);
  }
}

function typename(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  return 'object';
}

export function extractSpecFromContract(text) {
  const m = CONFORMANCE_BLOCK_RE.exec(text);
  if (m === null) throw new Fail("no '## Conformance spec' ```json block found in the contract");
  return JSON.parse(m[1]);
}

// Does this endpoint sit behind a session? Conformance specs are consumer-authored JSON, so `auth`
// arrives as true, "true" or 1 depending on who wrote it. Anything not CLEARLY false counts as
// needing a session, deliberately: demanding a credential that was not required is a loud exit 2 an
// operator can correct in seconds, whereas missing one produces a bare 401 that reads as a broken
// endpoint and bounces GATE Q to the wrong lane entirely.
export function needsSession(ep) {
  const v = pyGet(ep, 'auth', false);
  if (v === false || v === 0 || v === null || v === undefined) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s !== '' && s !== 'false' && s !== '0';
  }
  return Boolean(v);
}

/** urllib fetch → global fetch. Same URL construction, same 30s timeout, same non-200 → Fail. */
async function fetchEndpoint(base, ep, cookie = null) {
  let epPath = ep.path;
  for (const [k, v] of Object.entries(pyGet(ep, 'path_params', {}))) {
    epPath = epPath.replaceAll(`{${k}}`, pyQuote(pyStr(v)));
  }
  let url = base.replace(TRAILING_SLASHES_RE, '') + epPath;
  if (pyTruthy(pyGet(ep, 'query', undefined))) url += `?${pyUrlencode(ep.query)}`;
  // Optional JSON request body (for POST/PUT endpoints). Absent ⇒ no body (GET semantics
  // unchanged), so this is fully backward-compatible with every existing flat spec.
  let data = null;
  const headers = {};
  // Only endpoints the spec marks `"auth": true` receive the session. Sending it everywhere would
  // make an anonymous endpoint's 200 prove nothing about its anonymous behaviour.
  if (cookie && needsSession(ep)) headers.Cookie = cookie;
  if (pyGet(ep, 'body', null) !== null) {
    data = pyJsonCompact(ep.body);
    headers['Content-Type'] = 'application/json';
  }
  // urlopen raises HTTPError (a URLError) for >=400 before Python reaches its own status check;
  // fetch resolves instead, so the check below is what turns a 500 into the same FAIL branch.
  // The message text differs ("HTTP 500" vs "HTTP Error 500: …") — spec §4.1 N6 covers exactly that.
  const resp = await fetch(url, {
    method: pyGet(ep, 'method', 'GET'),
    body: data,
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (resp.status !== 200) throw new Fail(`HTTP ${resp.status}`);
  return JSON.parse(await resp.text());
}

export function validateEndpoint(ep, payload) {
  const failures = [];
  for (const [p, tspec] of Object.entries(pyGet(ep, 'required', {}))) {
    checkPath(payload, p, tspec, failures);
  }
  return failures;
}

/** Replace every `{{unique}}` in every string, recursively, with one per-run token. */
export function substituteUnique(value, token) {
  if (typeof value === 'string') return value.replaceAll('{{unique}}', token);
  if (Array.isArray(value)) return value.map((v) => substituteUnique(v, token));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteUnique(v, token)]));
  }
  return value;
}

// Bootstrap a throwaway session and return its `name=value` cookie, or throw.
//
// The Set-Cookie header is parsed by hand rather than through a cookie jar, deliberately: a jar
// honors the cookie's `Secure` attribute and would refuse to replay it over the local http base that
// every gate run uses. Field-proven on a real consumer before promotion.
async function bootstrapSession(base, authCfg) {
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  const body = substituteUnique(authCfg.signup_body, token);
  const url = base.replace(TRAILING_SLASHES_RE, '') + authCfg.signup_path;
  const resp = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (resp.status >= 400) throw new Error(`signup POST ${authCfg.signup_path} returned HTTP ${resp.status}`);
  const raw = resp.headers.getSetCookie?.()[0] ?? resp.headers.get('set-cookie');
  if (!raw) throw new Error(`signup POST ${authCfg.signup_path} returned no Set-Cookie header`);
  return raw.split(';')[0].trim();
}

// The documented contract (this file's own header, "Exit:") is 0 | 1 | 2 — never anything else. A
// `conformance.command` override is a consumer-owned process the kit does not control, so its exit
// code is not part of that contract and must be translated into it, not passed through: a runner
// exiting 3 would otherwise make THIS gate exit 3, which nothing downstream (GATE Q, gates.mjs) knows
// how to interpret. `status === null` means the child was killed by a signal rather than exiting
// normally — treated as "could not be run", exit 2, the same bucket every other setup failure in this
// file falls into.
function normalizeChildExit(status) {
  if (status === null) return 2;
  return status === 0 ? 0 : 1;
}

export async function main(argv) {
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv.slice(1),
      options: {
        contract: { type: 'string' },
        spec: { type: 'string' },
        url: { type: 'string' },
        sample: { type: 'string' },
        endpoint: { type: 'string' },
        report: { type: 'string' },
        'auth-cookie': { type: 'string' },
        'auth-signup': { type: 'boolean' },
      },
      strict: true,
    }));
  } catch {
    console.error(USAGE);
    return 2;
  }
  // argparse's mutually-exclusive group with required=True: exactly one of --contract / --spec.
  if (Boolean(args.contract) === Boolean(args.spec)) {
    console.error(USAGE);
    return 2;
  }

  // A consumer whose protocol this runner does not cover points `conformance.command` at its own
  // tool (spec §2.4). The kit still validates the RECEIPT — that, not the runner, is what it
  // guarantees. Lives here rather than in gates.mjs, which routes only: any behaviour difference
  // between `gates.mjs <tool> ARGS` and `node <tool>.mjs ARGS` is by its own header a bug there.
  const override = pyGet(pyGet(projectConfig(), 'conformance', {}), 'command', null);
  if (typeof override === 'string' && override !== '') {
    const forwarded = argv.slice(1);
    // A receipt left over from an earlier run must not be mistaken for THIS run's output — without
    // this, a runner that exits 0 having written nothing at all validates whatever stale file already
    // sat at --report, which defeats the guarantee twice over: the artifact wasn't produced by the
    // run being gated, and GATE Q's "two independent runs" comparison then matches two stale verdicts.
    // Removing it first means an absent file after spawnSync falls straight into the existing "wrote
    // no readable receipt" branch below.
    if (args.report) {
      // { force: true } suppresses only ENOENT; a DIRECTORY at --report (e.g. a consumer pointed it at
      // a folder by mistake) throws ERR_FS_EISDIR, which — unhandled — would exit the process 1 with a
      // raw stack trace instead of the clean "cannot run" exit 2 every other configuration error in
      // this file gets.
      try {
        fs.rmSync(args.report, { force: true });
      } catch (e) {
        console.log(`could not clear ${args.report}: ${pyErrStr(e)}`);
        return 2;
      }
    }
    // Do not quote `override` itself — it is a command line the consumer wrote and may legitimately
    // carry its own arguments and quoting. Only the forwarded arguments are quoted.
    const commandLine = [override, ...forwarded.map(shellQuote)].join(' ');
    const r = spawnSync(commandLine, { shell: true, encoding: 'utf8', stdio: 'inherit' });
    if (r.error) {
      console.log(`conformance.command failed to start: ${pyErrStr(r.error)}`);
      return 2;
    }
    if (!args.report) return normalizeChildExit(r.status);
    let produced;
    try {
      produced = JSON.parse(fs.readFileSync(args.report, 'utf8'));
    } catch (e) {
      console.log(`conformance.command wrote no readable receipt at ${args.report}: ${pyErrStr(e)}`);
      return 2;
    }
    const problems = validateReceipt(produced);
    if (problems.length) {
      console.log(`conformance.command wrote an invalid receipt — ${problems.join('; ')}`);
      return 2;
    }
    // The receipt's verdict is authoritative at GATE Q (ORCHESTRATOR.md:303-305) — a child that exits
    // 0 while its own receipt says FAIL must not make this gate say PASS, and a child that exits some
    // non-contract code (e.g. 3) while its receipt says PASS must still land on a contract exit code.
    if (produced.verdict === 'FAIL') return 1;
    return normalizeChildExit(r.status);
  }

  let spec;
  try {
    if (args.contract) {
      spec = extractSpecFromContract(readText(args.contract));
    } else {
      spec = JSON.parse(readText(args.spec));
    }
  } catch (e) {
    console.log(`spec error: ${pyErrStr(e)}`);
    return 2;
  }

  const endpoints = pyGet(spec, 'endpoints', []);
  if (!pyTruthy(endpoints)) {
    console.log('spec has no endpoints');
    return 2;
  }

  // A spec that needs a session, run without one, is a CONFIGURATION error — exit 2, no receipt.
  // Recording it as FAIL would bounce GATE Q to the backend lane to hunt a bug that does not exist:
  // bare 401/403 reads as "these endpoints are broken", not "the runner cannot authenticate."
  const needsAuth = endpoints.some((ep) => needsSession(ep));
  let cookie = args['auth-cookie'] ?? null;
  // Reject the shape up front, and deliberately do NOT print the offending value — the whole point is
  // that a malformed cookie never appears in stdout or a receipt (see COOKIE_RE's comment above).
  if (cookie !== null && !COOKIE_RE.test(cookie)) {
    console.log('--auth-cookie must be NAME=VALUE with no spaces or control characters');
    return 2;
  }
  // The method a session WOULD be recorded under, if it ends up actually attached to a request. Not
  // yet the receipt's `auth` field — see cookieUsed below, which decides that.
  let authAttempted = cookie ? 'cookie' : null;
  // No endpoint asks for a session ⇒ a bootstrapped one would never be attached to any request — the
  // signup POST that creates it is then a real side effect (a throwaway account on a live/staging
  // backend) in exchange for nothing. Same "no pointless side effect" principle as the --sample guard
  // just below.
  if (args['auth-signup'] && needsAuth) {
    // --sample is fully offline (this tool's own header calls it "CI / no server") and the sample
    // branch below never calls fetchEndpoint at all, so a bootstrapped session could only ever be
    // discarded unused — meaning the signup POST it takes to get one is a real side effect (a
    // throwaway account created on a live/staging backend) in exchange for nothing. Refuse instead of
    // silently ignoring one of the two flags.
    if (args.sample) {
      console.log('--auth-signup cannot be combined with --sample: offline mode makes no HTTP');
      console.log('  requests, so a bootstrapped session would have nothing to be replayed against.');
      return 2;
    }
    const authCfg = pyGet(pyGet(projectConfig(), 'conformance', {}), 'auth', null);
    const signupPath = authCfg === null ? undefined : authCfg.signup_path;
    if (authCfg === null || typeof signupPath !== 'string' || !signupPath.startsWith('/') || authCfg.signup_body === undefined) {
      console.log('--auth-signup needs `conformance.auth` in .spire/clusters/tech/project.json, with `signup_path`');
      console.log('  a string starting with "/" (the scaffolded template ships a placeholder) —');
      console.log('  { "conformance": { "auth": { "signup_path": "/…", "signup_body": { … } } } }');
      return 2;
    }
    if (!args.url) {
      console.log('--auth-signup needs --url (there is nothing to sign up against offline)');
      return 2;
    }
    try {
      cookie = await bootstrapSession(args.url, authCfg);
    } catch (e) {
      console.log(`could not bootstrap a session: ${pyErrStr(e)}`);
      return 2;
    }
    // Same discipline as --auth-cookie above: whatever the backend sent back in Set-Cookie could in
    // principle carry a shape undici's fetch rejects when it is later attached as a header, and the
    // per-endpoint catch would leak it exactly the same way. Never print the value.
    if (!COOKIE_RE.test(cookie)) {
      console.log('bootstrapped session cookie is not NAME=VALUE with no spaces or control characters');
      return 2;
    }
    authAttempted = 'signup';
  }
  if (needsAuth && authAttempted === null && !args.sample) {
    // Named, not generic: needsSession is deliberately fail-safe (a typo like "auth": "no" still
    // trips it), so a spec author needs to see exactly which endpoint(s) and stop guessing why.
    const offenders = endpoints.filter((ep) => needsSession(ep));
    console.log('spec marks endpoint(s) needing a session but no session was supplied:');
    for (const ep of offenders) {
      console.log(`  ${pyStr(pyGet(ep, 'method', 'GET'))} ${pyStr(ep.path)}`);
    }
    console.log('  pass --auth-cookie NAME=VALUE, or --auth-signup (see project.json `conformance.auth`)');
    return 2;
  }

  // Did a cookie actually get attached to at least one outgoing request? The receipt's `auth` field
  // records the method USED, not merely supplied — --sample never calls fetchEndpoint at all (so a
  // flag here would describe a credential that was never replayed), and a live spec with no
  // `auth`-marked endpoint never reaches the `cookie && needsSession(ep)` branch inside fetchEndpoint
  // either. Mirrors that same predicate so it flips exactly when fetchEndpoint would have attached
  // the header — regardless of whether the request that carried it then succeeded.
  let cookieUsed = false;

  const cases = [];
  if (args.sample) {
    // `e["path"]` on a path-less endpoint is a KeyError in Python; hasOwn keeps a missing key from
    // silently matching an absent --endpoint (undefined === undefined) here.
    const matched = endpoints.filter((e) => Object.hasOwn(e, 'path') && e.path === args.endpoint);
    const eps = matched.length ? matched : endpoints.slice(0, 1);
    const payload = JSON.parse(readText(args.sample));
    cases.push([eps[0], payload, null]);
  } else if (args.url) {
    for (const ep of endpoints) {
      if (cookie && needsSession(ep)) cookieUsed = true;
      try {
        cases.push([ep, await fetchEndpoint(args.url, ep, cookie), null]);
      } catch (e) {
        cases.push([ep, null, pyErrStr(e)]);
      }
    }
  } else {
    console.log('provide --url (live) or --sample (offline)');
    return 2;
  }

  let totalFail = 0;
  const results = [];
  console.log(`interface_conformance — ${cases.length} endpoint(s)`);
  for (const [ep, payload, err] of cases) {
    const label = `${pyStr(pyGet(ep, 'method', 'GET'))} ${pyStr(ep.path)}`;
    const entry = {
      method: pyGet(ep, 'method', 'GET'),
      path: ep.path,
      verdict: 'PASS',
      required_checked: pyLen(pyGet(ep, 'required', {})),
      failures: [],
    };
    if (err !== null) {
      console.log(`  FAIL  ${label}: unreachable/error — ${err}`);
      totalFail += 1;
      entry.verdict = 'FAIL';
      entry.required_checked = 0;
      entry.failures = [`unreachable/error — ${err}`];
      results.push(entry);
      continue;
    }
    const failures = validateEndpoint(ep, payload);
    if (failures.length) {
      totalFail += 1;
      console.log(`  FAIL  ${label} — ${failures.length} issue(s):`);
      for (const f of failures) console.log(`          - ${f}`);
      entry.verdict = 'FAIL';
      entry.failures = failures;
    } else {
      const n = pyLen(pyGet(ep, 'required', {}));
      console.log(`  PASS  ${label} — ${n} required field(s) present + well-typed`);
    }
    results.push(entry);
  }
  console.log(`\n  ${totalFail} endpoint failure(s).`);

  // The method actually replayed, not merely supplied — see cookieUsed's comment above.
  const authMethod = cookieUsed ? authAttempted : null;

  if (args.report) {
    const mode = args.sample ? 'sample' : 'live';
    // A passing sample proves the shape at capture time, not that the live backend emits it now.
    // A FAILING sample is definitive either way — the shape is wrong.
    let verdict;
    if (totalFail) {
      verdict = 'FAIL';
    } else if (mode === 'sample') {
      verdict = 'UNVERIFIABLE';
    } else {
      verdict = 'PASS';
    }
    // Key order is part of the artifact: it must match the Python literal exactly.
    const receipt = {
      tool: 'interface_conformance',
      verdict,
      mode,
      source: args.contract || args.spec,
      base_url: mode === 'live' ? args.url : null,
      // The METHOD, never the value: receipts are committed under `.spire/clusters/tech/contracts/`.
      auth: authMethod,
      checked_at: `${new Date().toISOString().slice(0, 19)}Z`,
      summary: {
        pass: results.filter((r) => r.verdict === 'PASS').length,
        fail: totalFail,
        total: results.length,
      },
      endpoints: results,
    };
    // The kit's guarantee is the receipt, not the runner (spec §2.1) — so it refuses to emit one it
    // would reject on read. A malformed receipt reaching GATE Q would be compared as if it were
    // meaningful, which is the silent-pass this validator exists to prevent.
    const problems = validateReceipt(receipt);
    if (problems.length) {
      console.log(`  (internal error: receipt failed its own schema — ${problems.join('; ')})`);
      return 2;
    }
    try {
      fs.writeFileSync(args.report, `${pyJsonDumps(receipt)}\n`, 'utf8');
    } catch (e) {
      console.log(`  (warning: could not write --report to ${args.report}: ${pyErrStr(e)})`);
    }
  }

  return totalFail ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `process.exitCode`, NOT `process.exit()`. Calling process.exit() while undici still holds a
  // socket handle from a live-mode fetch aborts the process on Windows with
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c" and exit code
  // 0xC0000409 — reproduced deterministically here whenever an endpoint answered non-200 and its
  // body was therefore never read. Setting exitCode lets the loop drain and exits ~80ms later with
  // the right code; every other gate path has no open handles at all, so nothing can hang.
  main(['interface_conformance.mjs', ...process.argv.slice(2)]).then((code) => {
    process.exitCode = code;
  });
}
