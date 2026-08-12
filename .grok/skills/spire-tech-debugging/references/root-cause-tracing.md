# Root-cause tracing

Start where the invalid value, exception or side effect becomes visible, then move backward one caller or transformation at a time.

At each step ask:

1. What exact value entered?
2. Who produced it?
3. What assumption should have held here?
4. Was the value already invalid on entry, or did this step corrupt it?

Continue until reaching the first point where valid state became invalid. Fix that point rather than adding a guard to the final crash.

Use the smallest evidence that distinguishes hypotheses: one focused log at a boundary, one assertion, one reduced input or one comparison with known-good data. Remove temporary instrumentation after the diagnosis unless it earns permanent observability value.

When the trace crosses an asynchronous callback, queue, cache or persistence layer, record identity and ordering information sufficient to connect cause and effect. Do not assume chronological log adjacency proves causality.
