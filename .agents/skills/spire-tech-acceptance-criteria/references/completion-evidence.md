# Completion evidence

## Fresh means current bytes

Run the exact command after the final relevant change. A result from before the last edit does not verify the current state. Read the exit code, failure count, skip count and the output that names what ran.

## Match scope to the claim

- A focused test proves the changed behavior.
- The relevant package or lane suite checks nearby regressions.
- The full required suite supports a repository-wide completion claim.
- A build, type check, lint, visual inspection or runtime exercise proves only its own dimension.

Do not substitute one green dimension for another. “Lint passed” does not establish that tests or a build passed.

## Compare requirements and diff

After commands are green, reread the acceptance criteria and binding constraints point by point. Review the actual diff for omitted files, weakened assertions, accidental scope, stale guidance and uncommitted generated output.

## Prove enforcement claims by mutation

When claiming a validator, test or gate makes a failure impossible:

1. Plant the smallest violation.
2. Run the exact checker and observe the intended failure.
3. Restore the original byte.
4. Run again and observe green.

A check that was only observed green has not proved that it can reject.

## Report precisely

State the command, exit result and counts you actually observed. Name any skipped, unavailable or manually reviewed item. Never use “should pass” as evidence and never let an omitted check disappear from the report.
