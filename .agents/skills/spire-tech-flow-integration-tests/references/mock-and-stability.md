# Mock and stability

## Mock boundary

| Mock | Do not mock |
| --- | --- |
| HTTP/transport client for the feature | Child presentational components that define states under test |
| Clock only when time is part of the contract | Random IDs unless determinism is required |
| Router location when the journey depends on it | Entire app shell if the feature mounts alone |

## Stability

- Prefer role/accessible queries over brittle CSS selectors when the stack supports them.
- Wait for **declared** loading → ready transitions; do not arbitrary-sleep.
- Reset module-level client state between cases when the project stores caches on the client.
- One journey per test when failures must point at a single path; share setup helpers, not giant
  coupled cases.

## Failure triage

If a journey is red:

1. Confirm the mock returns the contract-shaped payload (not a hand-waved object).
2. Confirm the UI state under test is named in SPEC §4.
3. Only then change production code — use `spire-tech-debugging` for root cause before broad rewrites.
