# Client patterns

**Stack:** React or Next client components / CSR islands.

## State

- Prefer local state until multiple distant consumers need the same value.
- Derive values during render when possible; avoid effect chains that mirror props into state.
- Initialize expensive state lazily (`useState(() => …)` pattern when supported).
- Keep event handlers stable when children depend on reference equality — without premature memo
  theater.

## Effects

- Put interaction logic in **event handlers** when the work is user-driven, not in effects that
  re-run on every render.
- Do not subscribe to state only used inside a callback; read it when the callback fires.
- Clean up listeners, timers, and observers; prefer shared passive listeners for high-frequency events.

## Storage and network on the client

- Cache storage reads for the session when repeated.
- Deduplicate client fetches with the project's data library when present.
- Version schema for any persisted client state.

## Anti-patterns

| Avoid | Prefer |
| --- | --- |
| Effect to sync prop → state always | Controlled props or key remount |
| New component functions inside render | Module-scope components |
| Memo everywhere “for performance” | Measure, then memo expensive pure subtrees |
| Module-level mutable client stores without reset | Explicit store with test reset hooks |
