---
name: spire-tech-frontend-patterns
description: Use when the declared frontend stack is React or Next for general composition/data/server/client/rendering guidance; skip other stacks. Prefer spire-tech-react-composition for API/variant design, spire-tech-react-async-data for fetch/waterfalls, spire-tech-react-server-client for RSC boundaries. Prefer spire-tech-flow-integration-tests for SPEC journey tests on any stack.
---

# Frontend patterns — React-conditional guidance

Use this skill only when the consumer declares React or Next. Read the project's React version, framework, rendering mode, bundler and canon before applying a rule. Project evidence outranks generic advice.

## Critical procedure

1. Confirm stack is React/Next and read declared version, rendering mode, bundler, and project canon.
2. Remove request waterfalls and serialize only real dependencies.
3. Keep server/client boundaries, authorization and serialization correct.
4. Reduce bundle and hydration cost using the actual toolchain.
5. Shape components through composition and explicit variants.
6. Prevent unnecessary work and resource leaks on the client.
7. Use rendering and scheduling features where they improve observed behavior.
8. Route to references below for depth; do not apply rules the declared version does not support.

## Conditional corrections

- Prefer direct imports when a barrel defeats tree-shaking, pulls expensive modules or harms development performance; do not ban every barrel categorically.
- React versions that support ref as a prop reduce the need for new `forwardRef` wrappers; existing compatibility code is not automatically wrong.
- `use()` and `useContext()` have different constraints and valid uses. Choose from the declared version and component needs rather than treating one as universally superior.

## Reference routing

| Read when | Reference |
|---|---|
| Designing component APIs, variants, shared state or dependency seams | [Composition](references/composition.md) |
| Fetching data, awaiting work, analyzing bundles or loading third parties | [Async and bundles](references/async-and-bundles.md) |
| Using server rendering, server actions, caching or serialization | [Server patterns](references/server.md) |
| Managing browser state, listeners, storage or client requests | [Client patterns](references/client.md) |
| Handling Suspense, transitions, hydration, long lists or resource hints | [Rendering patterns](references/rendering.md) |

## Stop conditions

Stop when the project is not React/Next, the declared version is unknown, or a rule would override
project canon or the approved feature direction. Skip this skill rather than force React guidance.

## Do not

- Do not apply React rules to another stack.
- Do not assume a framework feature or React API exists without the declared version.
- Do not out-rank the consumer's project-owned canon, `PROJECT_CONTEXT.md`, or the approved feature direction.
- Do not create a separate document; apply the guidance in the lane's implementation and report.
