#!/usr/bin/env node
// PreToolUse hook: block writes outside this workspace root (system-4b workspace fence).
// REPO_ROOT is computed from __dirname (.grok/tools/ -> repo root), so it covers every lane in the
// workspace under one root regardless of the project's internal layout. No per-project config needed.
// Claude carve-outs (sanctioned harness write locations outside the repo):
//   - the per-project Claude auto-memory store (~/.claude/projects/<proj>/memory)
//   - the approved-plan store (~/.claude/plans) — runbooks the harness writes/reads
const path = require('path');
const os = require('os');
const REPO_ROOT = path.resolve(__dirname, '..', '..'); // <provider>/tools/ -> repo root
const STRUCTURED = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'search_replace', 'write']);
const PROTOCOLS = new Set(['claude', 'codex', 'grok']);

function patchTargets(command) {
  const targets = [];
  for (const line of String(command ?? '').split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/)
      || line.match(/^\*\*\* Move to:\s*(.+?)\s*$/);
    if (match?.[1]) targets.push(match[1]);
  }
  return targets;
}

function toolNameOf(payload) {
  return payload?.tool_name ?? payload?.toolName ?? null;
}

function toolInputOf(payload) {
  return payload?.tool_input ?? payload?.toolInput ?? {};
}

function decodeTargets(payload, protocol) {
  const tool = toolNameOf(payload);
  const input = toolInputOf(payload);
  if (protocol === 'codex' && tool === 'apply_patch') {
    return { guarded: true, targets: patchTargets(input?.command) };
  }
  if (!STRUCTURED.has(tool)) return { guarded: false, targets: [] };
  const target = tool === 'NotebookEdit'
    ? (input.notebook_path ?? input.notebookPath)
    : (input.file_path ?? input.filePath ?? input.path);
  return { guarded: true, targets: typeof target === 'string' && target ? [target] : [] };
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isClaudeCarveOut(target, home) {
  const memRel = path.relative(path.join(home, '.claude', 'projects'), target);
  if (memRel && !memRel.startsWith('..') && !path.isAbsolute(memRel) && memRel.split(path.sep).includes('memory')) return true;
  const planRel = path.relative(path.join(home, '.claude', 'plans'), target);
  return planRel !== '' && !planRel.startsWith('..') && !path.isAbsolute(planRel);
}

function evaluate(payload, { protocol, repoRoot = REPO_ROOT, home = os.homedir() }) {
  const tool = toolNameOf(payload);
  const decoded = decodeTargets(payload, protocol);
  if (!decoded.guarded) return { allow: true };
  if (decoded.targets.length === 0) {
    if (protocol === 'claude') return { allow: true };
    return { allow: false, tool, reason: `path_guard (system-4b): BLOCKED ${tool}: no decodable target.` };
  }
  const cwd = payload.cwd || payload.workspaceRoot || repoRoot;
  for (const rawTarget of decoded.targets) {
    const target = path.resolve(path.isAbsolute(rawTarget) ? rawTarget : path.join(cwd, rawTarget));
    if (protocol === 'claude' && isClaudeCarveOut(target, home)) continue;
    if (isInside(repoRoot, target)) continue;
    return {
      allow: false,
      tool,
      target,
      reason: `path_guard (system-4b): BLOCKED ${tool} to '${target}' — outside this monorepo (${repoRoot}).`,
    };
  }
  return { allow: true };
}

function emitVerdict(verdict, protocol) {
  if (verdict.allow) return;
  if (protocol === 'codex') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    }));
    return;
  }
  if (protocol === 'grok') {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      reason: verdict.reason,
    }));
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`${verdict.reason} Carve-outs: ~/.claude/projects/**/memory, ~/.claude/plans.\n`);
  process.exitCode = 2;
}

function protocolFromArgv(argv) {
  const index = argv.indexOf('--protocol');
  return index === -1 ? 'claude' : argv[index + 1];
}

function main() {
  const protocol = protocolFromArgv(process.argv.slice(2));
  if (!PROTOCOLS.has(protocol)) {
    process.stderr.write(`path_guard: unknown path_guard protocol '${protocol}'\n`);
    process.exitCode = 2;
    return;
  }
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      process.stderr.write('path_guard: unparseable hook payload — allowing\n');
      return;
    }
    emitVerdict(evaluate(payload, { protocol }), protocol);
  });
}

module.exports = { decodeTargets, evaluate, emitVerdict, isInside };
if (require.main === module) main();
