---
name: spire-tech-code-review
description: Use at GATE Q when inspecting shipped code for security, correctness, performance, or maintainability risks and recording findings in QA_REPORT.md. Prefer this over spire-tech-debugging (build-lane fix loops) and over free-form review chat.
---

# Code review dimensions for GATE Q

Read implementation to determine whether observed behavior is trustworthy and whether a defect exists outside incomplete acceptance criteria. This skill creates no document: findings belong in `QA_REPORT.md` under its existing verdict vocabulary.

## Critical procedure

1. **Finding contract** — every finding states: severity (Critical | Important | Minor); exact file and tight line range; evidence; impact and reachable failure mode; smallest remediation; criterion id or “criteria gap.” No style preference as defect. Severity follows impact and reachability.
2. **Critical security floor** — no other role owns security review. Authn/authz, cross-tenant, secret-exposure, destructive-data, or binding-invariant defects are GATE Q FAIL even when no AC names them. Report defect and missing criterion; never soft-grade.
3. **Walk dimensions** — Security (trust boundaries, injection, disclosure); Correctness (state, concurrency, contracts); Performance (queries, resource lifetime); Maintainability (cohesion, tests that protect behavior).

## Reference routing

| Read when | Reference |
|---|---|
| Code handles identity, untrusted input, secrets, tenants or destructive actions | [Security review](references/security.md) |
| Code changes state, boundaries, concurrency, types or error paths | [Correctness review](references/correctness.md) |
| Code performs queries, loops, I/O, caching or potentially unbounded work | [Performance review](references/performance.md) |
| The change adds abstractions, duplication, tests or long-lived maintenance cost | [Maintainability review](references/maintainability.md) |

## Stop conditions

Stop when severity, location, or impact cannot be stated from evidence, or when a Critical path
requires a product/spec decision outside QA authority. Report the gap; do not soft-grade Critical
defects into silence.

## Do not

- Do not invent another report or approval vocabulary.
- Do not fix code; QA verifies and bounces.
- Do not hide a criteria gap or use it to make a live Critical defect nonblocking.
