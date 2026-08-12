---
name: spire-tech-react-composition
description: Use when the declared stack is React or Next and the work is component API design — variants, compound components, context seams. Prefer this over spire-tech-frontend-patterns for API shape; prefer frontend-patterns for waterfalls/bundle/server overview. Skip other stacks.
---

# React composition — APIs that scale

Own **React component composition craft** only when the consumer declares React/Next. Project canon
and declared React version outrank these rules.

## Critical procedure

1. Confirm React/Next + declared version; stop if unknown or non-React.
2. Replace boolean-prop sprawl with **named variants** or compound parts.
3. For compounds: stable context interface (`state` / `actions` / `meta`); provider owns storage.
4. Lift shared state only to the nearest coordinating owner; no global context for local state.
5. Prefer children/slots for layout; render props only when the caller needs component data/behavior.
6. Use version-correct ref/context APIs; do not migrate working compatibility code without value.
7. Route depth to references; do not invent a separate design doc.

## Reference routing

| Read when | Reference |
| --- | --- |
| Full composition patterns | [Composition depth](references/composition-depth.md) |

## Stop conditions

Stop when the stack is not React/Next, the version is unknown, or a rule would override project canon
or approved feature direction.

## Do not

- Do not apply React composition rules to other stacks.
- Do not out-rank project design canon or SPEC §4.
- Do not use memo/context as default performance theater without a composition need.
