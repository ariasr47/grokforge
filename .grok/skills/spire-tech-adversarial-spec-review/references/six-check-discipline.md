# Six-check discipline

Order is load-bearing: **dropped conflicts first**. That check caught the most historical S2 misses.

## Severity

- **Critical** — blocks ship; loops to R4 (dropped conflict, guardrail breach, unobservable ship-gate AC).
- **Important** — should fix before build (missing state behavior, interface drift).
- **Minor / advisory** — polish; do not bury Critical items here.

## Checked and clean rows

For each of the six checks that found nothing, name the check and cite what was examined. Empty
"Checked and clean" with no Critical findings is not a pass.

## Evidence forms

Prefer verbatim quotes from R2 or SPEC sections. `file:section` pointers are acceptable when the
defect is structural (e.g. missing §4 state column).
