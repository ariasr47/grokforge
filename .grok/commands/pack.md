---
description: Show / emit the minimal context pack a feature needs (system-5 sharding).
argument-hint: <feature-folder> [--print|--write]
---
For feature `$ARGUMENTS`, run the ground-truth retrieval tool and report. (The context filename comes
from `project.json` → `context_file`.)

- Default (`--stat`): `node .grok/tools/gates.mjs context_for $ARGUMENTS` — show
  which context sections LOAD (always-load invariant floor + the BRIEF's `Context tags:`) vs skip, and
  the line savings.
- If I pass `--write`: run `node .grok/tools/gates.mjs context_for $ARGUMENTS --write`
  — this materializes `.spire/clusters/tech/contracts/$ARGUMENTS/_context-pack.md` and prints one line. That PATH is
  what you hand a fresh role subagent instead of the whole canon; never relay the pack's contents.
- If I pass `--print`: run `node .grok/tools/gates.mjs context_for $ARGUMENTS --print`
  and emit the assembled pack to this session, for inspecting the pack's contents yourself — not for
  handing to a spawn (that always goes through `--write` above).

Reminder: the invariant floor always loads, so a feature with no `Context tags:` is under-informed but
never unsafe.
