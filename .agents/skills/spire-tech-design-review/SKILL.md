---
name: spire-tech-design-review
description: Use when a user-facing surface needs review for usability, hierarchy, system consistency, accessibility, or interaction (UX R1, frontend exit, or GATE Q). Prefer spire-tech-component-states for state matrix craft and spire-tech-microcopy-integrity for copy/data integrity. Prefer this over spire-tech-frontend-patterns (React implementation craft, not review).
---

# Design review — intent, evidence, correction

Use the consumer's project design canon when one is set (`DESIGN_SYSTEM.md` under the project context
dir, `Status: SET`), then the approved feature direction in SPEC §4. When the file is `UNSET` or
absent, review only against the bounded feature direction. This skill is the provider-neutral review
method; it does not supply brand taste, does not author the canon, and does not overrule a SET
authority.

## Critical procedure

1. **Purpose and first impression** — can the intended user tell what this surface is and what to do next?
2. **Task and navigation** — can the primary task be completed without guessing, dead ends or lost context?
3. **Hierarchy and composition** — does attention follow importance through layout, typography, spacing and density?
4. **Consistency and system fit** — do equivalent things look and behave alike, using existing tokens and components?
5. **States and resilience** — inspect empty, loading, error, stale, offline, success, confirmation, short and long content.
6. **Accessibility and interaction** — verify keyboard, focus, semantics, announcements, forms, motion and touch behavior.

Compare the actual surface with the stated intent, not personal taste. Match review depth to maturity: an early concept needs structural direction; a release candidate needs complete states and polish.

## Findings

Prioritize by task blockage, misleading behavior, accessibility, inconsistency and polish. State the observation, user impact and a concrete alternative. Also name deliberate choices worth preserving so correction does not erase what works.

## Reference routing

| Read when | Reference |
|---|---|
| Reviewing purpose, navigation, hierarchy or overall usability | [Usability critique](references/usability-critique.md) |
| Reviewing labels, instructions, errors, states, tone or localization | [UX copy](references/ux-copy.md) |
| Reviewing tokens, components, variants, consistency or migration | [Design system](references/design-system.md) |
| Reviewing keyboard, semantics, forms, motion, announcements or content resilience | [Accessibility and interaction](references/accessibility-and-interaction.md) |

## Stop conditions

Stop when the surface cannot be observed (no render, no fixture, no declared states) or when the
project canon and approved feature direction contradict each other. Report the conflict; do not
invent brand taste to fill the gap.

## Do not

- Do not invent, duplicate or overrule a project design canon.
- When no project canon exists, review the bounded feature direction without pretending it is a durable project system.
- Do not hard-code around a missing token; name the system gap.
- Do not produce a separate document; findings land in the role's existing artifact.
