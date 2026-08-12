#!/usr/bin/env node
// context_for.mjs — ground-truth retrieval / sharding (system-5).
//
// Decouples per-session token cost from total system size. Instead of re-reading the whole
// project context file every session, a role loads only the **minimal context pack** a feature needs:
// the always-load invariant floor + the sections relevant to the feature's tags. As more features ship
// and the canon grows, the savings grow with it.
//
// Logical-slice (not a physical split): the project context file stays the single source. Each `## N.`
// section carries an inline `<!-- shard: tags=...; always -->` annotation; this tool selects sections by
// relevance. **Binding invariant: invariant-bearing sections are `always` — sharding never drops a rule
// a feature could violate** (the math-constraint + key-decision/promoted-invariant sections are always-load).
//
// The context filename is read from `.spire/clusters/tech/project.json`
// (`context_file`, default `context/PROJECT_CONTEXT.md`)
// — the single per-project seam. With no config the tool falls back to that default, so it runs in a
// bare project unchanged.
//
// Usage:
//     node .grok/tools/context_for.mjs {FEATURE}            # --stat (what would load + savings)
//     node .grok/tools/context_for.mjs {FEATURE} --print    # emit the assembled context pack
//     node .grok/tools/context_for.mjs {FEATURE} --write    # write the pack to contracts/{FEATURE}/_context-pack.md
//     node .grok/tools/context_for.mjs --tags a,b --stat    # ad-hoc: select by explicit tags
// Feature tags come from the BRIEF's optional `Context tags:` line + its Invariant-watch keys; `--tags`
// overrides. Node builtins only.
//
// The .py called `sys.stdout.reconfigure(encoding="utf-8")` because the canon carries arrows and box
// characters and CPython would otherwise write the console's locale encoding. Node always writes UTF-8,
// so there is nothing to reconfigure — the line has no Node counterpart and is deliberately absent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pyRepr, pyFixed0 } from './_pyfmt.mjs';
import { projectConfig } from './_project.mjs';

// Resolve repo root from this file's location (.grok/tools/context_for.mjs -> repo root).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');

const _CFG = projectConfig();
const CONTEXT = path.join(
  STATE_ROOT,
  Object.hasOwn(_CFG, 'context_file') ? _CFG.context_file : 'context/PROJECT_CONTEXT.md',
);
const CONTRACTS = path.join(STATE_ROOT, 'contracts');
const ARCHIVE = path.join(CONTRACTS, '_archive');

// §3.1: every regex is module-scope, compiled once.
const SHARD_RE = /<!--\s*shard:\s*(.*?)\s*-->/;
const TAGS_RE = /tags=([\w,\-]+)/;
// `^Context tags:\s*(.+)$` with re.M. `\s` spans newlines in BOTH engines and is greedy, so a bare
// `Context tags:` line pulls the value off the FOLLOWING line — pinned by the corpus. (The brief
// proposed `[ \t]*`, which would not match that shape at all; see the task-6 report.)
const CONTEXT_TAGS_RE = /^Context tags:\s*(.+)$/m;
const SPLIT_TAGS_RE = /[,\s]+/;
// `Invariant watch:(.*?)(?:\n[A-Z][a-z].*?:|\Z)` with re.S. re.S makes BOTH `.*?` dot-all, including
// the one inside the terminator alternation — so the terminator may run past its own line to find a
// colon further down. `[\s\S]*?` reproduces that; `[^\n]*?` does not (pinned by the corpus).
// No `m` flag: Python's `\Z` is the absolute end of input, which is exactly JS `$` without `m`.
const INVARIANT_WATCH_RE = /Invariant watch:([\s\S]*?)(?:\n[A-Z][a-z][\s\S]*?:|$)/;
const WATCH_KEY_RE = /[`\[]([a-z][a-z0-9-]{3,})[`\]]/g;
// Python's Path.read_text() opens in universal-newline mode: \r\n and lone \r both become \n.
const UNIVERSAL_NEWLINE_RE = /\r\n?/g;
// str.splitlines() breaks on far more than \n. The universal-newline read has already folded \r away
// on the CLI path, but the CRLF/CR alternatives are kept so the exported parseSections() matches
// str.splitlines() on raw text too — a strict superset that cannot fire on converted input.
const PY_LINEBREAK_RE = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
// sorted() on str is codepoint order; §3.1 requires an explicit comparator on every .sort().
const CODEPOINT_SORT = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Python Path.read_text(encoding="utf-8") — universal newlines. */
function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(UNIVERSAL_NEWLINE_RE, '\n');
}

/** Python str.splitlines() — a trailing line break does NOT yield a final empty element. */
function pySplitlines(text) {
  if (text === '') return [];
  const parts = text.split(PY_LINEBREAK_RE);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Parse the inline `<!-- shard: tags=...; always -->` annotation on a section. Called AFTER all
 * body lines are appended (the annotation sits just under the heading). */
function scanShard(section) {
  for (let i = 0; i < Math.min(3, section.lines.length); i++) {
    const m = SHARD_RE.exec(section.lines[i]);
    if (m) {
      const spec = m[1];
      section.always = spec.includes('always');
      const tm = TAGS_RE.exec(spec);
      if (tm) {
        section.tags = new Set(tm[1].split(',').map((t) => t.trim()).filter(Boolean));
      }
    }
  }
}

/** @returns {[string[], {heading: string, lines: string[], tags: Set<string>, always: boolean}[]]} */
export function parseSections(text) {
  const lines = pySplitlines(text);
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith('## ')) {
      cur = { heading: ln, lines: [ln], tags: new Set(), always: false };
      sections.push(cur);
    } else if (cur === null) {
      preamble.push(ln);
    } else {
      cur.lines.push(ln);
    }
  }
  for (const s of sections) scanShard(s);
  return [preamble, sections];
}

export function featureTags(feature, explicit) {
  if (explicit) {
    return new Set(
      explicit.split(',').map((t) => t.trim()).filter(Boolean).map((t) => t.toLowerCase()),
    );
  }
  if (!feature) return new Set();
  let brief = null;
  for (const base of [CONTRACTS, ARCHIVE]) {
    const cand = path.join(base, feature, 'BRIEF.md');
    if (fs.existsSync(cand)) {
      brief = readText(cand);
      break;
    }
  }
  if (brief === null) {
    console.error(`(no BRIEF for '${feature}' — selecting always-load only)`);
    return new Set();
  }
  const tags = new Set();
  const m = CONTEXT_TAGS_RE.exec(brief);
  if (m) {
    for (const t of m[1].split(SPLIT_TAGS_RE)) {
      if (t.trim()) tags.add(t.trim().toLowerCase());
    }
  }
  // Invariant-watch keys (e.g. `[best-effort-isolated-or-null]`) double as tags.
  const inv = INVARIANT_WATCH_RE.exec(brief);
  if (inv) {
    WATCH_KEY_RE.lastIndex = 0; // /g regex: reset before reuse so lastIndex cannot leak between calls
    for (const km of inv[1].matchAll(WATCH_KEY_RE)) tags.add(km[1].toLowerCase());
  }
  return tags;
}

export function main(argv) {
  const args = argv.slice(1);
  const doPrint = args.includes('--print');
  const doWrite = args.includes('--write');
  let explicit = null;
  if (args.includes('--tags')) {
    // A trailing `--tags` with no value is an IndexError traceback in CPython; here it reads as
    // null, i.e. "no explicit tags" — the same path a missing `--tags` takes. Not in the corpus.
    explicit = args[args.indexOf('--tags') + 1] ?? null;
  }
  const feature =
    args.find((a) => !a.startsWith('--') && (explicit === null || a !== explicit)) ?? null;

  const [preamble, sections] = parseSections(readText(CONTEXT));
  const ftags = featureTags(feature, explicit);

  const selected = [];
  for (const s of sections) {
    if (s.always || [...s.tags].some((t) => ftags.has(t))) selected.push(s);
  }
  // Python's `s in selected` is identity comparison (Section defines no __eq__); a Set of the same
  // object references reproduces it in O(1) instead of the .py's O(n) scan per section.
  const selectedSet = new Set(selected);

  let total = preamble.length;
  for (const s of sections) total += s.lines.length;

  if (doWrite) {
    if (!feature) {
      console.log('--write requires a FEATURE (the pack is written into its contract folder)');
      return 2;
    }
    const base = [CONTRACTS, ARCHIVE].find((b) => isDir(path.join(b, feature))) ?? null;
    if (base === null) {
      console.log(`no contract folder for '${feature}' under contracts/ or contracts/_archive/`);
      return 2;
    }
    const out = [...preamble];
    for (const s of selected) for (const ln of s.lines) out.push(ln);
    const dest = path.join(base, feature, '_context-pack.md');
    fs.writeFileSync(dest, `${out.join('\n')}\n`, 'utf8');
    const pct = total ? ((total - out.length) / total) * 100 : 0;
    // path.relative uses the OS separator, exactly as Python's Path.relative_to(ROOT) does — both
    // print backslashes on Windows, so the bytes match and must NOT be normalised.
    console.log(
      `context_for — wrote ${path.relative(ROOT, dest)} (${out.length}/${total} lines, ${pyFixed0(pct)}% smaller)`,
    );
    return 0;
  }

  if (doPrint) {
    const out = [...preamble];
    for (const s of selected) for (const ln of s.lines) out.push(ln);
    console.log(out.join('\n'));
    return 0;
  }

  let loaded = preamble.length;
  for (const s of selected) loaded += s.lines.length;
  const tags = [...ftags].sort(CODEPOINT_SORT);
  // Python prints `sorted(ftags) or '—'`: a LIST repr when non-empty, the em dash when empty.
  console.log(
    `context_for — feature: ${feature || '(ad-hoc)'}  tags: ${tags.length ? pyRepr(tags) : '—'}`,
  );
  console.log(`  preamble (always): ${preamble.length} lines`);
  for (const s of sections) {
    const on = selectedSet.has(s);
    const why = s.always ? 'always' : on ? 'tag' : '—';
    const mark = on ? 'LOAD' : 'skip';
    console.log(
      `  [${mark}] ${s.heading.slice(0, 48).padEnd(48)} ${String(s.lines.length).padStart(4)} ln  (${why})`,
    );
  }
  const saved = total - loaded;
  const pct = total ? (saved / total) * 100 : 0;
  console.log(`\n  pack: ${loaded}/${total} lines  —  ${saved} saved (${pyFixed0(pct)}% smaller)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `process.exitCode`, NOT `process.exit()` — the Task 5 port proved process.exit() aborts Node on
  // Windows when a handle is still open, and the port standardises on exitCode across all four gates.
  process.exitCode = main(['context_for.mjs', ...process.argv.slice(2)]);
}
