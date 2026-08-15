---
name: spire-tech-react-server-client
description: Use when the declared stack is React or Next with server components, SSR, or server actions and the work is server/client boundaries, secrets, or serialization. Prefer this over spire-tech-frontend-patterns for boundary focus. Skip pure CSR or non-React stacks.
---

# React server/client boundaries

Own **server vs client boundary craft** when the project uses RSC/SSR/server actions. Skip pure CSR.

## Critical procedure

1. Confirm framework mode (RSC/SSR/server actions) and major version; stop if unknown or pure CSR.
2. Keep secrets, tokens, and privileged checks on the **server**.
3. Mark client entry only where browser APIs or interactivity demand it.
4. Authenticate server actions/mutations like public endpoints; validate inputs server-side.
5. Minimize data serialized to the client; prefer IDs + follow-up fetch when UX allows.
6. Avoid module-level mutable request state on the server.
7. Do not pass non-serializable values across the boundary.

## Reference routing

| Read when | Reference |
| --- | --- |
| Boundary checklist | [Boundary rules](references/boundary-rules.md) |

## Stop conditions

Stop when rendering mode is unknown, when product requires a client-only secret (report the design
defect), or when rules would override project auth canon.

## Do not

- Do not invent App Router vs Pages conventions without the declared stack.
- Do not put secrets in client bundles or public env.
- Do not apply RSC rules to pure CSR projects.
