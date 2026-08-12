# Writing good tests

## Test behavior through a public seam

Arrange the smallest meaningful state, perform the public action, and assert the observable result. A source-text search, private-method call or implementation-shaped snapshot proves structure rather than behavior unless structure itself is the binding invariant.

## Make expected values independent

Do not calculate the expected result with the same production function or algorithm under test. Use a worked example, fixed fixture, independently derived value or externally defined contract. Shared mistakes make implementation and expectation agree falsely.

## Make RED diagnostic

Name one behavior per test. Keep setup small enough that the first failure points at the missing behavior. Confirm the message, actual value and stack belong to that behavior before writing production code.

## Use realistic boundaries

Prefer real value objects, parsers and in-memory collaborators when they are deterministic and cheap. Mock network, clock, process, filesystem or expensive service boundaries when isolation is necessary. Assert the outcome first; assert an interaction only when the interaction is itself the contract.

Warning signs of mock damage:

- the test recreates production internals;
- a harmless refactor breaks many mocks while behavior is unchanged;
- production gains getters, reset methods or branches used only by tests;
- the mock is more complicated than the collaborator.

## Cover failure and absence

For a successful action, identify the denied, invalid, missing or dependency-failure path with the highest risk. Assert both the reported failure and the negative-space guarantee: no write, no disclosure, no duplicate effect, no partial transition.

## Keep suites trustworthy

Tests must be deterministic, isolated and able to run in any order. Control time and randomness at boundaries. Clean up owned resources. Replace arbitrary sleeps with observable conditions. A flaky test is unresolved behavior, not a harmless inconvenience.
