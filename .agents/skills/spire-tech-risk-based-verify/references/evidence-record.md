# Evidence record shape

When the invoking role records verification, each acceptance criterion row should carry:

| Field | Content |
| --- | --- |
| Criterion | Verbatim or stable id from SPEC §3 |
| Method | `test` or `review` (must match `Verify by` unless amending) |
| Evidence | Test name(s) **or** what was inspected in review |
| Result | PASS / FAIL / UNVERIFIABLE |

## Rules

- `test` evidence must name the check that can fail if the behavior is absent.
- `review` evidence must say what was looked at (surface, state, breakpoint), not "LGTM."
- UNVERIFIABLE requires a precise blocker (fixture, unbootable app, missing data) — not laziness.
- Do not invent a second report file; write into the role's authorized artifact (`QA_REPORT.md`,
  done-report, or SPEC table).
