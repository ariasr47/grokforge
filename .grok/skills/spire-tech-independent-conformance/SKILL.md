---
name: spire-tech-independent-conformance
description: Use at GATE Q when re-running interface_conformance into a QA receipt and comparing verdicts to the builder receipt. Prefer this over spire-tech-interface-conformance (R4 authoring) and over trusting the backend receipt alone.
---

# Independent conformance — re-run, compare, bounce

Own **verify-lane conformance re-run craft**: produce `conformance-receipt-qa.json`, compare to the
builder receipt, apply bounce rules. Do **not** own INTERFACE authoring (R4) or product repair.

**Exit artifact:** QA receipt path written by the gate tool + comparison outcome in `QA_REPORT.md`.

## Critical procedure

1. **Never trust the handed receipt.** Backend wrote `conformance-receipt.json`; you re-run.
2. **Invoke the gate yourself** into `conformance-receipt-qa.json` via installed
   `gates.mjs interface_conformance` (provider install root supplies the script path). Point
   `--contract` at the feature `INTERFACE_CONTRACT.md`, `--url` at the backend base URL, and
   `--report` at the feature `conformance-receipt-qa.json` path under contracts.
3. **Compare `verdict` fields. Yours is authoritative.**
   - Backend PASS / your FAIL → GATE Z bounce (drift or never-run).
   - Backend FAIL / your PASS → note in report, not auto-bounce.
   - Missing backend receipt when a backend surface exists → bounce, never UNVERIFIABLE.
4. **UNVERIFIABLE** means only the backend could not be booted; still count it on the summary line.
5. **`NO_BACKEND_CHANGE`** in the interface body → exempt from re-run when that mark is honest.
6. **Do not hand-edit** the QA receipt JSON; the tool writes it.
7. Record comparison outcome in the authorized QA report, not a parallel file.

## Reference routing

| Read when | Reference |
| --- | --- |
| Bounce matrix edge cases | [Compare and bounce](references/compare-and-bounce.md) |

## Stop conditions

Stop when INTERFACE is missing, the feature needs a backend URL that cannot be obtained, or the gate
cannot run and the feature is not `NO_BACKEND_CHANGE`. Report the blocker; do not invent a PASS receipt.

## Do not

- Do not author or rewrite INTERFACE_CONTRACT.md (that is R4 + interface-conformance skill).
- Do not accept builder PASS without your re-run when a backend surface exists.
- Do not mark missing receipt as UNVERIFIABLE.
- Do not invent parallel receipt filenames outside the role contract.
