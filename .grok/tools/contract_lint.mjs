#!/usr/bin/env node
// contract_lint.mjs — mechanical gate-check for the delivery system (system-3).
//
// Validates the structure + lane purity of a feature's `.spire/clusters/tech/contracts/{FEATURE}/` folder so a
// malformed handoff cannot advance a gateway. It checks STRUCTURE, not code — code-level integration
// is system-1 (interface-conformance) and semantic ACs are system-2 (QA/Verify). Pairs with the
// Decision-Ledger crossing-detection hook (BACKLOG §B), which shares this script surface.
//
// Per-project coupling lives in `.spire/clusters/tech/project.json` (the single seam): `context_file`
// (default `context/PROJECT_CONTEXT.md`) names the ground-truth file. Absent config ⇒ the built-in defaults, so the tool
// runs in a bare project unchanged.
//
// Usage:
//     node .grok/tools/contract_lint.mjs                # lint every LIVE feature (contracts/, not _archive)
//     node .grok/tools/contract_lint.mjs FEATURE        # lint one feature (live or archived, by folder name)
//     node .grok/tools/contract_lint.mjs --all          # lint live + archived (regression sweep)
//     node .grok/tools/contract_lint.mjs --canon-only    # only the repo-level promoted-canon single-source check
//
// Exit code: 1 if any ERROR, else 0. WARNINGs never fail the gate (heuristic lane flags).
// Node builtins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectConfig } from './_project.mjs';
import { councilConflictId } from './_council_conflict_id.mjs';

// Resolve repo root from this file's location (.grok/tools/contract_lint.mjs -> repo root).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');
const CONTRACTS = path.join(STATE_ROOT, 'contracts');
const ARCHIVE = path.join(CONTRACTS, '_archive');

const _CFG = projectConfig();
// `_CFG.get("context_file", "context/PROJECT_CONTEXT.md")` — a present-but-null value is passed through by
// `.get`, exactly as `Object.hasOwn` passes it through here.
const CONTEXT_NAME = Object.hasOwn(_CFG, 'context_file') ? _CFG.context_file : 'context/PROJECT_CONTEXT.md';
const CONTEXT = path.join(STATE_ROOT, CONTEXT_NAME);
const LEDGER = path.join(STATE_ROOT, 'context', 'DECISION_LEDGER.md');
// Living project design canon (Phase 3). Optional seam key design_system_file; default matches scaffold.
const DESIGN_SYSTEM_REL = Object.hasOwn(_CFG, 'design_system_file') && typeof _CFG.design_system_file === 'string'
  && _CFG.design_system_file.trim() !== ''
  ? _CFG.design_system_file.trim().replace(/\\/g, '/')
  : 'context/DESIGN_SYSTEM.md';
const DESIGN_SYSTEM = path.join(STATE_ROOT, ...DESIGN_SYSTEM_REL.split('/'));
/** True when the project design canon is Status: SET (not UNSET / missing). */
export function designSystemIsSet(text) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  // Prefer an explicit Status line (scaffold uses **Status:** UNSET|SET …).
  const line = text.match(/^\*{0,2}Status:\*{0,2}\s*(SET|UNSET)\b/im);
  if (line) return line[1].toUpperCase() === 'SET';
  return false;
}

const MANIFEST_KEYS = ['Stage', 'Repos', 'Brief', 'Contracts', 'Last gateway'];
const BRIEF_FIELDS = ['Goal', 'Decision impact', 'Feasibility', 'Effort', 'Invariant watch', 'Source'];

// §3.1: every regex is module-scope, compiled once.
// `re.finditer` over the whole manifest ⇒ a sticky-free global regex re-used via matchAll (which
// clones the regex internally, so no lastIndex can leak between calls).
const STATUS_RE = /-\s+(\S+\.md)\s+(NO_BACKEND_CHANGE|NO_UI_CHANGE|locked|draft|n\/a)/g;

// The council writes exactly two per-feature artifacts; both are checked structurally below.
const SPEC_FILE = 'SPEC.md';
const INTERFACE_FILE = 'INTERFACE_CONTRACT.md';
const AC_HEADING_RE = /^##\s*\d*\.?\s*Acceptance criteria/im;
// re.S makes both `.*?` dot-all; `[\s\S]*?` is the JS equivalent. re.I covers the fence too, so a
// ```JSON fence matches on both sides.
const CONFORMANCE_RE = /##\s*Conformance spec[\s\S]*?```json\s*([\s\S]*?)```/i;
const COUNCIL_ROLES = Object.freeze(['architect', 'pm', 'ux']);
const COUNCIL_FOLDING_RE = /<!--\s*spire:council-folding:v1\s*\r?\n([\s\S]*?)\r?\n-->/g;
const COUNCIL_RESOLUTION_RE = /<!--\s*spire:council-resolution:v1\s+([a-f0-9]{64})\s+(folded|open)\s*-->/g;
const R2_JSON_RE = /^```json\s*\r?\n([\s\S]*?)\r?\n```\s*$/;
// re.S, no re.M: the lookahead has no `\Z` fallback in Python either, so a Promoted-canon section
// that runs to EOF yields NO match in BOTH implementations. That is parity, not a bug — do not "fix" it.
const PROMOTED_CANON_RE = /##\s*Promoted canon[\s\S]*?(?=\n##\s)/;
const CANON_KEY_RE = /^\|\s*`([a-z0-9-]+)`\s*\|/gm;
// Python's Path.read_text() opens in universal-newline mode: \r\n and lone \r both become \n. The
// normalization runs ONCE per file, inside read(), before any regex work — so the `m`-flag anchors
// below see the same LF-only text the .py's re.M anchors see.
// Do not delete: the differential corpus PROVABLY cannot catch this line going missing — JS's
// `m`-flag anchors are already a superset of \n, so removing this normalization changes zero corpus
// bytes today. It still earns its place: it honors read_text's universal-newline contract (the
// source of truth this port tracks) and it closes off the U+2028/U+2029 line-separator class before
// some future edit comes to depend on \n-only assumptions holding.
const UNIVERSAL_NEWLINE_RE = /\r\n?/g;
// str.splitlines() breaks on far more than \n. read() has already folded \r away, but the CRLF/CR
// alternatives are kept so pySplitlines matches str.splitlines() on raw text too.
const PY_LINEBREAK_RE = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
// The .py sorts Path objects, not str; JS `<`/`>` on strings compare UTF-16 code units, not true
// code points, so astral-plane names (outside the BMP) would diverge from Python's ordering. This
// port pins that comparator deliberately — deviation recorded as spec §4.1 N8.
const CODEPOINT_SORT = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Python `re.escape` for the fixed key/field lists below. Hoisted to module scope so the helper
 *  itself is never re-created; the `new RegExp` it feeds is built per key, but from a FIXED
 *  5-element (manifest) / 6-element (brief) list — bounded per feature folder, never per line.
 *  That is the §3.1-permitted shape: no RegExp literal is constructed inside a per-line loop. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Findings {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  err(where, msg) {
    this.errors.push(`  ERROR  ${where}: ${msg}`);
  }

  warn(where, msg) {
    this.warnings.push(`  warn   ${where}: ${msg}`);
  }
}

// §3.1 rule 1 (single-read): the .py reads the context file twice (lint_canon +
// lint_context_shardability) and reads an interface/spec twice whenever the manifest also labels it
// NO_BACKEND_CHANGE/NO_UI_CHANGE. A run-scoped cache collapses those to one read each. contract_lint
// never writes, so a cached body can never go stale within a run. main() clears it on entry.
let READ_CACHE = new Map();

/** Python `read()`: utf-8 with errors="replace", universal newlines, "" when the path is absent. */
function read(p) {
  const hit = READ_CACHE.get(p);
  if (hit !== undefined) return hit;
  const text = fs.existsSync(p)
    ? fs.readFileSync(p, 'utf8').replace(UNIVERSAL_NEWLINE_RE, '\n')
    : '';
  READ_CACHE.set(p, text);
  return text;
}

/** Python str.splitlines() — a trailing line break does NOT yield a final empty element. */
function pySplitlines(text) {
  if (text === '') return [];
  const parts = text.split(PY_LINEBREAK_RE);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Python Path.is_dir() — follows symlinks, False (never a throw) for anything else. */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** filename -> status token, from the Contracts: block. */
export function parseManifestStatuses(text) {
  // Python's dict comprehension keeps FIRST-insertion order and LAST-written value. Object.fromEntries
  // matches both: the capture is `\S+\.md`, which can never be a canonical array index, so no key is
  // hoisted into integer-key order. (`__proto__.md` is likewise safe — fromEntries defines own
  // properties rather than assigning through the setter.)
  return Object.fromEntries([...text.matchAll(STATUS_RE)].map((m) => [m[1], m[2]]));
}

export function validateCouncilFoldingReceipt(specBody, r2Bodies) {
  if (typeof specBody !== 'string' || r2Bodies === null || typeof r2Bodies !== 'object' || Array.isArray(r2Bodies)) {
    return { valid: false, error: 'receipt inputs are malformed' };
  }
  const matches = [...specBody.matchAll(COUNCIL_FOLDING_RE)];
  if (matches.length !== 1) return { valid: false, error: `expected exactly one council folding receipt, found ${matches.length}` };
  let receipt;
  try { receipt = JSON.parse(matches[0][1]); } catch { return { valid: false, error: 'council folding receipt is not valid JSON' }; }
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt) ||
      Object.keys(receipt).sort().join(',') !== 'resolutions,schema_version' || receipt.schema_version !== 1 || !Array.isArray(receipt.resolutions)) {
    return { valid: false, error: 'council folding receipt has an invalid schema' };
  }

  const expected = new Map();
  for (const role of COUNCIL_ROLES) {
    const source = `R2-${role}.md`;
    const body = r2Bodies[source];
    if (typeof body !== 'string') return { valid: false, error: `${source} is missing` };
    const fenced = R2_JSON_RE.exec(body);
    let critique;
    try { critique = fenced ? JSON.parse(fenced[1]) : null; } catch { critique = null; }
    if (critique === null || typeof critique !== 'object' || Array.isArray(critique) || !Array.isArray(critique.conflicts)) {
      return { valid: false, error: `${source} has no valid conflicts array` };
    }
    critique.conflicts.forEach((_, index) => expected.set(`${source}\u0000${index}`, councilConflictId(source, index, body)));
  }

  const seen = new Set();
  for (const resolution of receipt.resolutions) {
    if (resolution === null || typeof resolution !== 'object' || Array.isArray(resolution) ||
        Object.keys(resolution).sort().join(',') !== 'conflict_id,disposition,index,section,source' ||
        !COUNCIL_ROLES.map((role) => `R2-${role}.md`).includes(resolution.source) ||
        !Number.isInteger(resolution.index) || resolution.index < 0 ||
        !/^[a-f0-9]{64}$/.test(resolution.conflict_id) ||
        !['folded', 'open'].includes(resolution.disposition) || !/^§[1-9]$/.test(resolution.section) ||
        (resolution.disposition === 'open') !== (resolution.section === '§9')) {
      return { valid: false, error: 'council folding receipt contains an invalid resolution' };
    }
    const key = `${resolution.source}\u0000${resolution.index}`;
    if (!expected.has(key)) return { valid: false, error: 'council folding receipt names an unknown conflict' };
    if (seen.has(key)) return { valid: false, error: 'council folding receipt duplicates a conflict' };
    if (resolution.conflict_id !== expected.get(key)) return { valid: false, error: 'council folding receipt conflict id does not match the current R2 bytes' };
    const sectionNumber = resolution.section.slice(1);
    const heading = new RegExp(`^##\\s*${sectionNumber}(?:\\.|\\s)`, 'm').exec(specBody);
    if (!heading) return { valid: false, error: `council folding receipt section ${resolution.section} is missing` };
    const afterHeading = heading.index + heading[0].length;
    const nextHeading = /^##\s+/gm;
    nextHeading.lastIndex = afterHeading;
    const next = nextHeading.exec(specBody);
    const sectionBody = specBody.slice(heading.index, next?.index ?? specBody.length);
    const marker = `<!-- spire:council-resolution:v1 ${resolution.conflict_id} ${resolution.disposition} -->`;
    if (!sectionBody.includes(marker)) return { valid: false, error: `council resolution marker is absent from ${resolution.section}` };
    seen.add(key);
  }
  if (seen.size !== expected.size) return { valid: false, error: 'council folding receipt omits a conflict' };
  const markers = [...specBody.matchAll(COUNCIL_RESOLUTION_RE)];
  if (markers.length !== expected.size) return { valid: false, error: 'council resolution marker count does not match the R2 conflicts' };
  return { valid: true, error: null };
}

export function lintFeature(folder, f) {
  const name = path.basename(folder);
  const manPath = path.join(folder, '_MANIFEST.md');
  if (!fs.existsSync(manPath)) {
    f.err(name, '_MANIFEST.md missing (every feature folder needs one)');
    return;
  }
  const man = read(manPath);

  // M1 — required manifest keys present.
  for (const key of MANIFEST_KEYS) {
    if (!new RegExp(`^${escapeRe(key)}\\s*:`, 'm').test(man)) {
      f.err(`${name}/_MANIFEST.md`, `missing manifest key '${key}:'`);
    }
  }

  const statuses = parseManifestStatuses(man);
  if (Object.keys(statuses).length === 0) {
    f.warn(`${name}/_MANIFEST.md`, "no parseable 'Contracts:' status lines found");
  }

  // M2 — files the manifest claims are present (locked/draft) must exist; NO_* markers must be in-file.
  for (const [fname, status] of Object.entries(statuses)) {
    const fpath = path.join(folder, fname);
    if (status === 'locked' || status === 'draft') {
      if (!fs.existsSync(fpath)) {
        f.err(`${name}/_MANIFEST.md`, `${fname} marked '${status}' but the file is missing`);
      }
    } else if (status === 'NO_BACKEND_CHANGE' || status === 'NO_UI_CHANGE') {
      if (fs.existsSync(fpath) && !read(fpath).includes(status)) {
        f.warn(`${name}/${fname}`, `manifest says ${status} but the file omits that marker`);
      }
    }
  }

  const specPath = path.join(folder, SPEC_FILE);
  const ifacePath = path.join(folder, INTERFACE_FILE);

  // Existence is checked unconditionally — a manifest that omits or mislabels a file must not
  // hide it going missing. Both artifacts are mandatory for every live feature.
  if (!fs.existsSync(specPath)) {
    f.err(`${name}/${SPEC_FILE}`, `${SPEC_FILE} is missing from the feature folder`);
  }
  if (!fs.existsSync(ifacePath)) {
    f.err(`${name}/${INTERFACE_FILE}`, `${INTERFACE_FILE} is missing from the feature folder`);
  }

  // M8 — the spec must carry acceptance criteria (the checklist GATE Q verifies).
  if (fs.existsSync(specPath)) {
    const specBody = read(specPath);
    if (!AC_HEADING_RE.test(specBody)) {
      f.err(`${name}/${SPEC_FILE}`,
        "no 'Acceptance criteria' section — GATE Q has no checklist to verify");
    }

    // M3 — the load-bearing interface pointer belongs in SPEC §6. A filename elsewhere can be
    // historical prose or a restatement and does not bind either build lane to the interface.
    const section6 = new RegExp('^##\\s*6(?:\\.|\\s|$)[\\s\\S]*?(?=^##\\s)', 'm')
      .exec(specBody + '\n## ')?.[0] ?? '';
    if (!section6.includes(INTERFACE_FILE.replace(/\.md$/, ''))) {
      f.err(`${name}/${SPEC_FILE}`,
        `spec section 6 does not reference ${INTERFACE_FILE} `
        + '(the single FE-to-BE truth must be named, never restated)');
    }

    const council = path.join(folder, 'council');
    const r2Paths = Object.fromEntries(COUNCIL_ROLES.map((role) => {
      const source = `R2-${role}.md`;
      return [source, path.join(council, source)];
    }));
    if (Object.values(r2Paths).some((file) => fs.existsSync(file))) {
      const receipt = validateCouncilFoldingReceipt(specBody,
        Object.fromEntries(Object.entries(r2Paths).map(([source, file]) => [source, read(file)])));
      if (!receipt.valid) f.err(`${name}/${SPEC_FILE}`, `invalid council folding receipt — ${receipt.error}`);
    }

    // M9 — UI-touching features require a project design canon with Status: SET.
    // Bypass keys off the SPEC body (NO_UI_CHANGE), never the manifest alone — same honesty as M7.
    // Absent file or Status: UNSET is an ERROR. Remedy: design-system onboarding process.
    if (!specBody.includes('NO_UI_CHANGE')) {
      const dsBody = read(DESIGN_SYSTEM);
      if (!designSystemIsSet(dsBody)) {
        const state = !fs.existsSync(DESIGN_SYSTEM)
          ? 'missing'
          : 'UNSET or missing Status: SET';
        f.err(`${name}/${SPEC_FILE}`,
          `UI-touching feature requires project design canon Status: SET `
          + `(${DESIGN_SYSTEM_REL} is ${state}) — run `design/DESIGN_SYSTEM_METHOD.md` (living project design canon) or follow `
          + 'design/DESIGN_SYSTEM_METHOD.md; put NO_UI_CHANGE in the SPEC body for backend-only features');
      }
    }
  }

  // M7 — the interface must carry a parseable machine-checkable conformance spec (system-1),
  // unless it is explicitly a no-backend-change feature. ERROR: without it GATE Q cannot verify.
  // The NO_BACKEND_CHANGE bypass keys off the file's own body, never the manifest label — a
  // manifest can mislabel a file, but it cannot put words in the file itself.
  if (fs.existsSync(ifacePath)) {
    const ibody = read(ifacePath);
    if (!ibody.includes('NO_BACKEND_CHANGE')) {
      const m = CONFORMANCE_RE.exec(ibody);
      if (!m) {
        f.err(`${name}/${INTERFACE_FILE}`,
          "no '## Conformance spec' ```json block — interface_conformance.mjs cannot verify "
          + 'the live backend against this interface');
      } else {
        try {
          JSON.parse(m[1]);
        } catch {
          // spec §4.1 N3: CPython embeds `exc.msg` + `exc.lineno`; V8's message differs and is not
          // stable across Node versions, so the port emits a fixed parenthetical instead.
          f.err(`${name}/${INTERFACE_FILE}`,
            "'## Conformance spec' block is not valid JSON (invalid JSON)");
        }
      }
    }
  }

  // M4 — BRIEF fields (if a BRIEF exists).
  const brief = path.join(folder, 'BRIEF.md');
  if (fs.existsSync(brief)) {
    const btext = read(brief);
    for (const field of BRIEF_FIELDS) {
      if (!new RegExp(`^${escapeRe(field)}\\s*:`, 'm').test(btext)) {
        f.err(`${name}/BRIEF.md`, `missing BRIEF field '${field}:'`);
      }
    }

    // M4b — Considered: (dispatcher-minus-one C5). WARN, not ERROR: BRIEFs written before the
    // field exist in every consumer's archive, and a kit sync must not fail them retroactively.
    // The field is what makes GATE I's cull auditable — the candidates NOT chosen, with reasons.
    if (!/^Considered\s*:/m.test(btext)) {
      f.warn(`${name}/BRIEF.md`, "no 'Considered:' line — GATE I's cull is not auditable (which candidates lost, and why?)");
    }
  }
}

/** Repo-level: every key in the ledger's 'Promoted canon' table must have its prose in CONTEXT. */
export function lintCanon(f) {
  if (!fs.existsSync(LEDGER) || !fs.existsSync(CONTEXT)) {
    f.warn('repo', `DECISION_LEDGER.md or ${CONTEXT_NAME} missing — skipping canon check`);
    return;
  }
  const ledger = read(LEDGER);
  const context = read(CONTEXT);
  const m = PROMOTED_CANON_RE.exec(ledger);
  if (!m) {
    f.warn('DECISION_LEDGER.md', "no 'Promoted canon' section found");
    return;
  }
  const keys = [...m[0].matchAll(CANON_KEY_RE)].map((x) => x[1]);
  for (const key of keys) {
    if (!context.includes(`\`${key}\``) && !context.includes(key)) {
      f.err('DECISION_LEDGER.md',
        `promoted key '${key}' has no prose in ${CONTEXT_NAME} `
        + '(single-source rule: canon prose must live there)');
    }
  }
}

// A context section larger than this cannot be usefully sharded: any feature whose tags touch it
// pulls the whole thing, so system-5's savings collapse toward zero. Measured 2026-08-04 on a live
// consumer, one 428-line section (44% of the file) held the pack to 14% smaller than the canon.
// WARN, never ERROR: the context file is project-owned, the kit never overwrites it, and a consumer
// mid-feature must not be blocked by an advisory finding about document structure.
export const SHARD_SECTION_MAX_LINES = 150;

/** Repo-level: flag context sections too large for system-5 sharding to help. */
export function lintContextShardability(f) {
  if (!fs.existsSync(CONTEXT)) return; // lint_canon already warns when the context file is missing
  const sections = [];
  let heading = null;
  let count = 0;
  for (const ln of pySplitlines(read(CONTEXT))) {
    if (ln.startsWith('## ')) {
      if (heading !== null) sections.push([heading, count]);
      heading = ln.trim();
      count = 1;
    } else if (heading !== null) {
      count += 1;
    }
  }
  if (heading !== null) sections.push([heading, count]);

  for (const [name, n] of sections) {
    if (n > SHARD_SECTION_MAX_LINES) {
      f.warn(CONTEXT_NAME,
        `'${name}' is ${n} lines (> ${SHARD_SECTION_MAX_LINES}) — too large to shard `
        + 'usefully; any feature tagged into it loads the whole section');
    }
  }
}

export function liveFeatures() {
  if (!fs.existsSync(CONTRACTS)) return [];
  // Python sorts Path objects, which case-fold on Windows (PureWindowsPath) — so CPython's own
  // order already varies by OS. This port pins code-point order deliberately instead of chasing
  // that: OS-stable, identical to POSIX Python, deviation from Windows Python recorded as spec
  // §4.1 N8. `is_dir()` follows symlinks — readdirSync names + statSync (not Dirent.isDirectory(),
  // which reports a symlinked directory as a symlink) reproduces that.
  return fs
    .readdirSync(CONTRACTS)
    .filter((n) => n !== '_archive' && isDir(path.join(CONTRACTS, n)))
    .sort(CODEPOINT_SORT)
    .map((n) => path.join(CONTRACTS, n));
}

function archiveFeatures() {
  return fs
    .readdirSync(ARCHIVE)
    .filter((n) => isDir(path.join(ARCHIVE, n)))
    .sort(CODEPOINT_SORT)
    .map((n) => path.join(ARCHIVE, n));
}

export function findFeature(arg) {
  for (const base of [CONTRACTS, ARCHIVE]) {
    const cand = path.join(base, arg);
    if (isDir(cand)) return cand;
  }
  return null;
}

export function main(argv) {
  READ_CACHE = new Map(); // run-scoped single-read cache (see read())
  const f = new Findings();
  const arg = argv.length > 1 ? argv[1] : null;

  let folders;
  if (arg === '--canon-only') {
    lintCanon(f);
    lintContextShardability(f);
    folders = [];
  } else if (arg === '--all') {
    // The .py's conditional expression binds the whole concatenation:
    //   folders = (live + sorted(archive)) if ARCHIVE.exists() else live
    folders = fs.existsSync(ARCHIVE) ? [...liveFeatures(), ...archiveFeatures()] : liveFeatures();
    lintCanon(f);
    lintContextShardability(f);
  } else if (arg && !arg.startsWith('--')) {
    const target = findFeature(arg);
    if (target === null) {
      console.log(`feature '${arg}' not found under contracts/ or contracts/_archive/`);
      return 2;
    }
    folders = [target];
    lintCanon(f);
    lintContextShardability(f);
  } else {
    folders = liveFeatures();
    lintCanon(f);
    lintContextShardability(f);
  }

  for (const folder of folders) lintFeature(folder, f);

  // `arg if arg else …`: an unknown `--flag` IS the scope string, and so are `--all`/`--canon-only`.
  // An empty-string arg is falsy in both languages and falls through to the count.
  const scope = arg || `${folders.length} live feature(s)`;
  console.log(`contract_lint — scope: ${scope}`);
  if (f.errors.length === 0 && f.warnings.length === 0) {
    console.log('  OK — no findings.');
  }
  for (const line of f.errors) console.log(line);
  for (const line of f.warnings) console.log(line);
  console.log(`\n  ${f.errors.length} error(s), ${f.warnings.length} warning(s).`);
  return f.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `process.exitCode`, NOT `process.exit()` — the Task 5 port proved process.exit() aborts Node on
  // Windows when a handle is still open, and the port standardises on exitCode across all four gates.
  process.exitCode = main(['contract_lint.mjs', ...process.argv.slice(2)]);
}
