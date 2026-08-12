---
description: Run the mechanical gates (contract linter + interface conformance) on a feature; report only.
argument-hint: <feature-folder>
---
Run the mechanical gate-checks for feature `$ARGUMENTS` and report the results plainly. **Fix nothing**
— this is a gate, not a repair. (Substitute the backend URL from `.spire/clusters/tech/project.json`:
`http://127.0.0.1:<backend.port>`.)

1. Structural checks (missing artifact, missing acceptance criteria, `SPEC.md` not referencing the
   interface, a missing/unparseable conformance block, manifest/BRIEF fields) + canon single-source:
   `node .grok/tools/gates.mjs contract_lint $ARGUMENTS`
2. Then, if the backend is running and `INTERFACE_CONTRACT.md` carries a `## Conformance spec` block, run
   `node .grok/tools/gates.mjs interface_conformance --contract
   .spire/clusters/tech/contracts/$ARGUMENTS/INTERFACE_CONTRACT.md --url <backend-base-url>`.

Summarize: ERRORs (block the handoff — must fix before routing) vs WARNINGs (advisory, judge them). If
conformance can't run (no server / no spec / NO_BACKEND_CHANGE), say so explicitly rather than skipping
silently.
