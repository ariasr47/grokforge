---
name: spire-tech-invariant-honor
description: Use when applying context-pack domain, isolation, and promoted build invariants during build-lane implementation. Prefer this over free-form "remember the rules" lists. Prefer spire-tech-acceptance-criteria for AC rows, not invariant inventory.
---

# Invariant honor — context pack is binding

Own **how to load and apply** feature context-pack invariants during build. Do not invent invariants;
do not own product scope.

**Exit artifact:** implementation that satisfies named invariants + done-report notes of which were
checked — no INVARIANTS.md parallel file.

## Critical procedure

1. **Read the feature context pack** (`_context-pack.md` or regenerate via gates context_for when absent).
2. **Extract binding items:** domain/math constraints, isolation/error rules, promoted build
   invariants, byte-identity guarantees.
3. **Checklist before coding and before done.** Each item: still holds / not applicable (why) / broken.
4. **Never silently drop** a promoted invariant because the feature is "untagged" if the pack carries it.
5. **On conflict** with local convenience, stop and GATE Z — do not weaken the invariant in code.

## Reference routing

| Read when | Reference |
| --- | --- |
| What counts as binding | [Binding set](references/binding-set.md) |

## Stop conditions

Stop when the pack is missing and cannot be regenerated, or when two pack rules contradict. Report;
do not pick a favorite rule silently.

## Do not

- Do not invent project-specific math or isolation policy.
- Do not bury invariant checks only in chat memory.
- Do not expand into contract authorship.
