---
name: spire-tech-debugging
description: Use before proposing any fix in a build lane: reproduce, isolate, diagnose, then fix and verify. Prefer this over free-form fix chat. Prefer spire-tech-tdd when the work is RED-GREEN for new behavior rather than diagnosing an existing red.
---

# Debugging — evidence before fixes

A fix proposed before the failure is understood is a guess. Follow the order and meet each exit test:

## Critical procedure

1. **Reproduce** — run the failing behavior and observe it. If it cannot be reproduced, report the limit rather than fixing blind.
2. **Survey change and environment** — inspect the recent diff, configuration, versions, inputs and dependencies that differ from the last known-good path.
3. **Isolate** — shrink input, scope or change until the smallest failure remains.
4. **Diagnose** — read the first relevant error, trace backward to the first invalid state, form one falsifiable hypothesis and test it.
5. **Fix or stop** — fix the root cause. If evidence contradicts the plan or spec, stop at GATE Z. Three failed fixes are evidence against the design, not permission for a fourth guess.
6. **Verify** — run the regression case and relevant full suite on the final bytes. Confirm the original symptom and neighboring behavior.

## Signals worth trusting

- The first causal error rather than the loudest cascade.
- A diff against known-good behavior.
- Values observed at component boundaries.
- A comparison that changes one variable.
- Repeated evidence, not “works on this machine.”

## Pressure checks

| Temptation | Required response |
|---|---|
| “It is probably X” | Trace the evidence and test one hypothesis. |
| “This is urgent” | Use the ordered method; uncontrolled guesses are the slow path. |
| “Patch now, investigate later” | Locate the first invalid state before establishing a workaround. |
| “Change several things and rerun” | Change one variable so the result can falsify a cause. |
| “One more fix” after repeated failure | Three failed fixes trigger the design stop. |
| “I do not understand it, but this may work” | Report the missing understanding and stop. |

## Reference routing

| Read when | Reference |
|---|---|
| The visible failure is downstream of where bad state began | [Root-cause tracing](references/root-cause-tracing.md) |
| Multiple components, services or transforms are involved | [Boundary diagnosis](references/boundary-diagnosis.md) |
| The failure is intermittent, asynchronous or timing-sensitive | [Flaky and timing failures](references/flaky-and-timing-failures.md) |
| Root cause is fixed and the same invalid state could enter elsewhere | [Defense in depth](references/defense-in-depth.md) |

## Stop conditions

Stop when the failure cannot be reproduced, three fixes fail without falsifying the design, or
evidence contradicts the plan/spec. Report the limit or open GATE Z; do not guess.

## Do not

- Do not propose a fix in the same breath as the symptom.
- Do not change two variables between experiments.
- Do not stack a second unverified hypothesis on the first.
- Do not add defenses before locating and fixing the source.
- Do not produce a separate document; put the diagnosis and unresolved evidence in the role report.
