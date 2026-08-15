---
name: spire-tech
description: Select the installed Spire Tech cluster for this Grok Build session.
---

# Spire Tech selector

This is **cluster entry** for `spire:tech` — the human interface into the tech cluster, not the whole product and not a finished ascent.
Run `node .spire/bin/spire.mjs run tech --provider grok` before doing anything else and require it succeeds.
Then read the validated native conductor at `.grok/ORCHESTRATOR.md` and follow its boot sequence.
The conductor mediates tech's default **delivery ascent** (discovery → council → plan → build → QA → ship). Prefer this entry for cold start; the conductor is not a second product surface.
This selection does not mean any role or gate executed.
