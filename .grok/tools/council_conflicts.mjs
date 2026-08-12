#!/usr/bin/env node
// council_conflicts.mjs — merge + validate the council's R2 critique round (GATE C).
//
// Each R2 voice writes `council/R2-{role}.md` carrying exactly one fenced `json` block. This script
// does the step `commands/council.md` used to ask the controller to do by hand: it collects the three
// blocks into one `council/conflicts.json`, and — the part a human reliably gets wrong — it checks
// that every conflict's `quote` really does appear in the R1 position it names.
//
// That check is the reason the round is trustworthy. A conflict is only a conflict if it contradicts
// something another voice actually said; a paraphrase lets a voice argue with a position nobody held.
// The rule was prompt-only until now, and a real run put 3 of 8 conflicts (37%) in violation.
//
// **Quote matching is forgiving about formatting, strict about words.** All three observed failures
// were faithful quotes that had dropped their `**` bold markers, not fabrications, so a naive
// substring test punishes honest work. Before comparing, both sides are normalised:
//
//   - whitespace collapsed      — R1 files hard-wrap, so a quoted sentence spans a line break
//   - markdown emphasis removed — `**bold**`, `_em_`, `` `code` `` survive a read but not a re-type
//   - curly quotes straightened — agents routinely re-emit " as " and ' as '
//
// Case and wording are NOT normalised. Those do not change when a sentence is copied, so a mismatch
// there is a real paraphrase and the gate should fire.
//
// Usage:
//     node .grok/tools/council_conflicts.mjs FEATURE              # merge, validate, write conflicts.json
//     node .grok/tools/council_conflicts.mjs FEATURE --dry-run    # validate + report, write nothing
//
// Exit code: 1 if any conflict fails validation (the gate), 2 on a usage/input error, else 0.
// Every conflict in the written `conflicts.json` carries `quote_verified` so a send-back is
// machine-visible rather than something the controller has to re-derive from console output, and
// `self_revision` for the case where a voice quotes its OWN R1 to withdraw a claim — legal, and
// routed differently by R3 because there is no opposing voice to re-spawn.
// Node builtins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pyRepr, pyJsonDumps } from './_pyfmt.mjs';
import { councilConflictId } from './_council_conflict_id.mjs';

// Resolve repo root from this file's location (.grok/tools/council_conflicts.mjs -> repo root).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACTS = path.join(ROOT, '.spire', 'clusters', 'tech', 'contracts');

const ROLES = ['architect', 'pm', 'ux'];
const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/g;
const REQUIRED_KEYS = ['quote', 'source', 'why', 'proposal', 'kind'];
const KINDS = ['technical', 'product'];

// Emphasis markers a faithful quote loses on the way back out of an agent. Stripped from BOTH
// sides of the comparison, so a quote that keeps its markers still matches a source that has them.
const EMPHASIS_RE = /[*_`~]/g;
const CURLY_DOUBLE_RE = /[“”]/g;
const CURLY_SINGLE_RE = /[‘’]/g;
// Python's no-arg str.split() folds every whitespace run, including leading/trailing.
const WHITESPACE_RE = /\s+/;
// Python's Path.read_text() opens in universal-newline mode: \r\n and lone \r both become \n.
const UNIVERSAL_NEWLINE_RE = /\r\n?/g;
// sorted() on str is codepoint order; §3.1 requires an explicit comparator on every .sort().
const CODEPOINT_SORT = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- small Python-semantics shims (local: _pyfmt.mjs owns only output formatting) -----------

/** Python `isinstance(v, dict)` for JSON-parsed values. */
function isDict(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Python `str(v)` for JSON-parsed values — str passes through, everything else reprs. */
function pyStr(v) {
  return typeof v === 'string' ? v : pyRepr(v);
}

/** Python truthiness — empty list/dict are falsy in Python but truthy in JS. */
function pyTruthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Python `for x in v` over a JSON-parsed value (list items, str chars, dict keys). The str-chars
 * and dict-keys branches are live: `merge()` feeds this a string `asks` (char iteration) or a
 * dict `agree` (key iteration) whenever an R2 block hands one of those shapes to a list-shaped
 * field — both are accepted by CPython, so both must be accepted here too. */
function pySeq(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (v !== null && typeof v === 'object') return Object.keys(v);
  return [];
}

/** Python `len(v)` for JSON-parsed values. Same live str/dict branches as `pySeq()` above — a
 * string `agree` counts characters, a dict `agree` counts keys, matching CPython's `len()`. */
function pyLen(v) {
  if (Array.isArray(v) || typeof v === 'string') return v.length;
  if (v !== null && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

/** Python `for x in v` / `len(v)` succeed on list, str, and dict — TypeError on anything else
 * (int, bool, float, None; None is already filtered out upstream by pyTruthy). Used to decide
 * whether a non-list `asks`/`agree` is one CPython would have accepted (string, dict) or one that
 * would have crashed it (bare number, boolean true). */
const isPyIterable = (v) => Array.isArray(v) || typeof v === 'string' || (v !== null && typeof v === 'object');

/** Python `str(dict)` where keys may be non-str — Map keeps key type and insertion order. */
function reprDict(map) {
  const parts = [];
  for (const [k, v] of map) parts.push(`${pyRepr(k)}: ${pyRepr(v)}`);
  return `{${parts.join(', ')}}`;
}

// --- the port, function-for-function in source order ----------------------------------------

/** Fold away formatting that copying a sentence can plausibly change — nothing else. */
export function normalise(text) {
  const straightened = text.replace(CURLY_DOUBLE_RE, '"').replace(CURLY_SINGLE_RE, "'");
  return straightened.replace(EMPHASIS_RE, '').split(WHITESPACE_RE).filter(Boolean).join(' ');
}

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

export function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(UNIVERSAL_NEWLINE_RE, '\n') : '';
}

/** Pull the single fenced json block out of an R2 file.
 *
 * Zero blocks and two-or-more blocks are both ERRORs: R2-critique.md asks for exactly one, and a
 * script that guesses which block was meant can merge the wrong conflicts into a round the human
 * is then asked to rule on. The old throwaway printed a warning and silently dropped that voice's
 * conflicts entirely — the worst of the three outcomes.
 */
export function extractBlock(text, where, f) {
  const blocks = [...text.matchAll(JSON_BLOCK_RE)].map((m) => m[1]);
  if (blocks.length === 0) {
    f.err(where, 'no fenced ```json block — R2 must return exactly one');
    return null;
  }
  if (blocks.length > 1) {
    f.err(where, `${blocks.length} fenced \`\`\`json blocks — R2 must return exactly one, so which `
      + 'one holds the conflicts is ambiguous');
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(blocks[0]);
  } catch {
    f.err(where, 'json block does not parse (invalid JSON)');
    return null;
  }
  if (!isDict(parsed)) {
    f.err(where, 'json block is not an object');
    return null;
  }
  return parsed;
}

/** Schema + verbatim-quote check for one conflict. Returns true if it may stand. */
export function validateConflict(c, raisedBy, idx, sources, f) {
  const where = `R2-${raisedBy}.md conflict[${idx}]`;
  const missing = REQUIRED_KEYS.filter((k) => !pyStr(Object.hasOwn(c, k) ? c[k] : '').trim());
  if (missing.length) {
    f.err(where, `missing or empty field(s): ${missing.join(', ')}`);
    return false;
  }

  if (!KINDS.includes(c.kind)) {
    f.err(where, `kind '${pyStr(c.kind)}' is not one of ${KINDS.join('/')} — R3 cannot route it`);
    return false;
  }

  const source = c.source;
  if (!ROLES.includes(source)) {
    f.err(where, `source '${pyStr(source)}' is not one of ${ROLES.join('/')}`);
    return false;
  }
  if (!Object.hasOwn(sources, source)) {
    f.err(where, `R1-${source}.md is missing, so the quote cannot be verified`);
    return false;
  }

  if (!sources[source].includes(normalise(c.quote))) {
    f.err(where, `quote does not appear in R1-${source}.md — paraphrase, not a quote: `
      + `"${normalise(c.quote).slice(0, 80)}"`);
    return false;
  }
  return true;
}

/** Read the three R2 blocks and the three R1 positions; return the merged, validated result. */
export function merge(council, f) {
  const sources = {};
  for (const role of ROLES) {
    const p = path.join(council, `R1-${role}.md`);
    if (fs.existsSync(p)) {
      sources[role] = normalise(read(p));
    } else {
      f.err('council/', `R1-${role}.md is missing — quotes naming ${role} cannot be verified`);
    }
  }

  const out = { conflicts: [], asks: [], agree_count: {} };
  for (const role of ROLES) {
    const p = path.join(council, `R2-${role}.md`);
    if (!fs.existsSync(p)) {
      f.err('council/', `R2-${role}.md is missing — the round is incomplete`);
      continue;
    }
    const sourceName = `R2-${role}.md`;
    const body = read(p);
    const d = extractBlock(body, sourceName, f);
    if (d === null) continue;

    let raisedBy = Object.hasOwn(d, 'role') ? d.role : role;
    if (!ROLES.includes(raisedBy)) {
      f.warn(`R2-${role}.md`, `role field '${pyStr(raisedBy)}' is not a known role; using '${role}'`);
      raisedBy = role;
    }

    let conflicts = pyTruthy(d.conflicts) ? d.conflicts : [];
    if (!Array.isArray(conflicts)) {
      f.err(`R2-${role}.md`, "'conflicts' is not an array");
      conflicts = [];
    }
    for (let i = 0; i < conflicts.length; i++) {
      const c = conflicts[i];
      if (!isDict(c)) {
        f.err(`R2-${role}.md conflict[${i}]`, 'conflict entry is not an object');
        continue;
      }
      const entry = { ...c };
      entry.conflict_id = councilConflictId(sourceName, i, body);
      entry.raised_by = raisedBy;
      // A voice quoting its OWN R1 is retracting a claim it can no longer defend now that it
      // has read the others — the round's most honest output, not a malformed conflict. It is
      // flagged rather than rejected because R3 must NOT route it as a conflict: there is no
      // opposing voice to re-spawn, so the resolution is simply to fold the retraction in.
      entry.self_revision = c.source === raisedBy;
      entry.quote_verified = validateConflict(c, raisedBy, i, sources, f);
      out.conflicts.push(entry);
    }

    // CPython's `len()`/`for x in v` over `asks`/`agree` succeed on list, str, AND dict (char
    // iteration / key iteration / key count respectively) — only a truthy NON-iterable value
    // (bare number, boolean true) raises an unhandled TypeError. So the gate here must match
    // Python's iterability, not Array-ness: a string or dict `asks`/`agree` is accepted and falls
    // through to pySeq()/pyLen() same as Python would; only the non-iterable case is a deliberate
    // deviation, mirroring how the .py itself handles a non-list `conflicts` (its line 158
    // pattern) but surfacing a findings error instead of reproducing an unreproducible traceback
    // (same exit code either way).
    let asks = pyTruthy(d.asks) ? d.asks : [];
    if (!isPyIterable(asks)) {
      f.err(`R2-${role}.md`, "'asks' is not an array");
      asks = [];
    }
    for (const a of pySeq(asks)) out.asks.push({ from: raisedBy, ask: a });

    // Same rule as above, mirrored for 'agree': non-iterable is a findings error, string/dict
    // fall through to pyLen()'s char-count / key-count branches same as CPython's len().
    let agree = pyTruthy(d.agree) ? d.agree : [];
    if (!isPyIterable(agree)) {
      f.err(`R2-${role}.md`, "'agree' is not an array");
      agree = [];
    }
    out.agree_count[raisedBy] = pyLen(agree);
  }
  return out;
}

export function report(out, f) {
  const kinds = new Map();
  for (const c of out.conflicts) {
    const k = Object.hasOwn(c, 'kind') ? c.kind : '?';
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const verified = out.conflicts.filter((c) => c.quote_verified).length;
  const total = out.conflicts.length;
  const revisions = out.conflicts.filter((c) => c.self_revision && c.quote_verified);

  console.log(`  conflicts: ${total}  ${kinds.size ? reprDict(kinds) : '{}'}`);
  console.log(`  asks: ${out.asks.length}   agree: ${pyRepr(out.agree_count)}`);
  console.log(`  quotes verified: ${verified}/${total}`);
  if (revisions.length) {
    console.log(`  self-revisions: ${revisions.length} (a voice retracting its own R1 — fold in, no exchange)`);
    for (const c of revisions) {
      console.log(`     [${c.raised_by} withdraws] ${normalise(c.quote).slice(0, 80)}`);
    }
  }

  // R3 routes product conflicts to the human one at a time; surfacing them here tells the
  // controller up front how many questions the owner is about to be asked. A self-revision is
  // never one of those questions — the voice already ruled against itself.
  const product = out.conflicts.filter(
    (c) => c.kind === 'product' && c.quote_verified && !c.self_revision,
  );
  if (product.length) {
    console.log(`\n  -- ${product.length} product conflict(s), for the human to rule on --`);
    for (const c of product) {
      console.log(`     [${c.raised_by} -> ${c.source}] ${normalise(c.quote).slice(0, 88)}`);
    }
  }

  if (f.errors.length) {
    console.log();
    for (const line of f.errors) console.log(line);
  }
  for (const line of f.warnings) console.log(line);
}

export function main(argv) {
  const rest = argv.slice(1);
  const args = rest.filter((a) => !a.startsWith('--'));
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const unknown = [...flags].filter((a) => a !== '--dry-run');
  if (unknown.length || args.length !== 1) {
    console.log(`usage: ${path.basename(argv[0])} FEATURE [--dry-run]`);
    if (unknown.length) {
      console.log(`  unknown flag(s): ${unknown.sort(CODEPOINT_SORT).join(', ')}`);
    }
    return 2;
  }

  const feature = args[0];
  const council = path.join(CONTRACTS, feature, 'council');
  let isDir = false;
  try {
    isDir = fs.statSync(council).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    console.log(`no council folder for feature '${feature}' (looked in ${council})`);
    return 2;
  }

  const f = new Findings();
  const out = merge(council, f);

  console.log(`council_conflicts — feature: ${feature}`);
  if (!flags.has('--dry-run')) {
    fs.writeFileSync(path.join(council, 'conflicts.json'), `${pyJsonDumps(out)}\n`, 'utf8');
    console.log(`  wrote ${path.basename(council)}/conflicts.json`);
  }
  report(out, f);

  if (f.errors.length) {
    console.log(`\n  ${f.errors.length} error(s) — send the affected voice(s) back before R3.`);
    return 1;
  }
  console.log('\n  OK — every conflict carries a verified quote.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(['council_conflicts.mjs', ...process.argv.slice(2)]);
}
