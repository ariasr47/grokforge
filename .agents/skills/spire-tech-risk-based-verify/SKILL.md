---
name: spire-tech-risk-based-verify
description: Use when choosing or recording how an acceptance criterion is verified (test vs review) or when judging whether a suite covers silent-regression risk. Prefer this over spire-tech-tdd when the decision is verify-by method, not RED-GREEN implementation. Prefer this over spire-tech-acceptance-criteria when criteria rows already exist and only method/evidence remains.
---

# Risk-based verify — test only when silence hurts

Own the **method** of verification for each acceptance criterion: `test` or `review`, depth of
automation, and how the method is recorded. Do **not** own write_scope, lane identity, or whether
GATE Q passes — the invoking role does.

**Exit artifact:** per-AC method record (in SPEC `Verify by`, plan notes, or `QA_REPORT.md` evidence
column) — never a parallel verify genre.

## Critical procedure

1. **Read the criterion as written.** One observable behavior, precondition, and result. If it is not
   independently checkable without source, stop and hand back to criteria authoring
   (`spire-tech-acceptance-criteria`).

2. **Classify regression risk.** Ask: if this broke silently under an unrelated change, would a
   human reviewer still notice on a normal pass?
   - **Silent / invisible risk** → `test` (automate).
   - **Visible / intentional change** → `review` (record inspection).

3. **Mark `Verify by` honestly.**
   - `test` — invariants, negative space, auth boundaries, byte-identity, motion/state that dies under
     refactors, structural rules that compile green while wrong.
   - `review` — copy wording, static presence, cosmetic layout, ordering that is intentional.

4. **Disclose stack limits (H3).** When the consumer is plain ESM + `node --test` (or equivalent)
   **without** a DOM harness (no jsdom/playwright/cypress in the contract), criteria that assert
   paint, layout, focus rings, or browser-only DOM must be `review` — or the SPEC/seam must name the
   harness that will run them. Re-home load-bearing logic (sort, classify, withhold, derive) to pure
   modules so `test` can cover behavior without a DOM. Do **not** default-add jsdom to every consumer.
   Record the limit next to other UNVERIFIABLE / method notes when paint stays review-only.

5. **Choose depth, not count.** Prefer **one** high-level integration / e2e / a11y / visual check that
   protects the behavior over many literal component pokes. Never split one behavior into
   assertion-per-AC theater.

6. **Reject hollow automation.** A green suite that asserts nothing, tolerates absence, or only
   checks "renders without throw" does **not** satisfy a `test` mark.

7. **Record the method.** When verifying (build done-report or GATE Q), write **how** each row was
   checked: test name(s) or `review/QA` with what was inspected. Silence is not evidence.

8. **Do not re-impose one-test-per-AC.** That rule is retired. Risk decides method; observability
   decides whether review is enough.

## Reference routing

| Read when | Reference |
| --- | --- |
| Borderline cases or depth choice | [When to automate](references/when-to-automate.md) |
| Recording method in reports | [Evidence record shape](references/evidence-record.md) |

## Stop conditions

Stop when the criterion cannot be observed, when risk cannot be judged without inventing product
policy the contracts omit, or when required automation is missing and the role forbids inventing
coverage theater. Report the gap; do not mark `test` without a real check.

## Do not

- Do not demand one named automated test per acceptance criterion.
- Do not use `review` for silent invariants to avoid writing a test.
- Do not use `test` for pure copy/cosmetic rows that force brittle snapshots without risk.
- Do not invent parallel documents (`VERIFY_MATRIX.md`, `test-plan-v2`).
- Do not expand into role identity (you are not QA, PM, or the build lane).
- Do not weaken oracles to make a hollow suite look green.
