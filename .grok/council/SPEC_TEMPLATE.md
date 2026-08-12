# SPEC_TEMPLATE — what the council synthesizes into

> One of the two design artifacts the R4 synthesizer writes — it replaces the five per-feature
> contracts it retires (architecture, product, UX blueprint, and the two execution contracts).
> `INTERFACE_CONTRACT.md` is written alongside it and is **not** replaced — see §6. Written at R4 by a
> fresh synthesizer, attacked at S2 by a skeptic, approved by the human, then fed to the planner
> (`plan/PLAN_METHOD.md`).
>
> **§6 is mandatory.** `SPEC.md` never carries the conformance block itself (that's the retained-file
> decision below) — but its §6 must point at `INTERFACE_CONTRACT.md`, and that file must carry a
> parseable `## Conformance spec` block (or be explicitly `NO_BACKEND_CHANGE`). An interface file without
> one isn't integration truth — it's a description. The synthesis prompt must refuse to emit a `SPEC.md`
> whose §6 doesn't point at an interface file meeting that bar. See "Authoring `INTERFACE_CONTRACT.md`"
> at the end of this file for what that separate file must contain.
>
> It must stand alone against `PROJECT_CONTEXT.md` + the `BRIEF.md`. Never "as discussed" — a fresh
> implementer sees only this file.

---

```markdown
# {FEATURE} — spec

**Source brief:** .spire/clusters/tech/contracts/{FEATURE}/BRIEF.md
**Council:** R1 positions · R2 critiques · decisions.md   (under council/)
**Status:** draft | skeptic-reviewed | APPROVED {date}

## 1. Goal + scope

<One paragraph: what this is and who it's for.>

**In scope:** <bullets>
**Out of scope:** <bullets — the things someone would reasonably assume are included, named explicitly>
**Future (deliberately deferred):** <bullets>

## 2. Architecture

<Data structures, component boundaries, data flow, where state lives. Name the modules/files that
will be touched or created. No endpoint signatures here — those live in §6.>

**Failure modes + isolation:** <what happens when a dependency is slow/absent/wrong; what degrades vs
what breaks; what must never be partially applied.>

**Not buildable / rejected approaches:** <what the architect ruled out at R1 and why — this stops a
later session from cheerfully re-proposing it.>

## 3. Acceptance criteria (with user stories)

Each AC must be **observable without reading code** — a person can check it from outside.

| # | Story | Acceptance criterion | Verify by |
|---|---|---|---|
| 1 | As a … I want … so that … | <observable outcome> | test \| review |

`test` = automated (invariants, negative space, silently-regressing behavior).
`review` = verified by inspection (copy, presence, ordering) — per the risk-based rule.

## 4. UI + interaction

**Flows:** <the paths through the feature>

**Component states** — every one specified, not just named:

| Component | default | loading | empty | error | offline/stale |
|---|---|---|---|---|---|

**Copy:** <exact strings, including error and empty-state wording. Copy is design material, not filler.>

**Design authority:** <when `.spire/clusters/tech/context/DESIGN_SYSTEM.md` is `Status: SET`, that path. UI-touching features must have SET (`contract_lint` M9). Backend-only features: put `NO_UI_CHANGE` in this SPEC body. Never invent a second project system here.>

**Design direction:** <how this feature **applies** the project canon (which components, states, copy). **Not** a restatement of the token table in `DESIGN_SYSTEM.md`. New shared patterns amend the design canon after human rule — they do not live only in this section.>

## 5. Error handling

<User-visible behavior for each failure class named in §2. What the user sees, what gets logged, what
retries. Not "handle errors gracefully" — the actual behavior.>

## 6. Interface — pointer  ← THE LOAD-BEARING LINK

> **Decision 2026-07-22:** the interface is **its own file**, not a section of this spec. The council's
> synthesis writes BOTH `SPEC.md` and `INTERFACE_CONTRACT.md`. Both build lanes bind to the small file;
> `interface_conformance.mjs --contract INTERFACE_CONTRACT.md` reads it unchanged. A change to it after
> approval is a GATE Z amendment — a visible file-level event, not an edit buried in a long spec.

**Interface:** `.spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md`
**Summary for readers of this spec:** <2–3 lines: which endpoints this feature touches, what's new vs
existing, whether it's `NO_BACKEND_CHANGE`. The authoritative field list lives in that file, never here —
`SPEC.md` references the interface, it never restates it.>

## 7. Testing strategy

<What gets automated vs reviewed, and why — risk-based, not one-test-per-AC. Name the invariants that
must never silently regress. Note the FE test tiers (unit/component/integration) and what the
integration tests mock (the network boundary only).>

## 8. Guardrails this feature must not break

<From BRIEF.md's Invariant watch — the standing rules this touches. A later session reads this before
changing anything here.>

## 9. Open questions

<Anything the council could not settle and the human deferred. Empty is a valid answer — but an
unlisted open question that everyone "sort of knew about" is how a spec lies.>

<!-- spire:council-folding:v1
{"schema_version":1,"resolutions":[{"source":"R2-architect.md","index":0,"conflict_id":"<copy exact 64-hex id from conflicts.json>","disposition":"folded","section":"§2"},{"source":"R2-pm.md","index":0,"conflict_id":"<copy exact 64-hex id from conflicts.json>","disposition":"open","section":"§9"}]}
-->

<!-- spire:synthesis-propositions:v1
{"schema_version":1,"propositions":[{"id":"<catalog-id>","polarity":"affirmed","section":"§2"}]}
-->
```

---

## Notes for the synthesizer

- **Fold, don't concatenate.** The spec is one coherent document, not three position papers stapled
  together. If §2 and §4 disagree, you have failed — resolve it or list it in §9.
- **Every R2 conflict must be visibly resolved** — folded into the text, or recorded in §9 as still
  open. Silently dropping a conflict is the #1 thing the S2 skeptic hunts for.
- **Folding receipt.** Include exactly one hidden receipt row per R2 conflict. Copy each 64-hex
  `conflict_id` from gate-generated `council/conflicts.json`. `folded` points to sections 1–8; `open`
  points to section 9. Inside the cited section, add exactly
  `<!-- spire:council-resolution:v1 <conflict_id> <folded|open> -->`. The gate binds the id to current
  R2 bytes and the marker to the cited section; the skeptic and human still judge whether the prose
  is the correct resolution.
- **Closed proposition contract.** When `council/proposition-catalog.json` is present, include exactly
  one `spire:synthesis-propositions:v1` receipt. Each row is `{ "id", "polarity", "section" }` where
  `id` is a settled catalog id, `polarity` is only `affirmed` or `denied`, and `section` is copied
  **exactly** from that catalog entry's `section` field (public taxonomy — not a free choice). Place
  prose and `<!-- spire:proposition:v1 <id> <polarity> -->` in that same §N. Architecture/view-model
  ids stay in §2 even when UI also reflects them. Assert only settled claims; leave distractors out.
  The receipt is answer-free structure — it does not restate proposal prose and is not a synonym list.
- **Carry the decisions.** Anything the human ruled at R3 goes into the spec as settled fact, with the
  reasoning — not as an open question.
- **No deliberation.** Ship the decisions, strip the debate. The rounds are on disk under `council/` if
  anyone needs the trail.

---

## Authoring `INTERFACE_CONTRACT.md` (companion guidance — NOT a section of `SPEC.md`)

> **This is guidance for the separate file `.spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md`, written
> alongside `SPEC.md` as R4's other output.** Prefer skill `spire-tech-interface-conformance` for the
> authoring craft; this section remains the structural authority. It is not part of the `SPEC.md`
> template above and must never be copied into `SPEC.md` — §6 of that template is only a short pointer
> to this file. `SPEC.md` references the interface; it never restates it. Reproducing this material
> inside `SPEC.md` recreates the second conformance block the retained-file decision exists to prevent.

**Endpoints:** <method · path · purpose · auth · error semantics · streaming/SSE semantics if any>

**Conformance spec** — machine-checkable. `interface_conformance.mjs` runs this against the live
backend at G1. Dot-paths, `name[]` for array fan-out, `type|null` / `type?` for optional unions:

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
        "items[].count": "number",
        "updatedAt": "string|null"
      }
    }
  ]
}
```

> An endpoint behind a session adds `"auth": true`. The runner then sends the session to that
> endpoint and to no other — an anonymous endpoint's 200 must keep proving anonymous behaviour.
> Supply the session with `--auth-cookie NAME=VALUE`, or `--auth-signup` to bootstrap a throwaway
> one (needs `conformance.auth` in `project.json`). A spec that marks `auth` and is run without a
> session exits 2 and writes no receipt — it is a configuration error, never a FAIL.

> **Frontend-only feature?** Point at the existing endpoint's spec instead of restating it, and mark
> `INTERFACE_CONTRACT.md` `NO_BACKEND_CHANGE`. Do not omit this file's conformance block for any feature
> that does touch the backend — a missing conformance block is the failure mode this whole design exists
> to prevent.
