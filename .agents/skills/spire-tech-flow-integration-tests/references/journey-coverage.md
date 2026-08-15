# Journey coverage map

## Build the matrix from contracts

| Source | What to extract |
| --- | --- |
| SPEC §3 rows with `Verify by: test` | Must have an automated observation |
| SPEC §4 states | default, loading, empty, error, offline, stale, success as named |
| Promoted invariants | Negative space and must-not behaviors |
| INTERFACE fields consumed | UI must not invent fields the contract never promised |

## Minimal journey set

For a typical feature, expect at least:

1. Primary happy path to success.
2. Each high-risk degraded state that changes user-visible behavior.
3. One failure path after success if the contracts distinguish recovery.

## Recording

In the frontend done-report or QA evidence, name the journey tests that protect each required
`test`-marked AC. Gaps are GATE Q / GATE Z material — not optional polish.
