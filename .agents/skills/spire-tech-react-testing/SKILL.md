---
name: spire-tech-react-testing
description: Use when the declared stack is React or Next and writing component/DOM tests with user-centric queries. Prefer this over bare spire-tech-tdd for React component tests; prefer spire-tech-flow-integration-tests for full journeys. Skip other stacks.
---

# React testing — user-centric queries

Own **React component test craft** (Testing Library-style) when stack is React/Next.

## Critical procedure

1. Confirm React/Next + test stack; stop if non-React or unknown.
2. Prefer **role/accessible queries** over brittle CSS class selectors when the library supports them.
3. Assert **user-visible behavior**, not implementation details or private state.
4. Avoid testing implementation snapshots of component internals unless structure is the invariant.
5. Use the project's test runner and conventions; do not invent a second harness.
6. Pair with `spire-tech-tdd` for RED-GREEN order and `spire-tech-flow-integration-tests` for journeys.
7. Keep tests deterministic; no arbitrary sleeps — wait for declared UI conditions.

## Reference routing

| Read when | Reference |
| --- | --- |
| Query and assertion choices | [Query guidance](references/query-guidance.md) |

## Stop conditions

Stop when the test environment cannot render the component and inventing mocks would hide missing
contracts. Report; do not force green hollow tests.

## Do not

- Do not apply React Testing Library rules off-stack.
- Do not assert internal component state as the primary oracle.
- Do not replace flow-integration journeys with shallow smoke-only tests for high-risk paths.
