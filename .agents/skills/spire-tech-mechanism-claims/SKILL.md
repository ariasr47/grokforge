---
name: spire-tech-mechanism-claims
description: Use when authoring Architect R1 technical claims so every assertion names a mechanism, comparison axes, or attackable assumption. Prefer this over free-form architecture essays. Prefer spire-tech-council-critique for R2 quote craft, not R1 mechanism discipline.
---

# Mechanism claims — name the how

Own **technical claim craft** for architecture positions: every capability or constraint must name a
mechanism, a comparison, or an explicit uncertainty. Do **not** own UI, payloads, contracts, or
write_scope — council roles and R4 do.

**Exit artifact:** mechanism-named claims inside the role's R1 position (no parallel architecture doc).

## Critical procedure

1. **List claims that matter.** For each load-bearing statement (data shape, flow, boundary,
   isolation, error path, non-goal), ask: could a peer attack this without a "how"?
2. **Name the mechanism or the gap.** For each claim write either:
   - a **mechanism** (how it works in one concrete sentence), or
   - an **attackable assumption** (what is unknown and who should challenge it next).
   Never leave "it will handle that" without one of those two.
3. **Compare options on fixed axes** when choosing among designs: complexity, cost, scalability,
   team familiarity. State which axis dominated the choice.
4. **Stay in technical shape.** Do not invent endpoint signatures, JSON field names, UI layout, or
   copy. Point those as assumptions about other lanes when needed.
5. **Retraction is success.** If evidence collapses a claim, withdraw it and record why — that is
   council success, not loss.
6. **Hand off clean.** R1 ends with the required "Assumptions about other lanes" section from the
   gate method. Skills refine claim quality; `R1-position.md` remains I/O authority.

## Reference routing

| Read when | Reference |
| --- | --- |
| Wording mechanism vs assumption | [Claim shapes](references/claim-shapes.md) |
| Multi-option tradeoffs | [Comparison axes](references/comparison-axes.md) |

## Stop conditions

Stop when the BRIEF or context pack lacks enough signal to name a mechanism and you cannot form an
honest assumption. Report the missing decision; do not invent product or interface detail.

## Do not

- Do not assert unnamed mechanisms ("handles scale," "is secure," "will recover").
- Do not design UI, endpoints, or payloads.
- Do not write SPEC or INTERFACE.
- Do not invent a parallel architecture document.
- Do not absorb PM/UX ownership of criteria or copy.
