#!/usr/bin/env node
// gates.mjs — single-process entrypoint for delivery gates + design_system_ready preflight.
//
// It ROUTES ONLY: any behavior difference between `gates.mjs <tool> ARGS` and
// `node <tool>.mjs ARGS` is a bug in this file. Node builtins only.
//
// HONEST PERFORMANCE NOTE (measured 2026-08-07, correcting this header's original claim).
// The file was introduced to amortize Node's boot across several gates, and its header used to
// state that as an achieved property. It is not one under the shipped usage pattern: every call
// site invokes ONE tool per process, and because the imports below are eager, a single-tool call
// pays the import cost of all five (interface_conformance alone is ~8ms, roughly twice its
// siblings). Measured over 10 runs each, routing through this file is 3-8ms SLOWER per call than
// invoking the tool directly. The node-gate-port plan predicted exactly this ("the REAL win needs
// one process running several gates, which the conductor gets by chaining subcommands in future
// work") — that chaining was never built. The amortization is available, not delivered: it needs a
// batch mode that runs several named gates in one process at one gateway. Until then this file
// earns its place as a single stable entry point, not as a speed-up.
//
//   node .grok/tools/gates.mjs contract_lint --canon-only
//   node .grok/tools/gates.mjs context_for {FEATURE} --write
//   node .grok/tools/gates.mjs council_conflicts {FEATURE}
//   node .grok/tools/gates.mjs interface_conformance --contract … --url …
//   node .grok/tools/gates.mjs ledger_tally

import { main as contractLint } from './contract_lint.mjs';
import { main as contextFor } from './context_for.mjs';
import { main as councilConflicts } from './council_conflicts.mjs';
import { main as designSystemReady } from './design_system_ready.mjs';
import { main as interfaceConformance } from './interface_conformance.mjs';
import { main as ledgerTally } from './ledger_tally.mjs';

const TOOLS = {
  contract_lint: contractLint,
  context_for: contextFor,
  council_conflicts: councilConflicts,
  design_system_ready: designSystemReady,
  interface_conformance: interfaceConformance,
  ledger_tally: ledgerTally,
};

const [sub, ...rest] = process.argv.slice(2);
if (!sub || !Object.hasOwn(TOOLS, sub)) {
  console.log(`usage: node gates.mjs <${Object.keys(TOOLS).join('|')}> [args…]`);
  if (sub) console.log(`  unknown tool: ${sub}`);
  process.exitCode = 2;
} else {
  process.exitCode = await TOOLS[sub]([`${sub}.mjs`, ...rest]);
}
export {};
