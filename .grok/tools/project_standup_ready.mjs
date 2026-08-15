#!/usr/bin/env node
// project_standup_ready.mjs — model-free preflight for product stand-up (context + backlog).
//
// Exit 0 when the seam is usable for standup/PROJECT_STANDUP_METHOD.md (product context + backlog onboarding) (including "context is still a stub").
// Exit 1 when the install/seam is missing or project.json is unreadable with no path forward.
// Exit 2 on usage errors.
//
// Usage:
//   node project_standup_ready.mjs
//   node gates.mjs project_standup_ready

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectConfig } from './_project.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');

const TEMPLATE_NAMES = new Set(['MyProject', '{PROJECT}', '']);
const CONTEXT_PLACEHOLDER_RE = /<What this product is|\{PROJECT\}|<\s*entry point/i;
const BACKLOG_PLACEHOLDER_RE = /<The chosen feature|<Promoted candidates|<Buildable now/i;

/**
 * @param {string} text
 * @param {string} headingStart e.g. "1."
 */
export function sectionBody(text, headingStart) {
  const headerRe = new RegExp(`^##\\s*${headingStart.replace('.', '\\.')}[^\\n]*\\r?\\n`, 'm');
  const hm = headerRe.exec(text);
  if (!hm) return '';
  const rest = text.slice(hm.index + hm[0].length);
  const next = rest.search(/\r?\n##\s/);
  const body = next === -1 ? rest : rest.slice(0, next);
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/**
 * @param {string} dirAbs
 * @param {number} depth
 */
function hasSourceEvidence(dirAbs, depth = 0) {
  if (depth > 5) return false;
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return false;
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }
    const full = path.join(dirAbs, entry.name);
    if (entry.isFile()) {
      if (/\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|vue|svelte)$/i.test(entry.name)) return true;
      if (/^(package|pyproject|cargo|go)\.mod/i.test(entry.name)) return true;
      if (entry.name === 'package.json' || entry.name === 'go.mod' || entry.name === 'Cargo.toml') return true;
    } else if (entry.isDirectory() && hasSourceEvidence(full, depth + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {{
 *   hasStateRoot: boolean,
 *   project: object,
 *   contextText: string,
 *   backlogText: string,
 *   backendHasCode: boolean,
 *   frontendHasCode: boolean,
 *   hasGit: boolean,
 *   hasCiWorkflow: boolean,
 *   hasNxConfig: boolean,
 * }} input
 */
export function assessProjectStandupReady(input) {
  const findings = [];
  const invites = [];

  if (!input.hasStateRoot) {
    return {
      ready: false,
      context_mode: null,
      scope_default: 'both',
      context_stub: true,
      backlog_stub: true,
      foundation_invite: false,
      findings: ['missing .spire/clusters/tech — install Spire into this consumer first'],
      invites: [],
    };
  }

  const project = input.project && typeof input.project === 'object' ? input.project : {};
  if (Object.keys(project).length === 0) {
    findings.push('project.json missing or empty — create the seam project.json before inventing architecture');
  } else {
    if (Object.hasOwn(project, '_comment')) {
      findings.push('project.json still has template _comment — replace with real project fields when known');
    }
    const name = typeof project.project_name === 'string' ? project.project_name.trim() : '';
    if (TEMPLATE_NAMES.has(name)) {
      findings.push(`project_name is still a template value (${JSON.stringify(name || '(empty)')}) — stand-up may propose a name via Decision card`);
    }
  }

  const contextText = typeof input.contextText === 'string' ? input.contextText : '';
  const backlogText = typeof input.backlogText === 'string' ? input.backlogText : '';
  const purpose = sectionBody(contextText, '1.');
  const architecture = sectionBody(contextText, '2.');
  const contextStub = !contextText.trim()
    || CONTEXT_PLACEHOLDER_RE.test(contextText)
    || purpose.length < 40
    || architecture.length < 40;
  const backlogStub = !backlogText.trim()
    || BACKLOG_PLACEHOLDER_RE.test(backlogText)
    || (!/###\s*B\./i.test(backlogText) && !/- \[[ x]\]/i.test(backlogText) && backlogText.length < 400);

  let context_mode = 'propose';
  if (!contextStub && (input.backendHasCode || input.frontendHasCode)) {
    context_mode = 'refresh';
  } else if (input.backendHasCode || input.frontendHasCode) {
    context_mode = 'codify';
  } else {
    context_mode = 'propose';
  }

  if (contextStub) {
    invites.push('PROJECT_CONTEXT looks stubby — run product stand-up (scope context or both)');
  }
  if (backlogStub) {
    invites.push('BACKLOG looks empty/stub — seed after context (scope both or backlog)');
  }
  if (backlogStub && contextStub === false) {
    invites.push('context has substance; backlog-only stand-up is allowed');
  }

  let foundation_invite = false;
  if (!input.hasGit || !input.hasCiWorkflow) {
    foundation_invite = true;
    if (!input.hasGit) invites.push('no git metadata detected — foundation bootstrap may init a repo (opt-in)');
    if (!input.hasCiWorkflow) invites.push('no CI workflow detected — foundation bootstrap may add CI (opt-in)');
  }
  if (!input.hasNxConfig && (input.backendHasCode || input.frontendHasCode)) {
    invites.push('no Nx config detected — foundation may offer Nx only via Decision card (never forced)');
  }
  if (input.hasNxConfig) {
    invites.push('Nx config present — foundation document-only or verify graph; do not re-scaffold blindly');
  }

  // Stand-up is ready whenever the seam exists; findings are guidance.
  const ready = true;
  if (findings.length && Object.keys(project).length === 0) {
    return {
      ready: false,
      context_mode: null,
      scope_default: 'both',
      context_stub: contextStub,
      backlog_stub: backlogStub,
      foundation_invite,
      findings,
      invites,
    };
  }

  return {
    ready,
    context_mode,
    scope_default: 'both',
    context_stub: contextStub,
    backlog_stub: backlogStub,
    foundation_invite,
    findings,
    invites,
  };
}

function readIf(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function dirHasCode(rel) {
  if (typeof rel !== 'string' || rel.trim() === '') return false;
  return hasSourceEvidence(path.resolve(ROOT, rel));
}

export function main(argv = process.argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('usage: node project_standup_ready.mjs [--json]\n       node gates.mjs project_standup_ready [--json]');
    return 2;
  }
  const asJson = argv.includes('--json');

  const hasStateRoot = fs.existsSync(STATE_ROOT) && fs.statSync(STATE_ROOT).isDirectory();
  let cfg = {};
  try {
    cfg = projectConfig();
  } catch {
    cfg = {};
  }

  const contextRel = Object.hasOwn(cfg, 'context_file') && typeof cfg.context_file === 'string'
    ? cfg.context_file
    : 'context/PROJECT_CONTEXT.md';
  const contextPath = path.join(STATE_ROOT, ...String(contextRel).split('/'));
  const backlogPath = path.join(STATE_ROOT, 'context', 'BACKLOG.md');

  const backendDir = cfg.backend && typeof cfg.backend === 'object' ? cfg.backend.dir : '';
  const frontendDir = cfg.frontend && typeof cfg.frontend === 'object' ? cfg.frontend.dir : '';

  const result = assessProjectStandupReady({
    hasStateRoot,
    project: cfg,
    contextText: readIf(contextPath),
    backlogText: readIf(backlogPath),
    backendHasCode: dirHasCode(backendDir),
    frontendHasCode: cfg.frontend === null ? false : dirHasCode(frontendDir),
    hasGit: fs.existsSync(path.join(ROOT, '.git')),
    hasCiWorkflow: fs.existsSync(path.join(ROOT, '.github', 'workflows')),
    hasNxConfig: fs.existsSync(path.join(ROOT, 'nx.json')) || fs.existsSync(path.join(ROOT, 'workspace.json')),
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return result.ready ? 0 : 1;
  }

  console.log(
    `project_standup_ready — ${result.ready ? 'READY' : 'BLOCKED'}`
    + (result.context_mode ? ` context_mode=${result.context_mode}` : '')
    + ` scope_default=${result.scope_default}`
    + ` context_stub=${result.context_stub}`
    + ` backlog_stub=${result.backlog_stub}`
    + ` foundation_invite=${result.foundation_invite}`,
  );
  for (const line of result.findings) console.log(`  ! ${line}`);
  for (const line of result.invites) console.log(`  · ${line}`);
  if (result.ready) {
    console.log('  OK to run standup/PROJECT_STANDUP_METHOD.md (product context + backlog onboarding) (or standup/PROJECT_STANDUP_METHOD.md).');
    if (result.foundation_invite) {
      console.log('  Optional next: foundation/FOUNDATION_BOOTSTRAP_METHOD.md (optional git/CI/monorepo; Nx opt-in) (foundation/FOUNDATION_BOOTSTRAP_METHOD.md) — opt-in only.');
    }
  } else {
    console.log('  Install or repair the seam, then re-run.');
  }
  return result.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
