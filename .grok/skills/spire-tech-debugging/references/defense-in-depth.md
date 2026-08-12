# Defense in depth after root cause

First fix the earliest point that created invalid state. Then ask where else the same class can enter or become dangerous.

Add a secondary defense only when it has a distinct responsibility:

- validate untrusted data at the boundary;
- preserve domain invariants at the domain operation;
- enforce authorization where the protected action occurs;
- constrain persistence with a database invariant;
- fail safely at an output or side-effect boundary.

Each layer needs its own failure behavior and test. Do not duplicate the same check everywhere without defining ownership; duplicated policy drifts.

The final verification must show the original path fixed, the added boundary rejecting invalid state, and valid behavior unaffected. Record any class that remains outside the defense rather than implying complete coverage.
