---
name: spire-tech-council-critique
description: Use when writing an R2 cross-critique as architect, pm, or ux — verbatim quotes, technical vs product kind, closed JSON shape. Prefer this over spire-tech-adversarial-spec-review (S2 only).
---

# Council critique — R2 conflict craft

You now see all three R1 positions. Your job is to find genuine conflicts, not to be agreeable.
The gate method `council/R2-critique.md` (under the provider install root) remains the authority for
inputs and output path; this skill is the craft package for quotes, kinds, and the closed JSON shape.

## Critical procedure

1. Read all three R1 positions and the BRIEF.
2. Emit **exactly one** fenced JSON block as `council/R2-{role}.md` with `role`, `agree`, `conflicts`,
   `asks` — nothing after the fence.
3. Every conflict **must** set `quote` to an **exact verbatim sentence** copied from another position
   file. No paraphrase conflicts.
4. Classify `kind` honestly:
   - **technical** — fact/feasibility; roles can settle among themselves.
   - **product** — priority, scope, or user value; only the human settles it.
5. Empty `conflicts` is valid when positions genuinely cohere — do not invent conflicts for show.

## Reference routing

| Read when | Reference |
| --- | --- |
| Choosing kind or handling retraction | [Kind and retraction](references/kind-and-retraction.md) |

## Stop conditions

Stop when a candidate conflict has no verbatim quote, when the JSON shape cannot be produced, or
when the dispatch asks you to rewrite R1 or resolve unilaterally. Report the blocker; do not invent
quotes.

## Do not

- Do not re-write your R1 position in R2.
- Do not resolve conflicts unilaterally — report them.
- Do not mark product calls as technical to hide human decisions, or technical facts as product to
  waste operator attention.
