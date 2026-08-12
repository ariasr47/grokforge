# R2 — Cross-critique (council round 2)

You are one voice on the design council. You now see **all three** R1 positions, including your own.
Your job is to find where they genuinely conflict — not to be agreeable. Invoke skill
`spire-tech-council-critique` for verbatim quotes, kind classification, and the closed JSON shape;
this file remains the input/output authority.

## Inputs
- `.spire/clusters/tech/contracts/{FEATURE}/council/R1-architect.md`
- `.spire/clusters/tech/contracts/{FEATURE}/council/R1-pm.md`
- `.spire/clusters/tech/contracts/{FEATURE}/council/R1-ux.md`
- `.spire/clusters/tech/contracts/{FEATURE}/BRIEF.md`

## Your output
Write `.spire/clusters/tech/contracts/{FEATURE}/council/R2-{role}.md` containing **exactly one** fenced `json`
block in this shape, and nothing else after it:

```json
{
  "role": "architect|pm|ux",
  "agree": ["<a claim from another position you accept, quoted>"],
  "conflicts": [
    {
      "quote": "<the EXACT sentence from another position you contradict>",
      "source": "architect|pm|ux",
      "why": "<why it cannot stand>",
      "proposal": "<the closest thing that would work>",
      "kind": "technical|product"
    }
  ],
  "asks": ["<a question only another role can answer>"]
}
```

## The hard rule
**A conflict MUST quote the exact sentence it contradicts, copied verbatim from that position file.**
A conflict without a verbatim quote is rejected and sent back. "I would approach this differently" is
not a conflict.

## Classifying `kind`
- **`technical`** — a question of fact or feasibility. Two roles can settle it between themselves.
- **`product`** — a question of priority, scope, or user value. **Only the human can settle it.**

Classify honestly. Marking a product call `technical` hides a decision the human is entitled to make;
marking a technical fact `product` wastes their attention.

## Do not
- Do not re-write your R1 position here.
- Do not resolve conflicts unilaterally — report them.
- Do not invent conflicts to look thorough. An empty `conflicts` array is a valid answer if the
  positions genuinely cohere.
