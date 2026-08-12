# DESIGN_SYSTEM_METHOD — living project design canon onboarding

> Provider-neutral process for filling and maturing
> `.spire/clusters/tech/context/DESIGN_SYSTEM.md`. The Claude slash adapter is
> ``design/DESIGN_SYSTEM_METHOD.md` (living project design canon)` (`commands/design-system.md`); hosts without slash commands follow this file
> from the conductor or `$spire-tech` skill. This is **not** a per-feature council and **not** a
> new kit skill — it reuses Decision cards, a fresh synthesizer write, and a de-correlated skeptic.

## What this makes impossible

- Leaving the scaffolded design file as a permanent dead letter with no fill path.
- Codifying an incoherent app by silently averaging contradictions.
- Proposing a single bland default as “the” system without human rule.
- Writing `Status: SET` without a skeptic pass on synthesis.
- Kit-authored brand taste (no universal palette, type, or component library here).
- Leaving a second design authority alive beside a `SET` canon (see **Single authority** below).

## Artifact

| Item | Path / rule |
|------|-------------|
| Canon file | `.spire/clusters/tech/context/DESIGN_SYSTEM.md` (scaffold; never clobbered on reinstall) |
| Status values | `UNSET` **or** `SET — <direction name>, decided <YYYY-MM-DD>` (optional `maturity: thin \| growing \| stable`) |
| Decisions log (session) | Optional project-owned working note beside the canon (not scaffolded by the kit) |
| Template shape | Headings in the scaffold — synthesizer fills sections; does not invent new top-level schema |

## Entry modes (detect; do not ask unless detection is ambiguous)

0. **Model-free preflight (required):** `node …/tools/gates.mjs design_system_ready`  
   Exit 1 ⇒ project still template/empty — **stop** (do not invent brand).  
   Exit 0 prints `mode=codify|propose|no-ui`.
1. Read `.spire/clusters/tech/project.json`.
2. If `frontend` is null → **no-UI project.** Leave `UNSET` (or skip). Report FYI; do not invent a brand.
3. Else resolve `frontend.dir`. Scan for real UI evidence: components, stylesheets, theme/token files, design tokens, substantial JSX/TSX/Vue/Svelte/etc. under that tree.
4. **Real UI evidence → codify.** **Empty / stub only → propose** (only after preflight green).
5. Optional inputs: wireframes or brand docs the operator names; project-local design skill as *evidence* only.

**Hybrid:** real UI exists but some axes are undeclared → codify what is real; Decision-card unresolved axes.

**Never propose on unfilled scaffold** — inventing direction without product identity is kit brand taste.

## Process (controller is not the designer of record)

You are the **controller**. You do not invent brand taste in the conductor context. You detect mode, spawn workers, surface Decision cards, and drive synthesizer + skeptic.

```text
detect mode (codify | propose | no-UI)
  → gather evidence / produce 2–3 complete directions OR contradiction cards
  → human rules Decision cards ONE at a time (OPERATOR_REPORTS §3.3)
  → record rulings
  → fresh synthesizer writes DESIGN_SYSTEM.md (Status: SET, thin OK)
  → skeptic pass (different model floor from synthesizer — use spire-tech-council-skeptic)
  → Critical findings → rewrite once (cap 2) → surface remainder to human
  → Status card: SET name, mode, cards ruled, skeptic verdict
```

### Step A — Mode work

**Codify (existing UI)**

- Read real components, theme files, and any local brand notes.
- Invoke `spire-tech-design-review` for system-consistency and gaps (review method only — it does not write the canon).
- Document what is **already there**. Every self-disagreement becomes a **Decision card** (A/B options + recommendation). Do not average contradictions into a fake consensus.
- Prefer evidence quotes (file paths, token names, component names) over aesthetic adjectives.
- **Inventory rival authorities before synthesis** — project-owned design skills, style guides, or brand
  docs that state tokens/type/palette as rules. List each with its path in the mode card. They are
  evidence now and a **retire-or-stub** decision at close (**Single authority** below).

**Propose (greenfield / stub)**

Goal: the human **chooses among rival complete systems**, not rubber-stamps one agent consensus.

**Preferred shape (default): one propose worker, one artifact.**

1. Read `PROJECT_CONTEXT.md` and any wireframes/briefs.
2. Write a single session note (e.g. under the project context dir) with **exactly 2 or 3** complete
   directions labeled **A / B / C**. Each direction must include: name, deliberate rejections,
   type pairing, palette (semantic + values), spacing/radius, one signature motion moment or “none”,
   and where tokens would live in code.
3. Directions must be **true alternatives** — different type pairings **and** different palettes at
   minimum. Near-duplicates are a process failure; regenerate, do not average them.
4. Controller presents **one** Decision card: pick A, B, or C (or reject all → re-propose once).

**Optional parallel shape (only if used carefully):** three workers, **one direction slot each**.

- Worker A / B / C each receives a **distinct axis seed** from the controller (e.g. dense-ops vs quiet
  docs vs high-chroma alert) plus the same product context. They must **not** see each other's drafts.
- Controller **compares** the three outputs; if any two share the same type pairing + palette family,
  discard the weaker and re-roll that slot before asking the human.
- Still one Decision card (A/B/C) — never “all three agreed so we proceed.”

**Forbidden in propose mode (hard):**

- Three workers (or rounds) **refining the same direction** or “committing” to one look before the human picks.
- Controller or synthesizer **folding** three proposals into one hybrid before a Decision card.
- Writing `Status: SET` before the human has answered the A/B/C card.
- Treating this like feature council R1 (three **roles** debating one system). Propose is **rival
  systems**, not multi-role consensus on one system.

### Step B — Human rules

- One Decision card per message (`OPERATOR_REPORTS.md` §3.3).
- Propose: card options are the direction letters (**A / B / C**), each with a one-line consequence.
- Answerable by a single letter.
- No silent defaults when the human has not ruled.
- **Stop until the letter lands** — no Step C until then.

### Step C — Synthesize

- Spawn a **fresh** agent (prefer `spire-tech-council-synthesizer` or an equally blank session — **not**
  the propose worker(s)).
- Inputs: **only the human-chosen direction** (+ product context paths). Do not re-open the losers as
  equal sources; optional “Banned: rejected alternatives’ defaults” is fine if the ruling implies it.
- Output: overwrite `.spire/clusters/tech/context/DESIGN_SYSTEM.md` with full sections and  
  `Status: SET — <name>, decided <YYYY-MM-DD>` and `maturity: thin` unless the ruling is richer.
- **Do not restate** a second token table into any feature `SPEC.md`.

### Step D — Skeptic (anti-slop / fidelity)

- Spawn **fresh** `spire-tech-council-skeptic` (model floor differs from synthesizer by construction — never override to match synthesizer).
- Checklist (all apply):

  1. **Ruling fidelity** — written canon matches human rulings; no re-averaging.
  2. **Generic AI-default clusters** — treat as *defaults that need justification*, not universal bans: cream+serif+terracotta hospitality; acid-green on black “terminal”; empty white broadsheet; Inter-everywhere SaaS purple. If the canon matches a cluster without project evidence or human rule, **Critical**.
  3. **Project Banned** — once non-empty, synthesis must not reintroduce banned patterns.
  4. **Codify-only** — no silent merge of contradictions; each was a card.
  5. **Thin honesty** — incomplete binding beats generic complete filler; flag invented completeness.
  6. **Single authority** — no surviving project artifact claims to outrank or restate the canon
     (§ below). An unresolved rival is **Critical**; the human rules retire vs stub.

- Critical → synthesizer rewrite (cap 2). Remaining Critical → human.

### Step E — Close

Status card: mode, direction name, card count, skeptic pass/fail, path to `DESIGN_SYSTEM.md`, and the
disposition of every rival authority found in Step A.  
**Next:** feature work uses Design authority = this path; amendments via § below.

## Single authority (after `SET`)

`SET` means one binding home. A project-owned design skill, style guide, or brand doc that restates
tokens, type, palette, or component rules becomes a **second authority the moment the canon moves** —
observed in the field as a skill asserting it wins on conflict *after* the canon was `SET`.

At close of any codify or re-baseline, each rival is **retire-or-stub** and the human rules which:

| Disposition | Shape |
|-------------|-------|
| **Retire** | Fold anything still true into `DESIGN_SYSTEM.md`, then remove the artifact. |
| **Stub** | Keep the file only as a pointer to the canon path (+ code token locations). No token tables, no palette, no "where they conflict, this wins". |

Rules:

- The canon is the seam; **never** demote it to one input among several.
- **Never delete a project-owned artifact on your own** — it is the human's file. Surface a Decision
  card, and hold the rival as-is until they rule.
- Product-specific craft that is *not* system canon (domain copy rules, a bespoke workflow) may stay —
  it is only a rival when it states system rules.

## Maturation (after SET) — Phase 4 wiring

`Status: SET` is **binding and living**, not frozen. Evolution path:

| Trigger | Who | Action |
|---------|-----|--------|
| Wireframe / screen **accepted** | Conductor / design-system session | Append **Wireframe / source log** + **Amendments** (what tokens/components it adds). If it **contradicts** SET direction → Decision card, not silent overwrite. |
| Feature R2 `product` conflict needing new pattern | UX raises; human rules; R4/conductor | Append Amendments; update Tokens/Components/Banned as ruled. SPEC §4 only **applies** the change — does not become a second token table. |
| Frontend finds missing shared pattern at build | Frontend | GATE Z / product bounce — do not invent system tokens only in code. |
| Explicit re-baseline | Human | Re-run this process; prior direction remains in Amendments history. |

UX adheres and proposes amendments; Frontend builds to named code locations; neither invents a second system. `contract_lint` M9 only checks SET presence for UI features — amendment quality is human + skeptic on re-baseline, not a second mechanical gate.

## Re-entry

Allowed when `Status: UNSET`, file missing, or human requests re-baseline. Do not re-run casually on every feature — that is amendment territory.

## Do not

- Author a parallel skill package that restates this process as a template dump.
- Put brand tokens in always-load `PROJECT_CONTEXT.md`.
- Claim GATE Q visual proof of token match (out of scope).
- Use marketplace design-system skills as the durable seam authority.
- Close a codify with a project design skill still claiming to win on conflict with the canon.
- Batch multiple product questions in one Decision card message.
- In **propose**: spawn workers that **converge on one direction** (the observed failure mode).
- In **propose**: synthesize or SET before the human picks A/B/C.

## Kill signals (process quality)

- Skeptic never rejects or forces a rewrite across three real runs → redesign checklist / model split before any UNSET gate.
- Propose mode discarded twice as generic → tighten propose brief; do not lower the bar by rubber-stamping.
- Single-authority disposition finds nothing to rule across three real codify runs → drop the step; a
  ritual that never catches a rival is inventory, not a gate.
