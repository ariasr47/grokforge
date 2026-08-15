#!/usr/bin/env node
// foundation_ready.mjs — model-free preflight hints for optional foundation bootstrap.
//
// Exit 0 when the consumer root is assessable. Exit 1 only if .spire seam is missing.
// Exit 2 on usage errors. Never forces Nx.
//
// Usage:
//   node foundation_ready.mjs
//   node gates.mjs foundation_ready

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');

/**
 * @param {{
 *   hasStateRoot: boolean,
 *   hasGit: boolean,
 *   hasCiWorkflow: boolean,
 *   hasNxConfig: boolean,
 *   hasPackageJson: boolean,
 *   hasPnpmWorkspace: boolean,
 *   hasNpmWorkspaces: boolean,
 * }} input
 */
export function assessFoundationReady(input) {
  const findings = [];
  const invites = [];

  if (!input.hasStateRoot) {
    return {
      ready: false,
      suggested_shape: null,
      findings: ['missing .spire/clusters/tech — install Spire first'],
      invites: [],
    };
  }

  if (!input.hasGit) {
    invites.push('git init available (only if human rules foundation module M1)');
  } else {
    findings.push('git metadata present — do not re-init without an explicit ask');
  }

  if (!input.hasCiWorkflow) {
    invites.push('CI workflow missing — offer GitHub Actions only after Decision card');
  } else {
    findings.push('CI workflows present — prefer document/verify over rewrite');
  }

  let suggested_shape = 'single-or-document';
  if (input.hasNxConfig) {
    suggested_shape = 'document-nx';
    findings.push('Nx config present — default to document-only unless human requests migration');
  } else if (input.hasPnpmWorkspace || input.hasNpmWorkspaces) {
    suggested_shape = 'document-workspaces';
    findings.push('workspace config present — default to document-only');
  } else if (input.hasPackageJson) {
    suggested_shape = 'single-package';
    invites.push('single package.json — monorepo tools (including Nx) are opt-in Decision cards only');
  } else {
    suggested_shape = 'greenfield';
    invites.push('no package.json at root — greenfield foundation; choose shape via cards (Nx never forced)');
  }

  return {
    ready: true,
    suggested_shape,
    findings,
    invites,
  };
}

export function main(argv = process.argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('usage: node foundation_ready.mjs [--json]\n       node gates.mjs foundation_ready [--json]');
    return 2;
  }
  const asJson = argv.includes('--json');

  let hasNpmWorkspaces = false;
  const pkgPath = path.join(ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      hasNpmWorkspaces = Boolean(pkg.workspaces);
    } catch {
      hasNpmWorkspaces = false;
    }
  }

  const result = assessFoundationReady({
    hasStateRoot: fs.existsSync(STATE_ROOT),
    hasGit: fs.existsSync(path.join(ROOT, '.git')),
    hasCiWorkflow: fs.existsSync(path.join(ROOT, '.github', 'workflows')),
    hasNxConfig: fs.existsSync(path.join(ROOT, 'nx.json')) || fs.existsSync(path.join(ROOT, 'workspace.json')),
    hasPackageJson: fs.existsSync(pkgPath),
    hasPnpmWorkspace: fs.existsSync(path.join(ROOT, 'pnpm-workspace.yaml')),
    hasNpmWorkspaces,
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return result.ready ? 0 : 1;
  }

  console.log(
    `foundation_ready — ${result.ready ? 'READY' : 'BLOCKED'}`
    + (result.suggested_shape ? ` suggested_shape=${result.suggested_shape}` : ''),
  );
  for (const line of result.findings) console.log(`  ! ${line}`);
  for (const line of result.invites) console.log(`  · ${line}`);
  if (result.ready) {
    console.log('  OK to run foundation/FOUNDATION_BOOTSTRAP_METHOD.md (optional git/CI/monorepo; Nx opt-in) (or foundation/FOUNDATION_BOOTSTRAP_METHOD.md) if the human opts in.');
    console.log('  Nx is never default — only after an explicit monorepo-shape Decision card.');
  } else {
    console.log('  Install Spire into this consumer first.');
  }
  return result.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
