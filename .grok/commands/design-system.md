---
description: Fill or re-baseline the project living design canon (DESIGN_SYSTEM.md) — codify existing UI or propose greenfield directions under human rule.
---

Run the **living design-canon onboarding process** for this project. Follow
`.grok/design/DESIGN_SYSTEM_METHOD.md` as the authority for steps, modes, skeptic checklist, and
kill signals. Report with operator cards per `.grok/OPERATOR_REPORTS.md`.

You are the **controller**, not the brand designer of record. Do not invent a durable aesthetic in
this session's long context — run preflight, spawn workers only as the method allows, surface Decision
cards, drive synthesizer and skeptic.

## Preconditions

1. Run the model-free preflight first:
   `node .grok/tools/gates.mjs design_system_ready`
   (or `node .grok/tools/design_system_ready.mjs`). Exit 0 and a mode are required. Exit 1 means
   the project is still template/empty — run ``standup/PROJECT_STANDUP_METHOD.md` (product context + backlog onboarding)` first (or fill `project.json` +
   `PROJECT_CONTEXT.md` §1–§2 by hand), or set `frontend: null`; do not invent brand taste.
2. Read `.spire/clusters/tech/project.json`.
3. Ensure `.spire/clusters/tech/context/DESIGN_SYSTEM.md` exists (install scaffold). If missing, stop
   and say the kit scaffold is absent — reinstall or restore the template; do not invent a schema.
4. Optional `$ARGUMENTS`: `rebaseline` to force re-entry when already `SET`; otherwise default is
   fill when `UNSET` / thin re-baseline only if the human asked.

## Detect mode

Per `DESIGN_SYSTEM_METHOD.md`: **no-UI** / **codify** / **propose** (hybrid allowed). State the
detected mode in a ⚪ FYI or 🟡 WORKING card before heavy work.

## Execute

### If mode = propose (critical — do not mis-shape)

**Default:** spawn **one** propose worker that writes a session note with **exactly 2 or 3 complete
rival directions labeled A / B / C** (full systems: name, rejects, type, palette, spacing, motion,
token home). They must differ on type pairing **and** palette; near-duplicates = regenerate.

**Then stop and surface one Decision card** (A / B / C). **Do not SET, do not synthesize, do not
spawn more design workers until the human answers with a letter.**

**Forbidden:** three workers refining **one** shared direction; three workers that “commit” to the
same look; folding proposals into a hybrid before the human picks; treating this like R1 council
(three roles, one system).

Optional parallel (only if needed): three workers with **one slot each** and **distinct axis seeds**;
controller rejects same-family duplicates before the Decision card. Still one A/B/C card.

### If mode = codify

One inspection path (design-review method) → contradiction **Decision cards** (not three agreeing
authors of one system) → after rulings, go to synthesize.

Also inventory **rival authorities** (project design skills, style guides, brand docs that state
tokens/type/palette as rules) and carry each to a **retire-or-stub** Decision card at close — a `SET`
canon must not ship beside a file claiming it wins on conflict. Never delete a project-owned artifact
yourself; the human rules. See the single-authority section of `DESIGN_SYSTEM_METHOD.md`.

### After the human has ruled

1. Record the letter/ruling in a project-owned session note.
2. **Synthesize** — spawn one **fresh** `spire-tech-council-synthesizer` (not the propose worker)
   to write `.spire/clusters/tech/context/DESIGN_SYSTEM.md` with `Status: SET — …` from the **chosen**
   direction only.
3. **Skeptic** — spawn one **fresh** `spire-tech-council-skeptic` with the method checklist. Do **not**
   override its model to match the synthesizer. Cap Critical→rewrite at 2 passes.
4. **Close** — Status card: mode, direction name, cards ruled, skeptic verdict, path to the file.

## Amendments after SET

If the human only wants to accept a wireframe into an existing SET canon, follow the maturation
section of `DESIGN_SYSTEM_METHOD.md` (log + amend; contradiction → Decision card). Do not run a
full propose cycle unless they asked to re-baseline.

## Done means

- `DESIGN_SYSTEM.md` is `SET` (or an honest no-UI leave-`UNSET` with FYI), **and**
- for propose: human picked A/B/C **before** SET, **and**
- skeptic completed (or human accepted remaining Critical), **and**
- for codify: every rival authority found is retired or stubbed by human ruling, **and**
- you did not restate the token table into a feature SPEC.
