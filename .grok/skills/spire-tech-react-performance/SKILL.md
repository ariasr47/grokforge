---
name: spire-tech-react-performance
description: Use when the declared stack is React or Next and the goal is measured performance — bundle, hydration, re-renders, lists. Prefer this over spire-tech-react-async-data when the metric is client cost after data shape is fixed. Skip other stacks. Prefer measure-first over memo theater.
---

# React performance — measure then fix

Own **performance craft** for React/Next with evidence-gated changes.

## Critical procedure

1. Confirm React/Next; stop if non-React.
2. **Name the metric** (bundle KB, LCP, hydration, interaction latency) before changing code.
3. Fix **waterfalls and data shape** first (`spire-tech-react-async-data`) when they dominate.
4. Bundle: direct imports, code-split heavy optional UI, avoid expensive barrels.
5. Re-render: fix unstable props/context value identity; memo only expensive pure subtrees with evidence.
6. Lists: virtualize or content-visibility only when length and metrics justify it.
7. Record before/after evidence in the done-report; no silent "optimized."

## Reference routing

| Read when | Reference |
| --- | --- |
| Memo and list guidance | [Perf tactics](references/perf-tactics.md) |

## Stop conditions

Stop when no metric is defined and "optimization" would risk correctness or UX, or when version APIs
for concurrent features are unknown.

## Do not

- Do not wrap everything in memo/useMemo/useCallback by default.
- Do not sacrifice accessibility or correctness for micro-benchmarks.
- Do not invent metrics without measurement method.
