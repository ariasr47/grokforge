---
name: spire-tech-component-states
description: Use when defining or reviewing user-facing component states (default, loading, empty, error, offline, stale, success) and mapping them to acceptance criteria. Prefer this over spire-tech-design-review when the job is the state matrix, not full usability critique. Prefer spire-tech-risk-based-verify for test-vs-review marks only.
---

# Component states — complete surface matrix

Own **state inventory and AC→state mapping** for user-facing features. Do **not** own product scope,
server internals, write_scope, or brand taste — roles and design-review do.

**Exit artifact:** state list + AC mapping inside the UX R1 position (or synthesizer SPEC §4 when
invoked from folding) — no parallel state-matrix document.

## Critical procedure

1. **List states the surface can enter.** Start from: default, loading, empty, error, offline, stale,
   success/confirmation. Add feature-specific states only when the BRIEF or product voice requires them.
2. **Name user-visible behavior per state.** For each state: what the user sees, what they can do next,
   and what must not happen (e.g. empty does not look like loading forever).
3. **Map each acceptance criterion to state(s).** Every AC that is user-visible must land on at least
   one named state. If an AC has no state, add a state or split the AC (hand AC shape issues to
   `spire-tech-acceptance-criteria`).
4. **Cover degraded paths.** Stale, offline, error, empty, unauthorized/not-found when they change
   behavior get first-class rows — do not bury them inside happy-path copy.
5. **Align Verify-by with risk.** Use `spire-tech-risk-based-verify` for `test` vs `review` marks on
   the ACs that exercise these states; do not invent a separate test matrix file.
6. **Stay in UX ownership.** Name fields the UI *consumes*; do not invent endpoint signatures or
   payload schemas (interface synthesizer / PM-architect boundaries).
7. **Hand off clean.** Fold into R1 position (or SPEC §4 via synthesizer); no parallel STATE.md.

## Reference routing

| Read when | Reference |
| --- | --- |
| Which states are mandatory vs optional | [State inventory](references/state-inventory.md) |
| Mapping ACs to states | [AC to state map](references/ac-to-state-map.md) |

## Stop conditions

Stop when the BRIEF lacks a user-facing surface, when product scope is ambiguous and inventing states
would re-scope the feature, or when required states contradict the project design canon. Report the
gap; do not invent product behavior.

## Do not

- Do not invent a parallel test-case matrix document.
- Do not bury degraded states inside happy-path criteria.
- Do not design server internals, math, or final JSON contracts.
- Do not expand into role identity (you are not PM, architect, or frontend implementer).
- Do not pretend a one-state mockup is a complete surface.
