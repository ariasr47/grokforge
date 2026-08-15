---
name: spire-tech-visual-evidence
description: Use when reporting visual verification in the frontend build lane — serve, inspect breakpoints/states, record what was seen or that inspection was unavailable. Prefer this over claiming "looks fine." Prefer spire-tech-design-review for structured critique criteria.
---

# Visual evidence — ran it and looked

Own **how to prove visual verification** for the frontend done-report. Closes "compiles = works" when
the work is visual.

**Exit artifact:** done-report section naming states/breakpoints inspected or explicit unavailable note.

## Critical procedure

1. **Serve** via `frontend.serve_cmd` (and backend when the surface needs it).
2. **Inspect declared breakpoints** from project/context when present; otherwise the primary viewport.
3. **Walk SPEC §4 states** that are user-visible (at least default + high-risk degraded).
4. **Record:** states captured/inspected, what was checked (hierarchy, spacing, contrast, state defects).
5. **If visual inspection is unavailable**, say so explicitly and provide structural render evidence
   (tests, screenshots if authorized, or honest gap) — never silent skip.
6. **Do not claim visual PASS from code-read alone.**

## Reference routing

| Read when | Reference |
| --- | --- |
| Report shape | [Evidence record](references/evidence-record.md) |

## Stop conditions

Stop when serve fails and the feature is not legitimately unbootable, or when SPEC §4 states are
missing. Report; do not invent visual PASS.

## Do not

- Do not equate green unit tests with visual verification.
- Do not invent brand polish beyond approved direction.
- Do not invent parallel VISUAL_REPORT files unless the role already names one.
