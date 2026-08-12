# PLAN_METHOD — how a plan is written in this kit

> Read by the `spire-tech-planner` role as a mandatory input at GATE PLAN (`ORCHESTRATOR.md` §3),
> and by anyone judging whether a plan is executable. `SPEC_TEMPLATE.md` owns what a spec looks
> like; this file owns what a `PLAN.md` looks like.

## The bar

A plan is written for a skilled engineer with ZERO context for this codebase: every task names
its exact files, every step shows the actual code or command, nothing is left as an exercise. If
a task needs a question answered before an implementer could start it, the plan is not done.

## Shape

- **Header:** the goal in one sentence, the architecture shape in two or three, the tech stack it
  binds, and Global Constraints — which MUST copy the `## Conformance spec` block from
  `INTERFACE_CONTRACT.md` verbatim so both lanes inherit the same binding shape (GATE PLAN law).
- **Tasks:** bite-sized, one deliverable each, in dependency order. Backend and frontend tracks
  must be independently executable in parallel. Each task carries its own test cycle: write the
  failing test → run it, watch it fail → implement minimally → run it, watch it pass → commit.
- **Verification track:** names exact commands and their expected output — "run the suite" is not
  a verification step; the command with its expected pass count is.

## The banned moves

- "TBD", "add appropriate error handling", "similar to Task N" — placeholder text is a plan
  failure, not a shorthand.
- A step that describes without showing: if a step changes code, the step contains the code.
- Weakening a spec requirement to make it plannable — if the spec cannot be planned as written,
  STOP and report the contradiction (a GATE Z question), never plan around it.

## Plans are code

This kit has caught plan-authored defects in its own history — wrong regexes, false premises
about existing behavior, arithmetic that misled implementers. A plan therefore states, per task,
what a reviewer should probe; and an implementer who finds the plan contradicting the tree
reports the conflict instead of resolving it silently. DRY, YAGNI, TDD, frequent commits.
