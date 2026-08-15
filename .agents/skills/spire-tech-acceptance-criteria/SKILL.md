---
name: spire-tech-acceptance-criteria
description: Use when writing or checking acceptance criteria rows (observable outcomes, Verify by, completion evidence) at council R1/R4, build exits, or GATE Q. Prefer this over spire-tech-risk-based-verify when authoring or rewriting criteria rows; prefer risk-based-verify when rows exist and only method/evidence remains.
---

# Acceptance criteria — observable promises and completion evidence

Acceptance criteria live in `SPEC.md` under `## 3. Acceptance criteria (with user stories)`:

| # | Story | Acceptance criterion | Verify by |
|---|---|---|---|
| 1 | As a … I want … so that … | <observable outcome> | test \| review |

`SPEC_TEMPLATE.md` owns the structure. This skill owns the quality of each row and the evidence used to close it.

## Critical procedure

1. **Write independently checkable criteria.** Each row: one observable behavior, precondition/boundary, and result. Include negative behavior explicitly. Reject unbounded words (“fast,” “intuitive,” “secure,” “works”) — replace with thresholds, states, or permissions. If checking requires reading source, rewrite around behavior or classify as a binding invariant.
2. **Split degraded states.** Empty, loading, stale, offline, error, null, unauthorized, not-found get their own rows when they change user-visible behavior or ship risk. Name which rows block ship.
3. **Choose `Verify by` with risk-based method** — invoke `spire-tech-risk-based-verify` for the decision: `test` vs `review`, depth, no one-test-per-AC.
4. **Verify before claiming done.** Run exact relevant commands against current bytes; read complete output. Record unverified work as `UNVERIFIABLE`. When claiming a gate enforces behavior, prove rejecting and accepting sides.

## Reference routing

| Read when | Reference |
|---|---|
| Drafting, splitting or repairing criteria | [Writing criteria](references/writing-criteria.md) |
| Reporting completion, verification or enforcement | [Completion evidence](references/completion-evidence.md) |

## Stop conditions

Stop when a required criterion cannot be made observable without reading source, when verification
commands cannot be run against current bytes, or when a claimed gate cannot show a rejecting path.
Report the blocker; do not invent a silent pass.

## Do not

- Do not restate `INTERFACE_CONTRACT.md`; name it.
- Do not create another document or verdict vocabulary.
- Do not convert every row into a brittle named test.
