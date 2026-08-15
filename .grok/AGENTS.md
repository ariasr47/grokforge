# AGENTS.md — Spire Tech boot document (Grok Build)

You are running the installed `spire:tech` cluster on Grok Build. **Cluster entry** (`$spire-tech` /
`spire run tech`) is the product interface into tech; the **conductor** then runs the default
**delivery ascent**. Static composition and scratch-install tests validate this boot document and its
native adapter; they do not prove that a current Grok host executed a role or gate. Named role
dispatch and trusted PreToolUse path_guard have been live-probed on a scratch install (kit research
2026-08-11). Project hooks load only when the folder is trusted and Grok sees a project root.
Remaining claims stay unverified until a further task-shaped trial. Read this file and the named
project/conductor artifacts before acting.

## 1. Select the installation and context (cluster entry)

Read `.spire/clusters/tech/project.json` and `.spire/clusters/tech/context/PROJECT_CONTEXT.md`, then run
the installed `$spire-tech` selector or its universal equivalent:

```powershell
node .spire/bin/spire.mjs run tech --provider grok
```

Require success before reading `.grok/ORCHESTRATOR.md`. Selection validates `.spire/installation.json`,
`.spire/version`, catalog/descriptor/provider identity, launch adapter, provider config, and immutable
artifacts. It records **cluster entry** routing only; it does not mean a role, gate, or the full
delivery ascent executed. The conductor is not a second product surface.

## 2. State and sequence

Project-owned artifacts live under `.spire/clusters/tech/`. Feature contracts are
`.spire/clusters/tech/contracts/{FEATURE}/`; state and selector receipts are in the sibling `state/` and
`receipts/` directories. Provider-native framework and tools live under `.grok/`.

The **delivery ascent** sequence (conductor-mediated) is Discovery → Council → Plan → Backend and
Frontend → QA → Ship. Every role handoff returns through the conductor; a non-zero gate blocks progress.

## 3. Run gates

```powershell
node .grok/tools/gates.mjs contract_lint FEATURE
node .grok/tools/gates.mjs context_for FEATURE --write
node .grok/tools/gates.mjs council_conflicts FEATURE
node .grok/tools/gates.mjs interface_conformance --contract PATH --url URL
node .grok/tools/gates.mjs ledger_tally
node .grok/tools/gates.mjs memory_query --q "terms" --scope cluster,feature
node .grok/tools/gates.mjs project_standup_ready
node .grok/tools/gates.mjs foundation_ready
```

Prefer `memory_query` before re-reading whole handovers or archives (seam files remain truth).

**Onboarding:** `/project-standup` or `.grok/standup/PROJECT_STANDUP_METHOD.md`. Optional
`/foundation` or `.grok/foundation/FOUNDATION_BOOTSTRAP_METHOD.md` (**Nx opt-in only**).

Structured write targets are workspace-fenced by `.grok/hooks/spire-path-guard.json` and
`.grok/tools/path_guard.js` (`--protocol grok`). P9 is delivered for structured write tools; arbitrary
shell command strings are excluded.

## 4. Kit methods

The twenty-seven installed methods are `spire-tech-acceptance-criteria`, `spire-tech-adversarial-spec-review`,
`spire-tech-code-review`, `spire-tech-component-states`, `spire-tech-conformance-receipt`,
`spire-tech-contract-consume`, `spire-tech-council-critique`, `spire-tech-debugging`,
`spire-tech-design-review`, `spire-tech-flow-integration-tests`, `spire-tech-frontend-patterns`,
`spire-tech-independent-conformance`, `spire-tech-interface-conformance`, `spire-tech-invariant-honor`,
`spire-tech-lane-refusal`, `spire-tech-mechanism-claims`, `spire-tech-microcopy-integrity`,
`spire-tech-react-a11y`, `spire-tech-react-async-data`, `spire-tech-react-composition`,
`spire-tech-react-performance`, `spire-tech-react-server-client`, `spire-tech-react-testing`,
`spire-tech-risk-based-verify`, `spire-tech-runtime-observation`, `spire-tech-tdd`, and
`spire-tech-visual-evidence`. Installed methods resolve under `.grok/skills/`; each named method's file is
`<name>/SKILL.md` beneath that directory. The planning method is `.grok/plan/PLAN_METHOD.md`. If host
discovery is unavailable, read the exact installed file; do not invent a different method.

## 5. Host boundaries (live-probed 2026-08-11 where noted)

As of 2026-08-10, Grok Build documentation describes project agents under `.grok/agents/`, skills under
`.grok/skills/` (plus Claude-compatible paths), project rules including `AGENTS.md`, and blocking
`PreToolUse` hooks. Spire installs the workspace fence at `.grok/hooks/spire-path-guard.json`. Per-agent
tool restriction is delivered through agent frontmatter `tools` lists (P8=1 in the Spire descriptor). Named
dispatch and model routing are configured on emitted agent markdown; live host discovery remains
unverified until an attributable trial.

Slash commands and skills are both host surfaces; Spire installs the `$spire-tech` skill selector at
`.grok/skills/spire-tech/SKILL.md` and also emits framework command markdown under `.grok/commands/` for
hosts that load that layout. Selection alone does not close live execution proof.
