---
name: spire-tech-tdd
description: Use for every behavior change in a build lane: RED, GREEN, REFACTOR, verify without weakening the oracle. Prefer this over spire-tech-debugging when writing new behavior tests. Prefer spire-tech-flow-integration-tests for frontend journey/integration shape. Prefer spire-tech-risk-based-verify for test-vs-review method choice only.
---

# TDD — RED, GREEN, REFACTOR, verify

Every behavior change starts with a test. The ordered loop is fixed:

## Critical procedure

1. **RED** — write the smallest test that states the missing behavior. Run it and observe failure for the intended reason. A typo, fixture crash or unrelated failure is not RED.
2. **GREEN** — write the minimum implementation that satisfies the behavior. Do not broaden scope while the test is red.
3. **REFACTOR** — improve names, structure and duplication while behavior stays fixed. Run the focused test after each meaningful refactor.
4. **VERIFY** — run the focused case, the relevant suite and every plan-required check against the final bytes. Read the complete output.
5. **COMMIT** — one independently reviewable behavior per commit when the plan authorizes commits.

## The oracle is binding

Never weaken a test to accommodate the implementation. A failed assertion is either a product defect, a test defect proven against the requirement, or a plan/spec contradiction that must stop at GATE Z. Broadening `equal` into “truthy,” deleting a negative assertion, accepting more outcomes, or skipping the failure path makes the suite green by removing the behavior.

A test that asserts nothing or tolerates the behavior's absence is hollow coverage.

## Test depth follows risk

Automate invariants, negative space and behavior that can silently regress — apply
`spire-tech-risk-based-verify` for method choice. Prefer one meaningful integration or flow check
(`spire-tech-flow-integration-tests` on frontend journeys) over many literal implementation
assertions. Visible intentional copy and presence can remain recorded review.

## Pressure checks

| Temptation | Required response |
|---|---|
| “Too simple to test” | State the behavior with the small test before changing it. |
| “I will add tests after” | Stop; a test that starts green has not proved it can detect absence. |
| “I already checked manually” | Preserve the behavior in a repeatable check when regression can be silent. |
| “I will keep this implementation as reference” | Remove it before writing RED; adapting it is testing after. |
| “The test is too hard” | Treat that as interface feedback and simplify the seam. |
| “Changing the assertion is pragmatic” | Compare the expectation with the approved requirement; fix code or stop at GATE Z. |

## Reference routing

| Read when | Reference |
|---|---|
| Choosing assertions, fixtures, boundaries or mocks | [Writing good tests](references/writing-good-tests.md) |
| Considering an exception or proving a rejecting path | [Exceptions and mutations](references/exceptions-and-mutations.md) |

## Stop conditions

Stop when RED cannot be produced for the intended reason, the test requires an interface the approved design does not permit, or the expected behavior contradicts the plan/spec. Report the contradiction; do not reinterpret it silently.

## Do not

- Do not write implementation before observing RED.
- Do not keep pre-test implementation “as reference.”
- Do not mock the unit whose behavior the test claims to prove.
- Do not add production APIs used only by tests.
