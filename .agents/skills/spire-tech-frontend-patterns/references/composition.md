# React composition (industry craft)

**Stack:** React or Next only. Project canon and declared version outrank these defaults.
**Dated craft baseline:** 2026-08-10 (reverify APIs against the consumer's React major).

## Compose variants instead of boolean sprawl

When boolean props create many combinations, expose **explicit variant components** or composable
parts. Callers choose a meaningful form; they should not solve an internal truth table.

## Compound-component contract

For a compound component, define a stable context interface:

- `state` — observable values consumers render
- `actions` — operations consumers may invoke
- `meta` — status or capabilities (disabled, pending, validation)

Keep the provider as the **only** component that knows how state is stored. Consumers depend on the
interface, not the storage implementation.

## Dependency seams

Inject state or services through a provider or explicit prop when reuse, testing, or environment
variation requires it. Do not import one global implementation into every child. Dependency injection
earns its cost when multiple implementations or isolated tests are real.

## Shared state placement

Lift state to the **nearest owner** that coordinates the participating components. Avoid drilling
through components that do not use the value. Do not create global context for purely local state.

## Children and slots

Use children or named composable parts when the caller owns layout. Use render callbacks when the
caller needs data or behavior from the component — not as a default substitute for children.

## Version-aware refs and context

Use the ref and context APIs supported by the **declared** React version. Modern APIs can simplify
new code; migrating working compatibility code needs its own value and tests.

## Anti-patterns

| Avoid | Prefer |
| --- | --- |
| `isPrimary && isLarge && isLoading` prop soup | Named variants / compound parts |
| Context for every leaf prop | Local state + props until coordination is real |
| Components defined inside components | Module-level components (stable identity) |
| Props that only forward unused values | Explicit slot ownership |

## Read more when

- Redesigning a public component API under change.
- Tests require swapping implementations.
- Boolean props have grown past ~3 interacting flags.
