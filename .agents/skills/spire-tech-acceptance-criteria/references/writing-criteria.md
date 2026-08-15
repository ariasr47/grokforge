# Writing independently checkable criteria

## Start from actor, precondition, action and outcome

Identify who acts, the state that matters before the action, the action, and the observable result. Given/When/Then is an optional thinking aid, not a required output format:

- Given an expired session, when a protected action is attempted, then access is refused and no mutation occurs.
- Given an empty result set, when the page loads, then the empty state explains what the user can do next.

The fixed SPEC table remains the output.

## Pair positive and negative behavior

For every capability ask both questions:

1. What must happen for an allowed actor or valid input?
2. What must not happen for a denied actor, invalid input or failed dependency?

Negative behavior deserves a separate row when it has its own evidence or ship risk. “The request succeeds” does not establish that an unauthorized request fails without writing data.

## Keep rows independent

One row should be checkable without interpreting another. Split a row when it contains multiple outcomes joined by “and” that can fail separately. Do not split one behavior merely to mirror implementation steps.

## Replace ambiguous qualities

Translate adjectives into observable statements:

| Ambiguous | Checkable |
|---|---|
| loads quickly | renders the first 50 rows within the agreed cold-load threshold |
| handles errors | retains entered data and presents a recovery action when the request fails |
| is secure | denies an actor without the named permission and performs no protected mutation |
| is accessible | completes the named keyboard path with visible focus and an announced error |

Do not invent a threshold. If the product has not decided one, surface the decision instead of disguising ambiguity as precision.

## Cover boundaries and degraded states

Check empty, one, many, minimum, maximum, null, absent, duplicate, stale, unauthorized, offline, timeout and dependency-failure cases that materially change behavior. Select the cases from actual risk; do not create a ceremonial matrix.

## Stack honesty (H3)

If the project is plain ESM + `node --test` without a DOM harness, do not mark paint/layout/DOM-only
outcomes as `test`. Use `review` (or name a harness in the seam/contract) and re-home load-bearing
behavior into pure modules that unit tests can own. Disclose that limit next to other verification
notes — silence recreates a false third verify tier.

## Final authoring check

Before accepting a row, confirm that it names an observable outcome, can fail independently, includes the important negative or degraded behavior, and does not duplicate the interface contract. Choose and record `Verify by` with `spire-tech-risk-based-verify` (do not re-derive risk rules here).
