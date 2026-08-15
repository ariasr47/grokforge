---
name: spire-tech-flow-integration-tests
description: Use when implementing or reviewing frontend flow-level tests that walk SPEC user journeys with the network boundary mocked. Prefer this over spire-tech-tdd when the work is journey/integration shape, not the RED-GREEN micro-loop. Prefer this over spire-tech-frontend-patterns when the stack is not React/Next or the task is test structure rather than React performance.
---

# Flow integration tests — journeys, not pokes

Own the **centerpiece frontend test craft**: mount the feature, mock only the network boundary, and
walk the user journeys required by SPEC §3–§4 and promoted invariants. Do **not** own product
requirements, brand, or write_scope — the frontend role does.

**Exit artifact:** green flow-integration tests colocated with the feature (or the project's declared
test layout), covering required journeys — not a parallel test-plan document.

## Critical procedure

1. **Read the requirement set — do not invent it.** Required cases come from:
   - SPEC §3 acceptance criteria marked `Verify by: test` (via risk-based method),
   - SPEC §4 component states and degraded behaviors that carry silent risk,
   - promoted invariants in the feature context pack.
   Cover **all** required cases. If one is untestable, bounce via GATE Z — do not silently omit.

2. **Mount the feature subtree** in the project's component-test stack. Do not require a live backend
   for these tests.

3. **Mock only the network boundary** — the typed API client, `fetch`, or project transport. Never
   mock half the UI tree to hide missing states. Never call a live backend from flow-integration tests.

4. **Walk each journey end-to-end through edge variations** named by the contracts:
   - happy path,
   - each required degraded/empty/error state,
   - cold-start vs post-success failure when the contracts distinguish them.

5. **Assert observable behavior and declared invariants** — not coverage %, not implementation
   details, not a default live-vs-static product policy invented by this skill.

6. **Layer other tests below, not instead:**
   - **unit** — pure logic (reducers, formatters) with no DOM when needed,
   - **component** — named SPEC §4 states + key interactions,
   - **flow-integration (this skill)** — the centerpiece journeys.
   Prefer one strong journey check over many assertion-per-AC pokes
   (`spire-tech-risk-based-verify`).

7. **Run via project commands** (`frontend.test_cmd` and shared-lib test cmd if touched). Read full
   output. Hollow green suites do not count.

## Reference routing

| Read when | Reference |
| --- | --- |
| Mocking strategy or flaky journeys | [Mock and stability](references/mock-and-stability.md) |
| Mapping SPEC rows to journeys | [Journey coverage map](references/journey-coverage.md) |

## Stop conditions

Stop when SPEC §3/§4 do not define journeys, when the network seam cannot be mocked without rewriting
the app, or when a required case is untestable. Report for GATE Z amendment; do not invent product
behavior or drop the case.

## Do not

- Do not mock the live backend into the suite as a substitute for contract seams.
- Do not re-impose one-test-per-AC or snapshot every CSS prop.
- Do not invent product UX policy the contracts omit.
- Do not treat E2E browser tools as a substitute for this centerpiece unless the project mandates them.
- Do not expand into backend, contracts, or role identity.
- Do not invent parallel docs (`FLOW_TEST_PLAN.md`).
