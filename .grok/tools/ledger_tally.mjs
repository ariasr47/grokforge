#!/usr/bin/env node
// ledger_tally.mjs — the DETECT step of compounding memory (ORCHESTRATOR §3, GATE S), as code.
//
// GATE S must count key recurrence across the ledger before promoting. Counting is mechanical,
// and it used to run as model work inside the longest-lived context in the system (the conductor);
// this script replaces that. It TALLIES ONLY — whether a graduating key's prose reads right, and
// writing it into the canon, stay the conductor's judgement (dispatcher-minus-one spec, C3/D5).
//
//   node .grok/tools/gates.mjs ledger_tally
//
// Threshold (DECISION_LEDGER.md "Promotion rule"): a key in >=3 distinct shipped features, OR >=2
// when every instance is binding:yes, GRADUATES. Keys already in the Promoted canon are excluded.
// Exit 0 always on a parseable ledger (advisory); exit 2 when the ledger is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = path.join(ROOT, '.spire', 'clusters', 'tech', 'context', 'DECISION_LEDGER.md');

function tableRows(text, heading) {
  // Rows of the pipe table under `heading`, up to the next ## heading. Skips the header row,
  // the |---| separator, and _(none yet)_ placeholders.
  // NOTE: the lookahead's end-of-input branch is `(?![\s\S])`, not a bare `$` — this regex needs
  // `^` to match line-starts (so the heading can be found anywhere in the doc) but with the `m`
  // flag on, a bare `$` also matches at every line ending, not just end-of-string. That made the
  // lazy `[\s\S]*?` stop after the heading's own line every time. `(?![\s\S])` means "no character
  // follows" — true only at the real end of the string, regardless of the `m` flag.
  const section = new RegExp(`^##\\s+${heading}[\\s\\S]*?(?=\\n##\\s|(?![\\s\\S]))`, 'm').exec(text);
  if (!section) return [];
  return section[0]
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 2 && !/^-+$/.test(cells[0]) && cells[0] !== 'key'
      && !cells[0].includes('_(none yet)_'));
}

export function main() {
  if (!fs.existsSync(LEDGER)) {
    console.log('ledger_tally — .spire/clusters/tech/context/DECISION_LEDGER.md not found');
    return 2;
  }
  const text = fs.readFileSync(LEDGER, 'utf8');
  const promoted = new Set(tableRows(text, 'Promoted canon').map((c) => c[0].replace(/`/g, '')));
  // Demoted keys' earning rows deliberately stay in the Ledger (provenance) — a demoted key must
  // never re-graduate at a later GATE S, so it is excluded from the tally the same as a promoted one.
  const demoted = new Set(tableRows(text, 'Demoted').map((c) => c[0].replace(/`/g, '')));
  const rows = tableRows(text, 'Ledger');

  const keys = new Map(); // key -> { features: Set, allBinding: bool }
  for (const [rawKey, feature, , , binding] of rows) {
    // The canon table REQUIRES backticked keys (contract_lint's CANON_KEY_RE); a Ledger row may or
    // may not carry them. Strip on both sides of the comparison so a backticked row key still
    // matches an already-promoted/demoted key instead of re-appearing in the tally.
    const key = rawKey.replace(/`/g, '');
    if (promoted.has(key) || demoted.has(key)) continue;
    const entry = keys.get(key) ?? { features: new Set(), allBinding: true };
    entry.features.add(feature);
    if (!/^\s*(binding:)?yes\s*$/i.test(binding ?? '')) entry.allBinding = false;
    keys.set(key, entry);
  }

  console.log(`ledger_tally — ${keys.size} unpromoted key(s) in the ledger`);
  const sorted = [...keys.entries()].sort((a, b) => b[1].features.size - a[1].features.size);
  for (const [key, { features, allBinding }] of sorted) {
    const n = features.size;
    const graduates = n >= 3 || (n >= 2 && allBinding);
    const label = graduates ? 'GRADUATES' : 'watch';
    const plural = n === 1 ? 'feature' : 'features';
    console.log(`  ${label}  ${key}  (${n} ${plural}${allBinding ? ', all binding' : ''})`);
  }
  return 0;
}

// Direct invocation (gates.mjs calls main() via import).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
