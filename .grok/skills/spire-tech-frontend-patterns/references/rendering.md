# Rendering and scheduling

**Stack:** React or Next with concurrent features when declared.

## Hydration

- Avoid server/client text mismatches; suppress only when the mismatch is **expected and documented**.
- Prefer patterns that prevent flicker for client-only data (inline bootstrap script when the project
  already uses that pattern — do not invent one against canon).

## Lists and heavy UI

- Use content-visibility or virtualization for long lists when the project supports it and metrics
  demand it.
- Hoist static JSX outside components when it never depends on props/state.
- Animate wrapper elements rather than expensive SVG roots when applicable.

## Transitions and urgency

- Use transitions / deferred values for **non-urgent** updates when the declared React version
  supports them and input responsiveness matters.
- Prefer framework loading indicators over ad-hoc flags when they compose with Suspense.

## Conditional render

- Prefer ternary over `&&` when the left side can be `0` or other falsy renderables.
- Do not hide accessibility requirements behind “simple” conditional trees.

## Resource hints

- Use documented preload/prefetch APIs for critical assets when the framework exposes them.
- Prefer `async`/`defer` on third-party scripts per project policy.

## Measure first

Rendering “optimizations” without a metric (interaction latency, CLS, long tasks) are optional
polish — do not block shipping on unmeasured memoization.
