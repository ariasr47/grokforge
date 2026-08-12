# Compare and bounce

| Builder receipt | QA receipt | Action |
| --- | --- | --- |
| PASS | FAIL | GATE Z bounce; state drift vs never-run |
| FAIL | PASS | Note in QA_REPORT; feature conforms now |
| missing | any (backend exists) | Bounce — skipped deliverable |
| n/a | exempt | `NO_BACKEND_CHANGE` only when interface body says so |
| any | UNVERIFIABLE (unbootable) | Count on summary; do not hide inside PASS |

Always keep the tool-written QA receipt path; never hand-author JSON verdicts.
