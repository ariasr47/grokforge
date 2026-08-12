---
name: spire-tech-runtime-observation
description: Use at GATE Q (or any verify-only seat) when collecting runtime evidence from project serve/test commands so PASS never comes from code-read alone. Prefer this over spire-tech-code-review for observation; prefer code-review for static Critical security sweep after observation.
---

# Runtime observation — watch it do the thing

Own **how to observe** a running feature for verification: boot, exercise, cite evidence tokens, and
refuse code-read PASS. Do **not** own write_scope, verdict grammar ownership, or repair — QA (or the
invoking verify role) does.

**Exit artifact:** observation evidence attached to AC verdicts / report rows (not a parallel OBSERVE.md).

## Critical procedure

1. **Read serve/test truth from project config.** Use `project.json` serve and test commands (and
   backend URL when required). Do not invent alternate boot rituals.
2. **Boot before judging.** Start backend and frontend the project way when the feature needs them.
   If boot is impossible, record **UNVERIFIABLE** with the exact blocker — never PASS from source.
3. **Exercise the criterion as a user/gate would.** Prefer observable UI/API behavior over reading
   implementation. Quote what you did and what you saw.
4. **Evidence tokens.** For each PASS, keep enough of: command or action, input, observed output,
   and where it was seen. Narrative without observation is not evidence.
5. **Code-read is secondary.** Read code only to explain a failed observation or to support a
   mandatory Critical sweep — never as a substitute for runtime observation.
6. **Browser path when user-facing.** When host tooling allows, settle the app, use selectors from
   rendered state, keep server lifecycle outside the script. Source-only UI checks are review at best.
7. **Hand off.** Attach evidence to the role's authorized report; do not mint parallel genres.

## Reference routing

| Read when | Reference |
| --- | --- |
| Boot failures / UNVERIFIABLE | [Boot and blockers](references/boot-and-blockers.md) |
| What counts as evidence | [Evidence tokens](references/evidence-tokens.md) |

## Stop conditions

Stop when serve commands are missing, the environment cannot run the project, or two contradictory
observations of the same AC cannot be reconciled after one re-run. Report the gap; do not invent PASS.

## Do not

- Do not mark PASS because "the code looks correct."
- Do not trust builder receipts or chat summaries as observation.
- Do not soft-brand FAIL as UNVERIFIABLE without a precise runtime/fixture blocker.
- Do not invent parallel observation documents.
- Do not repair product code to make observation green.
