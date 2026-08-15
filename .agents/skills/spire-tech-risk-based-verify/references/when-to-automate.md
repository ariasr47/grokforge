# When to automate

## Automate (`test`) when all of the following hold

1. A regression is **plausible** under normal refactor or dependency change.
2. The failure would be **invisible** or easy to miss on casual human review.
3. An automated check can observe the behavior **without reading production source as the oracle**.

Examples of automate-worthy classes:

- Invariants and negative space (must not call X, must not expose Y).
- Auth / tenant / permission boundaries.
- Byte-identity or fingerprint guarantees the feature declares.
- Stateful UI motion that can vanish while the suite stays green.
- Error and empty paths that only appear under specific fixtures.

## Prefer review when

- The change is **visible and intentional** (copy, label, static layout).
- A human would always notice the break on a normal visual pass.
- Automation would only restate CSS or string equality without protecting behavior.
- **Zero-dep / no-DOM stack (H3):** plain ESM + `node --test` (or equivalent) with no DOM harness in
  the project contract — paint, layout, focus rings, and browser-only DOM ACs stay `review` unless
  a named harness (jsdom, Playwright, Cypress, …) is in the contract. Do not invent a DOM tier
  silently. Pure modules under `test` remain the home for load-bearing logic.

## Depth guidance

| Situation | Prefer |
| --- | --- |
| Multi-step user journey | One integration/flow test |
| Pure derivation / formatter | Unit test |
| Component state matrix from SPEC | Component tests for named states that carry risk |
| Accessibility critical path | One a11y or keyboard path check (only if harness exists) |
| Pure cosmetic | Review |
| Paint under zero-dep no-DOM | Review + disclose; pure logic under unit tests |

## Retired rule

**One automated test per AC** is retired. It produced brittle suites anchored to phrasing, not fragility.
