---
name: spire-tech-contract-consume
description: Use when the frontend build lane consumes INTERFACE_CONTRACT fields exactly — no inventing payloads, no assuming unpromised fields. Prefer this over free-form API guessing. Prefer spire-tech-interface-conformance for R4 authoring and spire-tech-conformance-receipt for backend emit.
---

# Contract consume — only promised fields

Own **frontend contract fidelity craft**: consume exactly what INTERFACE promises; bounce missing
fields via GATE Z. Do not author the interface.

**Exit artifact:** client code + done-report field discipline — no parallel API notes.

## Critical procedure

1. **Read INTERFACE_CONTRACT** conformance block and human endpoint notes.
2. **Consume only promised fields** for request/response shapes the UI uses.
3. **Never invent** fields, status meanings, or auth headers absent from the contract.
4. **On missing needed field:** stop and GATE Z — do not invent a client-only shape "for now."
5. **Align with SPEC §4** for states/copy; contract wins for FE↔BE truth.
6. **Tests** must not mock unpromised fields as if they were real.

## Reference routing

| Read when | Reference |
| --- | --- |
| Missing field bounce | [Missing field](references/missing-field.md) |

## Stop conditions

Stop when INTERFACE is missing, contradictory, or lacks a checkable block for a backend-touching
feature. Report; do not invent.

## Do not

- Do not edit INTERFACE or SPEC from the frontend lane.
- Do not assume fields "everyone knows" without the contract.
- Do not mock a richer backend than INTERFACE promises.
