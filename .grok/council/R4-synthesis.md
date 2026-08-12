# R4 — Synthesis (council round 4)

You are a **fresh** agent. You did not write any of the positions and hold none of their bias. Your job
is to fold the whole council into one coherent design.

## Inputs
- `.spire/clusters/tech/contracts/{FEATURE}/BRIEF.md`
- `.spire/clusters/tech/contracts/{FEATURE}/council/R1-architect.md`, `R1-pm.md`, `R1-ux.md`
- `.spire/clusters/tech/contracts/{FEATURE}/council/R2-architect.md`, `R2-pm.md`, `R2-ux.md`
- `.spire/clusters/tech/contracts/{FEATURE}/council/conflicts.json` — gate-generated conflict ids bound to the exact R2 bytes
- `.spire/clusters/tech/contracts/{FEATURE}/council/proposition-catalog.json` — when present, the closed proposition vocabulary for machine-checkable folding claims
- `.spire/clusters/tech/contracts/{FEATURE}/council/decisions.md` — the human's rulings and the agents' resolutions
- Project design canon: `.spire/clusters/tech/context/DESIGN_SYSTEM.md` — UI-touching features require
  `Status: SET` (`contract_lint` M9). SPEC §4 Design authority points at that path; Design direction
  applies the canon only (no token-table restatement). Backend-only: `NO_UI_CHANGE` in the SPEC body.
  Ruled product changes that extend the system belong in the design canon **Amendments** log, not as a
  second system invented in §4.
- The context pack

## Your output — TWO files

**1. `.spire/clusters/tech/contracts/{FEATURE}/SPEC.md`** — follow `.grok/council/SPEC_TEMPLATE.md` exactly,
including its section numbering. It must contain a `## 3. Acceptance criteria` section; a structural
gate checks for that heading. **The gate checks only that the heading exists — the rows are yours.**
Invoke `spire-tech-acceptance-criteria` for what goes in them: `spire-tech-qa` later checks this table
point-by-point, and a criterion that cannot be observed without reading code cannot be verified
there at all.

At the end of `SPEC.md`, after section 9, include exactly one hidden council folding receipt in the
format shown by `SPEC_TEMPLATE.md`. It contains one row for every R2 conflict, identified by source
filename, zero-based index, and the exact `conflict_id` copied from `conflicts.json`. Use `folded`
with the section where the decision landed, or `open` with section 9. In that same section, place the
matching `spire:council-resolution:v1` marker. The gate recomputes every id from current R2 bytes and
requires the marker inside the cited section, so a stale critique or decorative end-of-file receipt
cannot pass. These hidden records carry no debate or proposal prose.

When `council/proposition-catalog.json` is present, also include exactly one answer-free
`spire:synthesis-propositions:v1` receipt after section 9. Assert only catalog `id` values that the
decisions and folded critiques settle. For each asserted id copy the catalog's declared `section`
exactly (for example architecture/view-model claims use §2, acceptance claims §3, UI visibility
claims §4 — never re-home an architecture id into §4 because the UI also mentions it). Set
`polarity` to only `affirmed` or `denied`. Inside that **same** catalog section place the matching
`<!-- spire:proposition:v1 <id> <polarity> -->` marker. Do not invent ids, do not assert distractors,
and do not encode claims as free-text synonym lists — the catalog is the only closed vocabulary.

**2. `.spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md`** — the FE↔BE truth, containing endpoints and
a machine-checkable conformance block:

```json
{
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/example/{id}",
      "path_params": { "id": "abc123" },
      "query": {},
      "required": {
        "id": "string",
        "items[].name": "string",
        "updatedAt": "string|null"
      }
    }
  ]
}
```

placed under a heading spelled exactly `## Conformance spec`. `interface_conformance.mjs` extracts it by
that heading; a different spelling breaks the gate.

## MANDATORY — refuse to finish without an interface
If the feature genuinely touches no backend, still write `INTERFACE_CONTRACT.md`, mark it
`NO_BACKEND_CHANGE` in the body, and point at the existing endpoint's spec. **Never omit the file and
never omit the conformance block.** A spec whose interface is only described in prose is the exact
failure this system exists to prevent — if you cannot produce a checkable block, stop and report that
as a blocker instead of shipping prose.

## Folding rules
- **Fold, do not concatenate.** One coherent document, not three position papers stapled together. If
  two sections disagree, you have failed — resolve it or list it in `## 9. Open questions`.
- **Every R2 conflict must be visibly resolved** — folded into the text, or recorded in §9 as still
  open. Silently dropping a conflict is the first thing the skeptic hunts for.
- Represent every R2 conflict exactly once in the hidden folding receipt. Copy its `conflict_id`
  exactly from `conflicts.json`, and place the matching resolution marker in the cited section. A
  folded row points to sections 1–8; an open row points to section 9.
- **Carry the human's decisions** from `decisions.md` in as settled fact, with the reasoning.
- **Strip deliberation, ship decisions.** The rounds stay on disk under `council/` for anyone who wants
  the trail.
