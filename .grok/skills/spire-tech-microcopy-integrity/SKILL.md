---
name: spire-tech-microcopy-integrity
description: Use when writing or reviewing labels, tooltips, empty/error copy, or glossary text so wording never invents or renames data meaning. Prefer this over spire-tech-design-review when the defect class is copy/data integrity, not full usability. Prefer design-review for hierarchy, layout, and interaction.
---

# Microcopy integrity — words that match data

Own **copy integrity craft**: labels, tooltips, empty/error strings, and glossary text must not assert
a meaning the data or contract does not support. Do **not** own layout system, write_scope, or
server field invention.

**Exit artifact:** corrected or proposed copy inside the UX R1 / design-review findings / SPEC §4 —
no parallel COPY.md.

## Critical procedure

1. **Trace each number and label to a source.** For every user-visible value or named metric: what
   field, calculation, or invariant vouches for it? If none, flag as unsupported.
2. **Ban silent renames.** If the data is "remaining_quota" do not label it "unlimited" or "score"
   without an explicit product decision and AC.
3. **Empty and error copy must be honest.** Empty is not "all done." Error is not "success with caveats."
   Offline/stale must say so when that state is real.
4. **Tooltips and glossary** explain; they do not invent new metrics or change units.
5. **Binding framing.** Honor project-owned framing and brand constraints without inventing a durable
   brand system when none exists.
6. **Pair with states.** Copy for each component state must match that state's reality
   (`spire-tech-component-states`).
7. **Hand off.** Put copy in the role's authorized artifact; withdraw claims you cannot defend.

## Reference routing

| Read when | Reference |
| --- | --- |
| Label/data mismatch patterns | [Integrity failures](references/integrity-failures.md) |
| Empty/error/offline wording | [State copy](references/state-copy.md) |

## Stop conditions

Stop when the data source is unknown and inventing a label would fabricate meaning, when product and
canon conflict on terminology, or when the only available "meaning" is another agent's narrative with
no field pointer. Report the gap; do not invent.

## Do not

- Do not assert a number without a vouched source.
- Do not rename fields in the UI to sound better when that changes meaning.
- Do not invent metrics, units, or guarantees absent from BRIEF/SPEC/INTERFACE.
- Do not expand into visual design system ownership.
- Do not invent parallel copy decks or glossaries outside the role artifact.
