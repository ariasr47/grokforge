# Performance review

## Bound the work

Check pagination, batch size, recursion, retries, fan-out, payloads and user-controlled limits. Work proportional to the entire data set or an untrusted value needs an explicit bound.

## Query and I/O shape

Look for queries or remote calls inside loops, missing selective predicates, absent indexes on hot filters, repeated reads, sequential independent I/O and fetching fields or rows never used. Verify the optimization against the actual access path rather than assuming an index or cache helps.

## Resource lifetime

Check streams, files, sockets, listeners, timers, subscriptions, workers and large buffers for cleanup on success, failure and cancellation. A leak that is tiny per request can still be production-critical.

## Algorithm and allocation

Notice nested scans, repeated sorting or parsing, avoidable copies and data structures with the wrong lookup cost. Optimize demonstrated or structurally unbounded cost; do not trade clarity for speculative micro-optimization.

## Cache correctness

Check key scope, invalidation, expiry, stampede behavior, stale-data tolerance and authorization context. A faster wrong or cross-tenant result is a correctness or security defect, not a performance win.
