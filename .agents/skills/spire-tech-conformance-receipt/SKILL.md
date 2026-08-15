---
name: spire-tech-conformance-receipt
description: Use when the backend build lane must produce the builder interface_conformance receipt after serve. Prefer this over spire-tech-independent-conformance (QA re-run) and over spire-tech-interface-conformance (R4 authoring).
---

# Conformance receipt — builder proof

Own **execution-lane receipt craft**: after the backend is up, run interface_conformance into
`conformance-receipt.json`, report the verdict honestly, use `--sample` only when boot is impossible.
Do **not** own INTERFACE authoring or QA re-run authority.

**Exit artifact:** `conformance-receipt.json` (tool-written) + named verdict in the done-report.

## Critical procedure

1. **Serve first** with `project.json` → `backend.serve_cmd` when a backend surface exists.
2. **Run the gate** with the live base URL via installed `gates.mjs interface_conformance`
   (provider install root supplies the script path). Point `--contract` at the feature
   `INTERFACE_CONTRACT.md`, `--url` at the backend base URL, and `--report` at the feature
   `conformance-receipt.json` path under contracts.
3. **Name path + verdict** in the done-report. This is a required deliverable, not optional.
4. **If boot is genuinely impossible here**, use offline `--sample` so the receipt records
   `UNVERIFIABLE` — honest, not a fake PASS.
5. **`NO_BACKEND_CHANGE`** in the interface body → exempt; do not invent a live block.
6. **Do not hand-edit** receipt JSON. Do not touch frontend or contracts to make the check pass.

## Reference routing

| Read when | Reference |
| --- | --- |
| Sample mode / UNVERIFIABLE | [Honest unverifiable](references/honest-unverifiable.md) |

## Stop conditions

Stop when INTERFACE is missing or contradictory, when the feature needs a live check but the contract
cannot be parsed, or when only a fake PASS would satisfy the report. Open GATE Z rather than inventing
fields or editing the contract.

## Do not

- Do not skip the receipt when a backend surface exists.
- Do not claim PASS without running the gate (or honest `--sample` UNVERIFIABLE).
- Do not write the QA receipt path — that is the verify seat.
- Do not author INTERFACE_CONTRACT.md here.
