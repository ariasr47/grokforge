#!/usr/bin/env node
// gates.mjs — single-process entrypoint for delivery gates + preflight tools.
//
// It ROUTES ONLY: any behavior difference between `gates.mjs <tool> ARGS` and
// `node <tool>.mjs ARGS` is a bug in this file. Node builtins only.
//
// Performance (2026-08-12 production hardening):
// - Tools are **lazy-loaded** so a single-tool call no longer pays import cost for every gate.
// - Optional **batch** mode runs several tools in one process (amortizes Node boot for conductors).
//
//   node .grok/tools/gates.mjs contract_lint --canon-only
//   node .grok/tools/gates.mjs memory_query --q "…"
//   node .grok/tools/gates.mjs batch contract_lint --canon-only -- continuity list
//   node .grok/tools/gates.mjs batch --json continuity list -- project_standup_ready

import { pathToFileURL } from 'node:url';

const TOOL_SPECS = Object.freeze({
  continuity: './continuity.mjs',
  contract_lint: './contract_lint.mjs',
  context_for: './context_for.mjs',
  council_conflicts: './council_conflicts.mjs',
  design_system_ready: './design_system_ready.mjs',
  foundation_ready: './foundation_ready.mjs',
  interface_conformance: './interface_conformance.mjs',
  ledger_tally: './ledger_tally.mjs',
  memory_query: './memory_query.mjs',
  project_standup_ready: './project_standup_ready.mjs',
});

const TOOL_NAMES = Object.keys(TOOL_SPECS);

/**
 * @param {string} name
 * @returns {Promise<(argv: string[]) => number | Promise<number>>}
 */
export async function loadToolMain(name) {
  if (!Object.hasOwn(TOOL_SPECS, name)) {
    throw new Error(`unknown tool: ${name}`);
  }
  const mod = await import(TOOL_SPECS[name]);
  if (typeof mod.main !== 'function') {
    throw new Error(`tool ${name} has no main() export`);
  }
  return mod.main;
}

function usage() {
  return [
    `usage: node gates.mjs [--timing] <${TOOL_NAMES.join('|')}> [args…]`,
    '       node gates.mjs batch [--json] <tool> [args…] [-- <tool> [args…]]…',
    '',
    'Tools are lazy-loaded (one import per named tool). --timing or SPIRE_GATES_TIMING=1',
    'prints wall time on stderr. batch amortizes Node boot across several tools;',
    'exit code is the max child exit. batch --json captures per-tool stdout.',
  ].join('\n');
}

/**
 * Split argv into tool runs separated by standalone `--`.
 * @param {string[]} tokens
 * @returns {{ tool: string, args: string[] }[] | { error: string }}
 */
export function parseBatchRuns(tokens) {
  /** @type {{ tool: string, args: string[] }[]} */
  const runs = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === '--') {
      i += 1;
      continue;
    }
    const tool = tokens[i];
    if (!tool || !Object.hasOwn(TOOL_SPECS, tool)) {
      return { error: `batch: unknown or missing tool at position ${i}: ${tool ?? '(end)'}` };
    }
    i += 1;
    const args = [];
    while (i < tokens.length && tokens[i] !== '--') {
      args.push(tokens[i]);
      i += 1;
    }
    runs.push({ tool, args });
  }
  if (runs.length === 0) return { error: 'batch: need at least one tool' };
  return runs;
}

/**
 * @param {string} tool
 * @param {string[]} args
 * @param {{ capture?: boolean }} [opts]
 */
/**
 * Tools disagree on argv shape (historical):
 * - process.argv style [node, script, ...args] with slice(2): continuity, memory_query, readiness tools
 * - script-first [script, ...args] with argv[1]/slice(1): contract_lint, context_for, council, conformance
 */
const PROCESS_ARGV_TOOLS = new Set([
  'continuity',
  'memory_query',
  'design_system_ready',
  'foundation_ready',
  'project_standup_ready',
]);

function toolArgv(tool, args) {
  if (PROCESS_ARGV_TOOLS.has(tool)) {
    return [process.execPath || 'node', `${tool}.mjs`, ...args];
  }
  return [`${tool}.mjs`, ...args];
}

async function runOne(tool, args, opts = {}) {
  const mainFn = await loadToolMain(tool);
  const argv = toolArgv(tool, args);
  if (!opts.capture) {
    const code = await mainFn(argv);
    return { tool, args, exit: typeof code === 'number' ? code : 0, stdout: null };
  }
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, enc, cb) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString(typeof enc === 'string' ? enc : 'utf8');
    chunks.push(text);
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };
  let code = 0;
  try {
    const result = await mainFn(argv);
    code = typeof result === 'number' ? result : 0;
  } finally {
    process.stdout.write = originalWrite;
  }
  return { tool, args, exit: code, stdout: chunks.join('') };
}

/**
 * @param {string[]} argv
 */
export async function main(argv = process.argv) {
  const tokens = argv.slice(2);
  if (tokens.length === 0 || tokens[0] === '-h' || tokens[0] === '--help') {
    console.log(usage());
    return 2;
  }

  if (tokens[0] === 'batch') {
    let json = false;
    let rest = tokens.slice(1);
    if (rest[0] === '--json') {
      json = true;
      rest = rest.slice(1);
    }
    const parsed = parseBatchRuns(rest);
    if (!Array.isArray(parsed)) {
      console.error(parsed.error);
      console.log(usage());
      return 2;
    }
    /** @type {{ tool: string, args: string[], exit: number, stdout: string | null }[]} */
    const results = [];
    let maxExit = 0;
    for (const run of parsed) {
      if (!json) {
        console.error(`[gates batch] → ${run.tool}${run.args.length ? ` ${run.args.join(' ')}` : ''}`);
      }
      const result = await runOne(run.tool, run.args, { capture: json });
      if (json) {
        results.push(result);
      } else if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.exit > maxExit) maxExit = result.exit;
      if (!json && result.exit !== 0) {
        console.error(`[gates batch] ${run.tool} exited ${result.exit}`);
      }
    }
    if (json) {
      console.log(JSON.stringify({ ok: maxExit === 0, max_exit: maxExit, results }, null, 2));
    }
    return maxExit;
  }

  let timing = false;
  let restTokens = tokens;
  if (restTokens[0] === '--timing') {
    timing = true;
    restTokens = restTokens.slice(1);
  }
  const [sub, ...rest] = restTokens;
  // Allow `gates.mjs contract_lint --timing` as well as `gates.mjs --timing contract_lint`.
  const toolArgs = rest.filter((t) => {
    if (t === '--timing') {
      timing = true;
      return false;
    }
    return true;
  });
  if (!Object.hasOwn(TOOL_SPECS, sub)) {
    console.log(usage());
    if (sub) console.log(`  unknown tool: ${sub}`);
    return 2;
  }
  const mainFn = await loadToolMain(sub);
  const t0 = performance.now();
  const code = await mainFn(toolArgv(sub, toolArgs));
  if (timing || process.env.SPIRE_GATES_TIMING === '1') {
    console.error(`[gates] ${sub} ${Math.round(performance.now() - t0)}ms`);
  }
  return typeof code === 'number' ? code : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main(process.argv);
}
