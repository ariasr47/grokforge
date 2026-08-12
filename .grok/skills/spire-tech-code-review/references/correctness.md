# Correctness review

## State and boundaries

Check empty, one, many, minimum, maximum, null, absent, duplicate and out-of-order states. Distinguish values that the type or protocol distinguishes. Look for off-by-one errors, unit mismatches, truncation and defaults that erase meaning.

## State transitions

Identify allowed states and transitions. Reject impossible transitions rather than coercing them. Confirm retries, cancellation and duplicate delivery cannot apply one logical action twice.

## Concurrency

Inspect shared mutable state, read-then-write gaps, check-then-act logic, transactions, locks and optimistic version checks. A test that only exercises serial order does not clear a reachable race.

## Errors and cleanup

Failures must remain failures. Look for swallowed exceptions, success returned after partial work, cleanup that hides the original error, resources left open and rollback that omits one side effect. Preserve useful context without exposing secrets.

## Contract adherence

Compare emitted and consumed fields, status and error forms, optionality, ordering and version assumptions with the binding interface. Avoid accepting extra shapes merely because the current caller happens to tolerate them.
