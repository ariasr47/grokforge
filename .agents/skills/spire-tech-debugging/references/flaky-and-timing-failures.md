# Flaky and timing-sensitive failures

An intermittent failure is missing state or ordering information. Re-run enough to establish the trigger dimensions, then control them one at a time: clock, randomness, scheduling, network, resource availability, shared state, test order and cleanup.

Replace arbitrary sleeps with a condition that represents readiness or completion. Poll with a bounded timeout and report the last observed state. A longer sleep hides the race and makes the suite slower without proving correctness.

For concurrency failures, record event identity, ordering and ownership. Check read-then-write gaps, duplicate delivery, cancellation, stale callbacks, shared mutable state and cleanup that races the next case.

For external dependencies, distinguish service refusal, timeout, malformed response, partial response and local parsing. Preserve the original evidence; retrying until green can erase the failure mode.

A quarantine or retry policy is containment, not a root-cause fix. Name it as residual risk and keep the diagnostic case.
