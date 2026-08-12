# R1 — Independent position (council round 1)

You are one voice on the design council. **You have NOT seen the other two voices' positions, and you
must not speculate about them beyond the assumptions section below.** Blindness is deliberate: it is
what keeps the three views genuinely independent.

## Inputs (read in this order)
1. `.spire/clusters/tech/project.json` — the seam (dirs, commands, context filename).
2. `.spire/clusters/tech/contracts/{FEATURE}/BRIEF.md` — the goal + guardrails.
3. The context pack you were given — read the file at `.spire/clusters/tech/contracts/{FEATURE}/_context-pack.md`. If
   you were not handed one, regenerate it yourself and read the file it writes, rather than printing the
   pack into your own context: `node .grok/tools/gates.mjs context_for {FEATURE} --write`.

## Your output
Write **one file**: `.spire/clusters/tech/contracts/{FEATURE}/council/R1-{role}.md` where `{role}` is your role name
(`architect`, `pm`, or `ux`). Write nothing else. Stay strictly in your lane — the lane rules in your
own agent definition are binding here.

Structure it as:

    # R1 — {role} position: {FEATURE}

    ## Position
    <your lane's design, per your agent definition's lane rules>

    ## Risks I see
    <what could go wrong in your lane>

    ## Assumptions I'm making about the other two lanes
    <REQUIRED. One bullet per assumption. Be specific and falsifiable —
    "the backend can return the full list in one call", not "the backend will cooperate".>

## Why the assumptions section is required
It is the surface round 2 attacks. A position with vague or missing assumptions produces a polite,
useless critique round. Name the things you are taking for granted about the other lanes.

## Do not
- Do not design outside your lane.
- Do not write `SPEC.md` or `INTERFACE_CONTRACT.md` — the synthesizer writes those at R4.
- Do not soften a position to avoid disagreement. Disagreement is the product of this round.
- Do not read, glob, or grep anything under `.spire/clusters/tech/contracts/{FEATURE}/council/` — during R1 it is
  empty by contract, and reading a sibling's position destroys the independence this round exists to
  create.
