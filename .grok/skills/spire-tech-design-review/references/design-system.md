# Design-system review

## Reuse before invention

Compare the surface with existing tokens, components and interaction patterns. Reuse a semantic token or supported variant when it expresses the same role. Do not force a mismatch merely to avoid a justified system addition.

## Component completeness

Check each component's supported variants, sizes and states: rest, hover, focus, active, disabled, loading, error and selected where applicable. A one-off state implemented only on one screen is a system gap.

## Token discipline

Use semantic tokens for meaning and base tokens for construction according to the existing system. Flag raw values that duplicate an existing token, and flag missing semantic roles explicitly rather than hard-coding around them.

## Coverage and consistency

Equivalent actions, statuses and content should use the same component and behavior. Check responsive behavior, themes and platform variants the project supports. Inconsistency includes interaction and state handling, not only appearance.

## Version and migration

When a shared component or token changes, identify affected consumers, compatibility expectations, migration path and removal point for deprecated forms. A new variant without ownership or adoption guidance creates system debt.

This reference reviews the surface and identifies system work against the project canon when set
(project context `DESIGN_SYSTEM.md`). It does not create or fill that file — onboarding process /
owning roles do.
