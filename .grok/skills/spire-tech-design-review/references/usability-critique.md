# Usability critique

## Establish intent

Name the intended user, primary task and success state from the approved spec. If the surface cannot be judged without inventing those, report the missing decision instead of substituting taste.

## First impression and hierarchy

At a glance, identify what appears primary, secondary and actionable. Compare that order with the task. Check headings, grouping, whitespace, typography, contrast and density. A visually loud secondary control is a hierarchy defect even when every element is present.

## Navigation and task flow

Walk the primary task from entry to completion. Check orientation, next actions, back/cancel behavior, destructive exits, preserved work and recovery from failure. Warn before navigation discards unsaved work. Look for dead ends, ambiguous branching, hidden prerequisites and controls whose labels do not predict their result.

## Complete states

Inspect initial, empty, loading, partial, error, stale, offline, success and confirmation states using realistic short and long content. A state that exists only in implementation logic but was not looked at is unreviewed.

## Prioritize findings

- Critical: blocks the primary task, misleads a consequential decision or excludes essential access.
- Important: creates repeated friction, inconsistency or likely error.
- Minor: polish that does not block understanding or completion.

For each finding state observation, impact and a concrete alternative. Record successful choices that the correction must preserve.
