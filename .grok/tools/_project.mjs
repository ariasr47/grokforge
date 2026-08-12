// _project.mjs — the per-project seam, read once and shared.
//
// `.spire/clusters/tech/project.json` is the ONLY place a project-specific value may live: framework files are
// byte-identical across projects and `kit_lint` fails the build on a consumer name, path, or port
// appearing in this tree. Every gate that needs one reads it through here.
//
// This was three byte-identical copies (context_for, contract_lint, and the auth work in
// interface_conformance) before extraction. Node builtins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project seam is provider-neutral and always lives at
// <repo>/.spire/clusters/tech/project.json, while this tool installs under a per-provider root
// (.claude on Claude Code, .codex on Codex). Resolve TWO up to the repo root, then join the fixed
// cluster state namespace. Deriving the seam from this file's provider root would make the selected
// provider choose project-state ownership, which is forbidden.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_ROOT = path.join(ROOT, '.spire', 'clusters', 'tech');

/** Read the project seam (.spire/clusters/tech/project.json). Absent/malformed ⇒ {} (defaults apply). */
export function projectConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(STATE_ROOT, 'project.json'), 'utf8'));
    // CPython only guards OSError/JSONDecodeError; a valid-but-non-object project.json (a bare
    // array/string/number) then dies on `.get` with an AttributeError traceback. A gate should not
    // traceback on malformed config, so a non-object reads as "no config" — same net effect as the
    // empty dict CPython produces for the two cases it does guard. Recorded, not papered over.
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
