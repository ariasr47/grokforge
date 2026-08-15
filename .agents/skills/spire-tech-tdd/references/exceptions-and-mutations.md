# Exceptions and mutation proof

## Exceptions are prospective and explicit

A true exception is decided before production implementation and recorded by the plan or owner. Examples may include a disposable exploration that will be deleted, generated output whose generator is tested, or a declarative-only change verified by a stronger existing check. “The code is already written” is not an exception.

When an exception applies, name the replacement evidence and its limits. Do not call untested behavior TDD.

## Mutation proves the rejecting side

Use mutation when the claim is that a test, validator or gate prevents a class of defect:

1. Start from green.
2. Plant one minimal violation that the check is supposed to reject.
3. Run the exact check and observe the intended failure, not a syntax error or unrelated crash.
4. Restore the original byte.
5. Rerun and observe green.

Useful mutations include deleting a required field, weakening an invariant, admitting a traversal, changing one expected byte, removing an authorization check, or making a supposedly forbidden output possible.

## Avoid self-fulfilling tests

Do not derive the mutation from the implementation's own table and then iterate that same table in the test. State an independent oracle so deleting an implementation entry makes the test fail rather than shrinking both sides together.

## Record the evidence

Report the mutation, the exact command, the intended RED, the restoration and the final GREEN. If the mutation stays green, the claimed enforcement does not exist; fix the check before reporting completion.
