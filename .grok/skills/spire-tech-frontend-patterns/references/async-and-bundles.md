# Async data and bundles (industry craft)

**Stack:** React or Next only. Prefer measured fixes over folklore.
**Dated craft baseline:** 2026-08-10.

## Waterfalls (critical)

1. **Start independent work early** — kick off independent promises before sequential awaits.
2. **Await only where needed** — move `await` into branches that use the result; check cheap sync
   conditions before remote calls.
3. **Parallelize siblings** — `Promise.all` (or project-equivalent) for independent fetches.
4. **Partial dependency graphs** — when B needs A but C is independent, do not serialize C behind A.
5. **Suspense boundaries** — stream independent UI when the framework and version support it; do not
   block the whole page on one slow leaf.

## Bundle size (critical)

- Prefer **direct imports** when barrels pull expensive modules or defeat tree-shaking.
- Prefer **statically analyzable** import paths for bundler/trace tools.
- **Dynamic-import** heavy, rarely used UI (modals, charts, admin panels) when the toolchain supports it.
- Defer third-party analytics/logging until after hydration or first interaction when product allows.
- Load optional feature modules only when the feature is activated.

## Server-side (when RSC / server components apply)

- Authenticate server actions and mutations like API routes.
- Deduplicate per-request work with the framework's cache primitives **when declared**.
- Minimize data serialized across the server→client boundary.
- Avoid module-level mutable request state on the server.
- Restructure trees so independent server fetches can run in parallel.

## Client data fetching

- Deduplicate identical in-flight requests (SWR/React Query/project client — use what the project has).
- Share global event listeners; prefer passive listeners for scroll where appropriate.
- Version and minimize `localStorage` payloads when used.

## Bundle analysis discipline

Before large “optimizations,” record:

1. What metric moves (LCP, TTI, JS KB, hydration time).
2. Which import path caused the cost.
3. That the fix does not break the approved UX (loading states remain).

## Anti-patterns

| Avoid | Prefer |
| --- | --- |
| Await A then B when independent | Parallel start |
| Import whole icon/library barrels | Per-icon / direct path |
| Blocking full page for one widget | Suspense or progressive section |
| Memo/useMemo as first resort | Fix data shape and composition first |
