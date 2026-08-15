# Server patterns (RSC / SSR — version-gated)

**Apply only when** the consumer declares server components, SSR, or server actions and the declared
framework version supports the feature. Skip on pure CSR stacks.

## Boundaries

- Keep secrets, tokens, and privileged checks on the **server**.
- Mark client entry with the project's required directive (`"use client"` or equivalent) only where
  browser APIs or interactivity demand it.
- Do not pass non-serializable values across the server→client boundary.

## Auth and mutations

- Treat server actions / route handlers as public endpoints: authenticate and authorize every mutation.
- Validate inputs on the server even if the client already validated.

## Caching and dedup

- Use framework cache APIs **as documented for the declared major version**.
- Prefer per-request memoization for repeated server reads in one render.
- Do not invent a global mutable server singleton for request-scoped data.

## Data shaping

- Fetch on the server when data is needed for first paint and auth allows.
- Minimize props shipped to client components; pass IDs and let the client load secondary detail when
  that matches the approved UX.

## Stop

If the version or rendering mode is unknown, stop and ask — do not guess App Router vs Pages vs CSR.
