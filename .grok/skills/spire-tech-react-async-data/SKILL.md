---
name: spire-tech-react-async-data
description: Use when the declared stack is React or Next and the work is data fetching, waterfalls, caching, or bundle cost of async UI. Prefer this over spire-tech-frontend-patterns for fetch/waterfall focus; prefer frontend-patterns for general React attention order. Skip other stacks.
---

# React async data — kill waterfalls

Own **async data and bundle-impact craft** for React/Next only. Measure when claiming wins.

## Critical procedure

1. Confirm React/Next + version; stop if unknown or non-React.
2. **Start independent work early**; await only where the result is needed.
3. **Parallelize** sibling fetches; do not serialize independent work.
4. Check cheap sync conditions before remote calls.
5. Use Suspense/streaming boundaries when the framework version supports splitting independent UI.
6. Prefer direct imports over expensive barrels; dynamic-import heavy optional UI when toolchain allows.
7. Deduplicate in-flight client requests with the project's data library when present.
8. Record metric intent (LCP/JS KB/hydration) before large "optimizations."

## Reference routing

| Read when | Reference |
| --- | --- |
| Waterfall and bundle checklist | [Async checklist](references/async-checklist.md) |

## Stop conditions

Stop when stack/version unknown, when product forbids the caching strategy, or when "optimization"
would break approved loading UX without a measured gain.

## Do not

- Do not apply React data rules off-stack.
- Do not memo-first; fix waterfalls and data shape first.
- Do not invent SWR/React Query if the project uses another client.
