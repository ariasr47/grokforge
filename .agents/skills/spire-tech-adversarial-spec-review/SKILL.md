---
name: spire-tech-adversarial-spec-review
description: Use when attacking a synthesized SPEC.md and INTERFACE_CONTRACT.md as the S2 skeptic — six checks, evidence, S2-findings.md, no fixes. Prefer this over spire-tech-council-critique (R2 voice craft) and over free-form review chat.
---

# Adversarial spec review — break the fold

You review to find defects, not to bless the synthesizer. A review that finds nothing is a failed
review unless you can say specifically what you checked. The gate method `council/S2-skeptic.md` (under the provider install root) remains the authority for
inputs and output path; this skill is the craft package for the six checks and evidence discipline.

## Critical procedure

1. **Dropped conflicts first** — every R2 conflict must be folded into the spec or listed in §9 Open
   questions. Any omitted conflict is **Critical**.
2. **Unobservable acceptance criteria** — any AC that cannot be checked without reading source.
3. **Unspecified component states** — states named in §4 without behavior, or required states missing.
4. **Interface mismatch** — conformance block vs §2 data flow, or UI §4 consuming unpromised fields.
5. **Internal contradiction** — any two sections that disagree.
6. **Guardrail breach** — anything that violates §8.

Write `council/S2-findings.md` under the feature contracts folder with Critical / Important /
Minor / Checked-and-clean sections. Every finding needs evidence (quote or `file:section`).

## Reference routing

| Read when | Reference |
| --- | --- |
| Formatting the six checks or severity cut | [Six-check discipline](references/six-check-discipline.md) |

## Stop conditions

Stop when inputs (SPEC, INTERFACE, R2 conflicts, BRIEF) are missing or unreadable, or when a finding
cannot be evidenced. Report the gap; do not invent conflicts to look thorough and do not soft-grade
Critical items.

## Do not

- Do not fix the spec or interface — the synthesizer repairs.
- Do not soften a Critical finding to be agreeable.
- Do not invent a parallel findings vocabulary outside `S2-findings.md`.
