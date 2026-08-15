---
name: "source-command-spire-tech"
description: "Select the installed Spire Tech cluster for this Codex session."
---

# source-command-spire-tech

Use this skill when the user asks to run the migrated source command `spire-tech`.

## Command Template

This is **cluster entry** for `spire:tech` — the human interface into the tech cluster, not the whole product and not a finished ascent.
Run `node .spire/bin/spire.mjs run tech --provider Codex` before doing anything else and require it succeeds.
Then read the validated native conductor at `.Codex/ORCHESTRATOR.md` and follow its boot sequence.
The conductor mediates tech's default **delivery ascent** (discovery → council → plan → build → QA → ship). Prefer this entry for cold start; `/conductor` only re-boots that mediator.
This selection does not mean any role or gate executed.
