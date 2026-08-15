# State inventory

## Baseline set (user-facing)

| State | Ask |
| --- | --- |
| default | First meaningful ready view |
| loading | What shows while data is in flight? |
| empty | Zero results / no items — what next action? |
| error | Request failed — retain data? recovery? |
| offline | No network — degrade or block? |
| stale | Data aged — label, refresh, or block action? |
| success / confirmation | Post-action feedback |

## When to add more

Add only when BRIEF or product criteria require it (e.g. partial, permission-denied, rate-limited).
Do not create ceremonial states with no user-visible difference.
