#!/usr/bin/env node
// design_system_ready.mjs — model-free preflight for living design-canon onboarding.
//
// Answers: "is this project ready for `design/DESIGN_SYSTEM_METHOD.md` (living project design canon) (codify|propose|no-UI)?" without inventing
// brand taste. Exit 0 when ready; exit 1 when blocked; exit 2 on usage errors.
//
// Usage:
//   node .grok/tools/design_system_ready.mjs
//   node .grok/tools/gates.mjs design_system_ready
//
// Node builtins only. Project coupling only via .spire/clusters/tech/project.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectConfig } from './_project.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');

const TEMPLATE_PROJECT_NAMES = new Set(['MyProject', '{PROJECT}', '']);
const PLACEHOLDER_RE = /<\s*(?:command|What this product|entry point|key modules)/i;
const CONTEXT_PLACEHOLDER_RE = /<What this product is|\{PROJECT\}/;

/**
 * Pure assessment for tests and the CLI.
 * @param {{ project: object, contextText: string, frontendDirExists: boolean, frontendHasUiEvidence: boolean }} input
 */
export function assessDesignSystemReady(input) {
  const findings = [];
  const project = input.project && typeof input.project === 'object' ? input.project : {};
  const contextText = typeof input.contextText === 'string' ? input.contextText : '';

  if (Object.keys(project).length === 0) {
    findings.push('project.json missing or empty — fill the project seam first');
  } else {
    if (Object.hasOwn(project, '_comment')) {
      findings.push('project.json still has template _comment — fill the seam and remove _comment');
    }
    const name = typeof project.project_name === 'string' ? project.project_name.trim() : '';
    if (TEMPLATE_PROJECT_NAMES.has(name) || name.length === 0) {
      findings.push(`project_name is still a template value (${JSON.stringify(name || '(empty)')})`);
    }
    const blob = JSON.stringify(project);
    if (PLACEHOLDER_RE.test(blob) || blob.includes('<POST path')) {
      findings.push('project.json still contains angle-bracket placeholders (serve_cmd / auth / etc.)');
    }
  }

  if (!contextText || contextText.trim() === '') {
    findings.push('PROJECT_CONTEXT.md missing or empty — fill §1 Purpose and §2 Architecture at minimum');
  } else if (CONTEXT_PLACEHOLDER_RE.test(contextText)) {
    findings.push('PROJECT_CONTEXT.md still has scaffold placeholders — fill §1–§2 with product reality');
  } else {
    // Require some non-placeholder substance in purpose/architecture for propose mode.
    const purpose = sectionBody(contextText, '1.');
    const architecture = sectionBody(contextText, '2.');
    if (!purpose || purpose.length < 40) {
      findings.push('PROJECT_CONTEXT.md §1 Purpose is missing or too thin for propose/codify');
    }
    if (!architecture || architecture.length < 40) {
      findings.push('PROJECT_CONTEXT.md §2 Architecture is missing or too thin for propose/codify');
    }
  }

  if (findings.length > 0) {
    return { ready: false, mode: null, findings };
  }

  const frontend = Object.hasOwn(project, 'frontend') ? project.frontend : undefined;
  if (frontend === null) {
    return {
      ready: true,
      mode: 'no-ui',
      findings: [
        'frontend is null — leave DESIGN_SYSTEM UNSET; put NO_UI_CHANGE in SPEC bodies for non-UI features',
      ],
    };
  }

  if (!frontend || typeof frontend !== 'object' || typeof frontend.dir !== 'string' || frontend.dir.trim() === '') {
    return {
      ready: false,
      mode: null,
      findings: ['project.json frontend.dir is missing — set a dir for UI work or set frontend to null'],
    };
  }

  if (input.frontendHasUiEvidence) {
    return { ready: true, mode: 'codify', findings: [] };
  }

  // Dir may be missing or empty stub — propose is still valid once product context is real.
  if (!input.frontendDirExists) {
    return {
      ready: true,
      mode: 'propose',
      findings: [
        `frontend.dir '${frontend.dir}' does not exist yet — propose mode only (create the dir when building)`,
      ],
    };
  }

  return { ready: true, mode: 'propose', findings: [] };
}

function sectionBody(text, headingStart) {
  // headingStart e.g. "1." matches "## 1. Purpose & scope"
  const headerRe = new RegExp(`^##\\s*${headingStart.replace('.', '\\.')}[^\\n]*\\r?\\n`, 'm');
  const hm = headerRe.exec(text);
  if (!hm) return '';
  const rest = text.slice(hm.index + hm[0].length);
  const next = rest.search(/\r?\n##\s/);
  const body = next === -1 ? rest : rest.slice(0, next);
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function hasUiEvidence(dirAbs) {
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return false;
  const hit = walkFind(dirAbs, 0);
  return hit;
}

function walkFind(dir, depth) {
  if (depth > 6) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile()) {
      if (/\.(tsx?|jsx?|vue|svelte|css|scss|sass|less)$/i.test(entry.name)) return true;
      if (/theme|tokens|globals\.css|tailwind\.config/i.test(entry.name)) return true;
    } else if (entry.isDirectory() && walkFind(full, depth + 1)) {
      return true;
    }
  }
  return false;
}

export function main(argv = process.argv) {
  const cfg = projectConfig();
  const contextRel = Object.hasOwn(cfg, 'context_file') && typeof cfg.context_file === 'string'
    ? cfg.context_file
    : 'context/PROJECT_CONTEXT.md';
  const contextPath = path.join(STATE_ROOT, ...contextRel.split('/'));
  const contextText = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf8') : '';

  let frontendDirExists = false;
  let frontendHasUiEvidence = false;
  const fe = cfg.frontend;
  if (fe && typeof fe === 'object' && typeof fe.dir === 'string' && fe.dir.trim() !== '') {
    const feAbs = path.resolve(ROOT, fe.dir);
    frontendDirExists = fs.existsSync(feAbs) && fs.statSync(feAbs).isDirectory();
    frontendHasUiEvidence = frontendDirExists && hasUiEvidence(feAbs);
  }

  const result = assessDesignSystemReady({
    project: cfg,
    contextText,
    frontendDirExists,
    frontendHasUiEvidence,
  });

  console.log(`design_system_ready — ${result.ready ? 'READY' : 'BLOCKED'}${result.mode ? ` mode=${result.mode}` : ''}`);
  for (const line of result.findings) console.log(`  - ${line}`);
  if (result.ready && result.mode === 'no-ui') {
    console.log('  OK for backend-only; do not invent a design system.');
  } else if (result.ready) {
    console.log(`  OK to run `design/DESIGN_SYSTEM_METHOD.md` (living project design canon) (or design/DESIGN_SYSTEM_METHOD.md) in ${result.mode} mode.`);
  } else {
    console.log('  Fill project.json + PROJECT_CONTEXT §1–§2 (or set frontend: null), then re-run.');
  }
  return result.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
