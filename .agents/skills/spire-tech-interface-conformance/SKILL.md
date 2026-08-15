---
name: spire-tech-interface-conformance
description: Use when authoring INTERFACE_CONTRACT.md at R4 — machine-checkable Conformance spec block or NO_BACKEND_CHANGE, never restated in SPEC.md. Prefer this over free-form interface prose. Prefer spire-tech-conformance-receipt for builder runs and spire-tech-independent-conformance for QA re-runs.
---

# Interface conformance authoring — the FE↔BE truth file

R4 writes **two** artifacts: `SPEC.md` and `INTERFACE_CONTRACT.md`. SPEC §6 only **points** at the
interface file; it never embeds a second conformance block. The runner
`interface_conformance.mjs` is a **tool**, not this skill — this package is how to **author** the
block the tool will later check.

## Critical procedure

1. Write `INTERFACE_CONTRACT.md` in the feature contracts folder as the single FE↔BE truth.
2. Include endpoints (method, path, purpose, auth, error semantics) in human prose as needed.
3. Place a parseable block under a heading spelled exactly `## Conformance spec` with fenced JSON:
   `{ "endpoints": [ { "method", "path", "path_params", "query", "required", optional "auth", optional "expect_status" } ] }`.
4. Dot-paths, `name[]` for array fan-out, `type|null` / `type?` for optional unions. Use
   `expect_status` (default 200) for machine-checked error paths; body `required` applies when status matches.
5. If the feature genuinely touches no backend: still write the file, mark `NO_BACKEND_CHANGE`, and
   do not invent a fake live block.
6. Never omit the conformance block for a backend-touching feature — prose-only interface is the
   failure mode this design exists to prevent.
7. SPEC §6 must point at this file; do not paste the JSON into SPEC.md.

## Reference routing

| Read when | Reference |
| --- | --- |
| Auth endpoints, NO_BACKEND_CHANGE, or runner expectations | [Authoring rules](references/authoring-rules.md) |

## Stop conditions

Stop when settled decisions do not establish a checkable endpoint/shape, when auth is marked but no
session strategy exists in project config, or when the only available "interface" is free prose.
Refuse to ship an incomplete block; loop via R4 refusal / GATE Z rather than inventing fields.

## Do not

- Do not put the conformance JSON inside SPEC.md.
- Do not invent fields the BRIEF/decisions do not settle.
- Do not treat a green `interface_conformance.mjs` run as this skill's job — authoring and running
  are separate seats.
