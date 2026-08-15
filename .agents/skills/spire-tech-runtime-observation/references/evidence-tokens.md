# Evidence tokens

Prefer mechanical, re-checkable tokens:

- command + exit code + relevant stdout/stderr line
- HTTP status + body field observed
- UI state/text observed after a named action
- screenshot/log path only if the role already authorizes that evidence style

Avoid: "looks fine," "as expected," "per the code."

## GATE Q table tokens (when writing `QA_REPORT.md`)

For the mechanical acceptance table, evidence cells use **only**:

| Form | Example |
|------|---------|
| `RUN:<command_ref>` | `RUN:backend.serve_cmd`, `RUN:qa.interface_conformance` |
| `ARTIFACT:<path>` | `ARTIFACT:conformance-receipt-qa.json` |
| `ORACLE:<id>` | harness-only ids when the case requires them |

Join multiple tokens with commas and **no spaces after commas** when matching strict harness
oracles: `RUN:backend.serve_cmd,RUN:qa.interface_conformance`.

When there is no user-facing surface to capture, the report must carry the exact note line:

```text
NOTE: VISUAL_EVIDENCE_UNAVAILABLE
```

Do not paraphrase that note. Do not put free-prose "browser looked fine" into the Evidence column.
