#!/usr/bin/env node
// continuity.mjs — model-free continuity status for Tier-2 RESUME and Tier-3 dated handovers.
//
// Status vocabulary:
//   Handover (dated HANDOVER- plus ISO date, or bare HANDOVER.md):
//     LIVE | SUPERSEDED | CONSUMED
//   RESUME (state/<slug>/RESUME.md under the neutral seam, or legacy host RESUME.md):
//     ACTIVE | CONSUMED
//
// Retention: dated handovers are never deleted (immutable evidence). RESUME may be
// marked CONSUMED or deleted with --delete after boot absorbs it.
//
// Usage (from the installed tools directory on a consumer, or via gates.mjs continuity):
//   node continuity.mjs list
//   node continuity.mjs mark-consumed <rel-path> [--delete]
//   node continuity.mjs mark-superseded <rel-path>
//   node continuity.mjs mark-live <rel-path>          # handovers only
//   node continuity.mjs mark-active <rel-path>        # RESUME only
//   node gates.mjs continuity list
//
// Node builtins only. Consumer root = two levels above tools/ (provider root parent).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');

const HANDOVER_STATUSES = new Set(['LIVE', 'SUPERSEDED', 'CONSUMED']);
const RESUME_STATUSES = new Set(['ACTIVE', 'CONSUMED']);

// Accept both `**Label:** VALUE` and `**Label**: VALUE` (colon inside or outside bold).
const HANDOVER_STATUS_RE =
  /^\*\*(?:Continuity status|Handover status|Status):?\*\*:?\s*(LIVE|SUPERSEDED|CONSUMED)\b/im;
const RESUME_STATUS_RE =
  /^\*\*(?:Resume status|Status):?\*\*:?\s*(ACTIVE|CONSUMED)\b/im;
const HANDOVER_NAME_RE = /^(?:HANDOVER|handover)(?:-(\d{4}-\d{2}-\d{2}))?(?:\.md)?$/i;

/**
 * @param {string} name
 * @returns {{ kind: 'handover', date: string|null } | { kind: 'resume' } | null}
 */
export function classifyName(name) {
  const base = path.basename(name);
  if (/^RESUME\.md$/i.test(base)) return { kind: 'resume' };
  const m = base.match(HANDOVER_NAME_RE);
  if (m) return { kind: 'handover', date: m[1] ?? null };
  // HANDOVER- plus ISO date filename (any parent directory)
  const m2 = base.match(/^HANDOVER-(\d{4}-\d{2}-\d{2})\.md$/i);
  if (m2) return { kind: 'handover', date: m2[1] };
  return null;
}

/**
 * @param {string} text
 * @param {'handover'|'resume'} kind
 */
export function parseStatus(text, kind) {
  if (kind === 'handover') {
    const m = text.match(HANDOVER_STATUS_RE);
    return m ? m[1].toUpperCase() : null;
  }
  const m = text.match(RESUME_STATUS_RE);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Insert or replace the status line near the top of the file.
 * @param {string} text
 * @param {'handover'|'resume'} kind
 * @param {string} status
 * @param {string} [when] ISO date YYYY-MM-DD
 */
export function applyStatus(text, kind, status, when = new Date().toISOString().slice(0, 10)) {
  const want = kind === 'handover'
    ? `**Continuity status:** ${status} (as of ${when})`
    : `**Resume status:** ${status} (as of ${when})`;
  const re = kind === 'handover' ? HANDOVER_STATUS_RE : RESUME_STATUS_RE;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
    if (re.test(lines[i])) {
      lines[i] = want;
      return `${lines.join('\n')}${text.endsWith('\n') ? '' : ''}`;
    }
  }
  // Insert after first heading line (or at top).
  let insertAt = 0;
  if (lines[0]?.startsWith('#')) {
    insertAt = 1;
    if (lines[1] === '') insertAt = 2;
  }
  lines.splice(insertAt, 0, want, '');
  return `${lines.join('\n')}`;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '_archive') continue;
      walkFiles(abs, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Discover continuity artifacts under a consumer root.
 * @param {string} root
 */
export function listContinuity(root) {
  const items = [];
  const docs = path.join(root, 'docs');
  const state = path.join(root, '.spire', 'clusters', 'tech', 'state');
  const legacyResume = path.join(root, '.claude', 'RESUME.md');
  const codexResume = path.join(root, '.codex', 'RESUME.md');

  const candidates = [
    ...walkFiles(docs).filter((p) => /HANDOVER/i.test(path.basename(p))),
    ...walkFiles(state).filter((p) => /RESUME\.md$/i.test(path.basename(p))),
  ];
  if (fs.existsSync(legacyResume)) candidates.push(legacyResume);
  if (fs.existsSync(codexResume)) candidates.push(codexResume);
  // root-level HANDOVER.md
  for (const name of ['HANDOVER.md', 'handover.md']) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) candidates.push(p);
  }

  const seen = new Set();
  for (const abs of candidates) {
    const norm = path.resolve(abs);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const kindInfo = classifyName(path.basename(abs));
    if (!kindInfo) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const status = parseStatus(text, kindInfo.kind);
    items.push({
      path: rel,
      absolute: abs,
      kind: kindInfo.kind,
      date: kindInfo.kind === 'handover' ? kindInfo.date : null,
      status,
      inferred: status === null,
    });
  }

  // Infer only when status is absent: newest dated handover → LIVE; older undated/null → SUPERSEDED.
  // Never override an explicit Continuity status line.
  const handovers = items.filter((i) => i.kind === 'handover');
  const hasExplicitLive = handovers.some((i) => i.status === 'LIVE' && !i.inferred);
  const nullHandovers = handovers.filter((i) => i.status === null);
  if (nullHandovers.length > 0) {
    const datedNull = nullHandovers.filter((i) => i.date).sort((a, b) => b.date.localeCompare(a.date));
    const newestNull = datedNull[0] ?? nullHandovers[0];
    for (const h of nullHandovers) {
      if (!hasExplicitLive && h.path === newestNull.path) {
        h.status = 'LIVE';
        h.inferred = true;
      } else {
        h.status = 'SUPERSEDED';
        h.inferred = true;
      }
    }
  }

  for (const r of items.filter((i) => i.kind === 'resume')) {
    if (r.status === null) {
      r.status = 'ACTIVE';
      r.inferred = true;
    }
  }

  return items.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Doctor notes for continuity hygiene.
 * @param {string} root
 */
export function continuityNotes(root) {
  const notes = [];
  const items = listContinuity(root);
  const live = items.filter((i) => i.kind === 'handover' && i.status === 'LIVE');
  if (live.length > 1) {
    notes.push(
      `multiple LIVE handovers (${live.map((i) => i.path).join(', ')}) — keep at most one LIVE; mark others SUPERSEDED`,
    );
  }
  const activeResumes = items.filter((i) => i.kind === 'resume' && i.status === 'ACTIVE');
  for (const r of activeResumes) {
    notes.push(
      `ACTIVE resume at ${r.path} — after conductor re-orientation, run: node tools/continuity.mjs mark-consumed ${r.path}  (or --delete)`,
    );
  }
  const unscoped = items.find((i) => {
    if (i.kind !== 'resume' || i.status !== 'ACTIVE') return false;
    const parts = i.path.split('/');
    // Host-root RESUME (provider root / RESUME.md) rather than seam state/<slug>/RESUME.md
    return parts.length === 2 && parts[1].toUpperCase() === 'RESUME.MD';
  });
  if (unscoped) {
    notes.push(
      `unscoped ${unscoped.path} is ACTIVE — prefer seam state/<branch-slug>/RESUME.md; mark-consumed or move when done`,
    );
  }
  return notes;
}

function usage() {
  return [
    'usage: node continuity.mjs list [--json]',
    '       node continuity.mjs mark-consumed <rel-path> [--delete]',
    '       node continuity.mjs mark-superseded <rel-path>',
    '       node continuity.mjs mark-live <rel-path>',
    '       node continuity.mjs mark-active <rel-path>',
  ].join('\n');
}

function resolveRel(root, rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
    throw new Error(`unsafe path: ${rel}`);
  }
  const abs = path.resolve(root, ...rel.split(/[\\/]/));
  if (!abs.startsWith(path.resolve(root))) throw new Error(`path escapes root: ${rel}`);
  return abs;
}

/**
 * @param {string[]} argv
 * @param {{ root?: string }} [opts]
 */
export function main(argv = process.argv, { root = ROOT } = {}) {
  const args = argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(usage());
    return 2;
  }

  if (cmd === 'list') {
    const asJson = args.includes('--json');
    const items = listContinuity(root);
    const notes = continuityNotes(root);
    if (asJson) {
      console.log(JSON.stringify({
        artifacts: items.map((item) => ({
          kind: item.kind,
          status: item.status,
          path: item.path,
          date: item.date,
          inferred: item.inferred,
        })),
        notes,
      }, null, 2));
      return 0;
    }
    if (items.length === 0) {
      console.log('continuity — no RESUME or HANDOVER artifacts found');
      return 0;
    }
    console.log('continuity — artifacts');
    for (const item of items) {
      const flag = item.inferred ? ' (inferred)' : '';
      const date = item.date ? ` date=${item.date}` : '';
      console.log(`  ${item.kind.padEnd(8)} ${String(item.status).padEnd(10)}${flag}${date}  ${item.path}`);
    }
    if (notes.length) {
      console.log('notes:');
      for (const n of notes) console.log(`  - ${n}`);
    }
    return 0;
  }

  const rel = args[1];
  if (!rel) {
    console.error(usage());
    return 2;
  }
  const abs = resolveRel(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`continuity: file not found: ${rel}`);
    return 1;
  }
  const kindInfo = classifyName(path.basename(abs));
  if (!kindInfo) {
    console.error(`continuity: not a RESUME.md or HANDOVER*.md: ${rel}`);
    return 1;
  }

  const del = args.includes('--delete');
  let nextStatus;
  if (cmd === 'mark-consumed') {
    nextStatus = kindInfo.kind === 'resume' ? 'CONSUMED' : 'CONSUMED';
  } else if (cmd === 'mark-superseded') {
    if (kindInfo.kind !== 'handover') {
      console.error('continuity: mark-superseded is only for dated handovers');
      return 2;
    }
    nextStatus = 'SUPERSEDED';
  } else if (cmd === 'mark-live') {
    if (kindInfo.kind !== 'handover') {
      console.error('continuity: mark-live is only for handovers');
      return 2;
    }
    nextStatus = 'LIVE';
  } else if (cmd === 'mark-active') {
    if (kindInfo.kind !== 'resume') {
      console.error('continuity: mark-active is only for RESUME.md');
      return 2;
    }
    nextStatus = 'ACTIVE';
  } else {
    console.error(usage());
    return 2;
  }

  if (cmd === 'mark-consumed' && del && kindInfo.kind === 'resume') {
    fs.unlinkSync(abs);
    console.log(`continuity — deleted ${rel}`);
    return 0;
  }
  if (cmd === 'mark-consumed' && del && kindInfo.kind === 'handover') {
    console.error('continuity: refusing --delete on dated handover (retention: never prune dated docs); use mark-consumed without --delete');
    return 2;
  }

  if (kindInfo.kind === 'handover' && !HANDOVER_STATUSES.has(nextStatus)) {
    console.error(`invalid handover status ${nextStatus}`);
    return 2;
  }
  if (kindInfo.kind === 'resume' && !RESUME_STATUSES.has(nextStatus)) {
    console.error(`invalid resume status ${nextStatus}`);
    return 2;
  }

  // When promoting a handover to LIVE, supersede other LIVE handovers.
  if (cmd === 'mark-live') {
    for (const item of listContinuity(root)) {
      if (item.kind === 'handover' && item.status === 'LIVE' && item.path !== rel.replaceAll('\\', '/')) {
        const otherAbs = item.absolute;
        const otherText = fs.readFileSync(otherAbs, 'utf8');
        fs.writeFileSync(otherAbs, applyStatus(otherText, 'handover', 'SUPERSEDED'));
        console.log(`continuity — ${item.path} → SUPERSEDED`);
      }
    }
  }

  const text = fs.readFileSync(abs, 'utf8');
  const next = applyStatus(text, kindInfo.kind, nextStatus);
  fs.writeFileSync(abs, next.endsWith('\n') ? next : `${next}\n`);
  console.log(`continuity — ${rel} → ${nextStatus}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(`continuity: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
