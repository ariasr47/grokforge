#!/usr/bin/env node
// memory_query.mjs — seam-first memory retrieval (Phase C3).
//
// Files under the neutral seam (and dated handover notes beside the consumer root) remain truth.
// This tool is a search cache over those paths — not a second write authority. Prefer it before
// re-reading whole archives. Node builtins only.
//
// Usage (from the installed tools directory on a consumer, or via gates.mjs memory_query):
//   node memory_query.mjs --q "reconnect policy"
//   node memory_query.mjs --q "invariant" --scope cluster,feature --limit 8
//   node memory_query.mjs --q "handover" --scope episodic --include-archive
//   node gates.mjs memory_query --q "…"
//
// Exit: 0 always when query runs (empty results is success); 2 on usage/arg errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
// Consumer root = two levels above tools/ (provider root parent). Same as continuity.mjs.
const ROOT = path.resolve(TOOL_DIR, '..', '..');

const SKIP_DIR = new Set(['node_modules', '.git', '.spire-cache', 'coverage', 'dist', 'build', '.next']);
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;
const EXCERPT_CHARS = 220;
/** Skip files larger than this (bytes) — protects QoS on accidental huge dumps. */
export const MAX_FILE_BYTES = 512 * 1024;
/** Soft cap on files considered per query (walk order is deterministic). */
export const MAX_FILES_SCAN = 2500;

/** @typedef {'company'|'cluster'|'branch'|'feature'|'episodic'} MemoryScope */

/**
 * @param {string} q
 * @returns {string[]}
 */
export function tokenizeQuery(q) {
  return String(q)
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * @param {string} text
 * @param {string[]} terms
 * @returns {{ score: number, line: number, excerpt: string } | null}
 */
export function scoreText(text, terms) {
  if (terms.length === 0) return null;
  // Fast AND prefilter on whole document (lowercased once) before line work.
  const lowerAll = text.toLowerCase();
  for (const term of terms) {
    if (!lowerAll.includes(term)) return null;
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let score = 0;
  let firstLine = -1;
  let firstExcerpt = '';
  for (let i = 0; i < lines.length; i++) {
    const lnLower = lines[i].toLowerCase();
    for (const term of terms) {
      let from = 0;
      while (from < lnLower.length) {
        const at = lnLower.indexOf(term, from);
        if (at === -1) break;
        score += 1;
        if (firstLine < 0) {
          firstLine = i + 1;
          const raw = lines[i].trim();
          firstExcerpt = raw.length > EXCERPT_CHARS ? `${raw.slice(0, EXCERPT_CHARS - 1)}…` : raw;
        }
        from = at + term.length;
      }
    }
  }
  if (score === 0) return null;
  return { score, line: firstLine < 0 ? 1 : firstLine, excerpt: firstExcerpt };
}

/**
 * @param {string} relPath posix
 * @returns {MemoryScope}
 */
export function classifyPath(relPath) {
  const p = relPath.replaceAll('\\', '/');
  if (p.startsWith('.spire/company/')) return 'company';
  if (p.includes('/state/') || /\/RESUME\.md$/i.test(p) || /\/IN_FLIGHT\.md$/i.test(p)) return 'branch';
  if (p.includes('/contracts/_archive/')) return 'episodic';
  if (p.includes('/contracts/')) return 'feature';
  if (/HANDOVER/i.test(path.basename(p))) return 'episodic';
  if (p.startsWith('.spire/clusters/')) return 'cluster';
  if (p.startsWith(`docs${'/'}`) || p === 'docs') return 'episodic';
  return 'cluster';
}

/**
 * @param {string} root
 * @param {{ includeArchive?: boolean }} [opts]
 * @returns {{ abs: string, rel: string, scope: MemoryScope }[]}
 */
export function listMemoryFiles(root, opts = {}) {
  const includeArchive = opts.includeArchive === true;
  const maxFiles = opts.maxFiles ?? MAX_FILES_SCAN;
  /** @type {{ abs: string, rel: string, scope: MemoryScope }[]} */
  const out = [];
  const seen = new Set();
  let truncated = false;

  /**
   * @param {string} absDir
   * @param {(rel: string) => boolean} [filter]
   */
  function walk(absDir, filter) {
    if (out.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (!fs.existsSync(absDir)) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    // Stable order for deterministic caps.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (out.length >= maxFiles) {
        truncated = true;
        return;
      }
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR.has(ent.name)) continue;
        if (!includeArchive && ent.name === '_archive') continue;
        walk(abs, filter);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (filter && !filter(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push({ abs, rel, scope: classifyPath(rel) });
    }
  }

  walk(path.join(root, '.spire', 'company'));
  walk(path.join(root, '.spire', 'clusters', 'tech', 'context'));
  walk(path.join(root, '.spire', 'clusters', 'tech', 'state'));
  walk(path.join(root, '.spire', 'clusters', 'tech', 'contracts'), (rel) => {
    if (!includeArchive && rel.includes('/contracts/_archive/')) return false;
    // Skip generated packs — they restate context.
    if (rel.endsWith('/_context-pack.md') || rel.endsWith('_context-pack.md')) return false;
    return true;
  });
  // Dated handovers live in the consumer evidence-notes tree (same join as continuity.mjs).
  const evidenceNotes = path.join(root, 'docs');
  walk(evidenceNotes, (rel) => /HANDOVER/i.test(path.basename(rel)));
  // Root-level handover if any
  for (const name of ['HANDOVER.md', 'handover.md']) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const rel = name;
      if (!seen.has(rel)) {
        seen.add(rel);
        out.push({ abs, rel, scope: 'episodic' });
      }
    }
  }

  const sorted = out.sort((a, b) => a.rel.localeCompare(b.rel));
  sorted.truncated = truncated;
  return sorted;
}

/**
 * @param {string} root
 * @param {string} query
 * @param {{ limit?: number, scopes?: MemoryScope[] | null, includeArchive?: boolean, maxFileBytes?: number }} [opts]
 */
export function queryMemory(root, query, opts = {}) {
  const terms = tokenizeQuery(query);
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const scopes = opts.scopes && opts.scopes.length > 0 ? new Set(opts.scopes) : null;
  const maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES;
  const files = listMemoryFiles(root, { includeArchive: opts.includeArchive });
  /** @type {{ path: string, scope: MemoryScope, score: number, line: number, excerpt: string }[]} */
  const hits = [];
  let skipped_large = 0;
  let skipped_unreadable = 0;

  for (const file of files) {
    if (scopes && !scopes.has(file.scope)) continue;
    let st;
    try {
      st = fs.statSync(file.abs);
    } catch {
      skipped_unreadable += 1;
      continue;
    }
    if (st.size > maxFileBytes) {
      skipped_large += 1;
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(file.abs, 'utf8');
    } catch {
      skipped_unreadable += 1;
      continue;
    }
    const body = scoreText(text, terms);
    if (!body) continue;
    let score = body.score;
    const pathLower = file.rel.toLowerCase();
    for (const term of terms) {
      if (pathLower.includes(term)) score += 5;
    }
    hits.push({
      path: file.rel,
      scope: file.scope,
      score,
      line: body.line,
      excerpt: body.excerpt,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    query: String(query),
    terms,
    limit,
    scopes: scopes ? [...scopes] : null,
    include_archive: opts.includeArchive === true,
    result_count: Math.min(limit, hits.length),
    results: hits.slice(0, limit),
    scanned_files: files.length,
    skipped_large,
    skipped_unreadable,
    scan_truncated: Boolean(files.truncated),
    max_file_bytes: maxFileBytes,
  };
}

/**
 * @param {string[]} argv
 * @returns {{ q: string | null, limit: number, scopes: MemoryScope[] | null, includeArchive: boolean, help: boolean, error: string | null }}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  /** @type {string | null} */
  let q = null;
  let limit = DEFAULT_LIMIT;
  /** @type {MemoryScope[] | null} */
  let scopes = null;
  let includeArchive = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      help = true;
      continue;
    }
    if (a === '--q' || a === '-q') {
      q = args[++i] ?? null;
      continue;
    }
    if (a === '--limit' || a === '-n') {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n < 1) return { q, limit, scopes, includeArchive, help, error: 'invalid --limit' };
      limit = Math.floor(n);
      continue;
    }
    if (a === '--scope' || a === '--scopes') {
      const raw = args[++i] ?? '';
      const parts = raw.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const allowed = new Set(['company', 'cluster', 'branch', 'feature', 'episodic']);
      const bad = parts.filter((p) => !allowed.has(p));
      if (bad.length) {
        return {
          q, limit, scopes, includeArchive, help,
          error: `unknown scope(s): ${bad.join(', ')} (use company|cluster|branch|feature|episodic)`,
        };
      }
      scopes = /** @type {MemoryScope[]} */ (parts);
      continue;
    }
    if (a === '--include-archive') {
      includeArchive = true;
      continue;
    }
    if (a.startsWith('-')) {
      return { q, limit, scopes, includeArchive, help, error: `unknown flag: ${a}` };
    }
    // Positional query fallback
    if (q === null) q = a;
    else q = `${q} ${a}`;
  }
  return { q, limit, scopes, includeArchive, help, error: null };
}

function usage() {
  return [
    'usage: node memory_query.mjs --q "terms" [--limit 8] [--scope cluster,feature] [--include-archive]',
    '       node gates.mjs memory_query --q "terms" …',
    '',
    'Scopes: company | cluster | branch | feature | episodic',
    'Searches seam markdown (context, state, contracts, optional company) and dated HANDOVER notes.',
    'Files are truth; this tool is retrieval only.',
  ].join('\n');
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, stdout?: (s: string) => void }} [opts]
 */
export function main(argv = process.argv, { root = ROOT, stdout = (s) => process.stdout.write(s) } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    stdout(`${usage()}\n`);
    return 2;
  }
  if (parsed.error) {
    stdout(`${parsed.error}\n${usage()}\n`);
    return 2;
  }
  if (!parsed.q || !String(parsed.q).trim()) {
    stdout(`missing --q query\n${usage()}\n`);
    return 2;
  }
  const terms = tokenizeQuery(parsed.q);
  if (terms.length === 0) {
    stdout(`query has no usable terms (need tokens ≥2 chars)\n${usage()}\n`);
    return 2;
  }

  const payload = queryMemory(root, parsed.q, {
    limit: parsed.limit,
    scopes: parsed.scopes,
    includeArchive: parsed.includeArchive,
  });
  stdout(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
