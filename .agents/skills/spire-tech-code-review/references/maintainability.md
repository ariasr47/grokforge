# Maintainability review

## Cohesion and responsibility

Each unit should own one reason to change. Flag code that mixes policy, I/O, formatting and orchestration when those concerns evolve independently. Avoid abstraction that only moves complexity without clarifying ownership.

## Duplication and naming

Distinguish repeated policy from coincidentally similar code. Shared policy needs one authority; superficial similarity may be clearer duplicated. Names should reveal domain meaning, units and side effects rather than implementation trivia.

## Complexity and control flow

Look for deep nesting, flag combinations, boolean modes, hidden mutation and branches whose valid combinations are unclear. Prefer explicit variants and small seams when they reduce reachable invalid states.

## Test quality

Reject tests that assert nothing, duplicate the implementation, grep source for behavior, over-mock internals or pass when the protected behavior is removed. Check whether failure output identifies the broken contract.

## Change cost

Ask what must change for the next plausible variant, how a new maintainer discovers the rule, and whether comments explain why rather than restate code. Missing migration, compatibility or removal paths are maintenance findings when the change creates long-lived state.
