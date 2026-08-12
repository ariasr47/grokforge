# Boot and blockers

## Order

1. Resolve `backend.serve_cmd` / `frontend.serve_cmd` / test commands from project config.
2. Start what the feature needs; wait until ready enough to exercise ACs.
3. If start fails, capture stderr and the command; do not switch to source-only verification.

## UNVERIFIABLE vs FAIL

| Situation | Verdict class |
| --- | --- |
| App cannot boot and that is an environment/fixture limit | UNVERIFIABLE (state blocker) |
| App boots but behavior is wrong | FAIL |
| App not attempted; code-read only | Invalid PASS — redo observation |

Missing backend receipt handling belongs to independent-conformance craft, not this skill.
