---
description: Stand up PROJECT_CONTEXT and seed BACKLOG (product truth onboarding) — codify existing apps or propose greenfield framings under human rule.
---

Run the **product stand-up** process for this project. Follow
`.grok/standup/PROJECT_STANDUP_METHOD.md` as the authority for steps, modes, skeptic checklist, and
kill signals. Report with operator cards per `.grok/OPERATOR_REPORTS.md`.

You are the **controller**, not the product author of record. Do not invent durable domain law in
this session's long context — run preflight, spawn workers only as the method allows, surface Decision
cards, drive synthesizer and skeptic.

## Preconditions

1. Run model-free preflight first:
   `node .grok/tools/gates.mjs project_standup_ready`
   (or `node .grok/tools/project_standup_ready.mjs`). Exit 0 is expected even when context is a stub.
   Exit 1 means the seam is missing — install Spire first.
2. Read `.spire/clusters/tech/project.json`. Fix broken backend/frontend dirs before inventing architecture.
3. Ensure scaffold files exist under `.spire/clusters/tech/context/` (`PROJECT_CONTEXT.md`, `BACKLOG.md`).
   If missing, stop and restore from install scaffolds — do not invent a new schema.
4. Optional `$ARGUMENTS`:
   - `context` — truth only
   - `backlog` — pool only (refuse if context is pure scaffold)
   - `both` — default
   - `refresh` — force re-baseline mode when context already has substance
   - `propose` / `codify` — override detected context_mode

## Detect mode

Per `PROJECT_STANDUP_METHOD.md`: **codify** / **propose** / **refresh** (hybrid allowed). State the
detected mode and scope in a FYI or WORKING card before heavy work.

## Execute

### If mode = propose

**Default:** spawn **one** worker that writes a session note with **exactly 2 or 3 complete rival
product framings labeled A / B / C** (who, problem, non-goals, architecture sketch, data posture).
They must be true alternatives, not three skins of one SaaS.

**Then stop and surface one Decision card** (A / B / C). **Do not write PROJECT_CONTEXT, do not
claim live E2E features, do not invent domain math as fact until the human answers.**

### If mode = codify or refresh

Evidence pass (read-only heavy) → contradiction **Decision cards** (serial) → after rulings, synthesize.

### After the human has ruled (or codify cards are settled)

1. Record rulings in a short project-owned session note if useful.
2. **Synthesize** — spawn one **fresh** `spire-tech-council-synthesizer` to write
   `.spire/clusters/tech/context/PROJECT_CONTEXT.md` with `**Context status:** SET|THIN|PARTIAL`.
   Preserve shard HTML comments. Keep always-load sections minimal.
3. **Skeptic** — spawn one **fresh** `spire-tech-council-skeptic` (do not match synthesizer model).
   Required for propose; for codify when any contradiction cards existed (recommended always).
   Cap Critical→rewrite at 2.
4. **BACKLOG** (if scope includes backlog) — harvest and structure; do not run GATE I or create feature folders.
5. **INDEX** — light pointer touch-up under budget.
6. **Close** — Status card: mode, scope, cards, skeptic verdict, paths, **next action**:
   - optional ``foundation/FOUNDATION_BOOTSTRAP_METHOD.md` (optional git/CI/monorepo; Nx opt-in)` if preflight `foundation_invite=true` or greenfield (opt-in only; Nx never forced)
   - ``design/DESIGN_SYSTEM_METHOD.md` (living project design canon)` if UI and design still UNSET
   - GATE I when BACKLOG has material

## Do not

- Write Decision Ledger free-form rows as stand-up output (recurrence engine owns ledger).
- Run foundation/Nx/CI scaffolding inside this command unless the human explicitly asked to chain
  ``foundation/FOUNDATION_BOOTSTRAP_METHOD.md` (optional git/CI/monorepo; Nx opt-in)` after close.
- Create a mega onboarding skill or treat chat as product authority.
