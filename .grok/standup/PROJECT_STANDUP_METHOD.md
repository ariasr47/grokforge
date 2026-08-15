# PROJECT_STANDUP_METHOD — product truth + idea-pool onboarding

> Provider-neutral process for the first real fill (and later re-baseline) of
> `.spire/clusters/tech/context/PROJECT_CONTEXT.md` and seed of
> `.spire/clusters/tech/context/BACKLOG.md`. Claude adapter: ``standup/PROJECT_STANDUP_METHOD.md` (product context + backlog onboarding)`.
> Hosts without slash commands follow this file from the conductor after cluster entry.
>
> This is **not** a feature gateway, **not** GATE I, **not** design-system, and **not** a new kit skill.
> Pattern matches design-canon: converge → human rules → fresh synthesize → adversarial check.

## What this makes impossible

- Leaving PROJECT_CONTEXT / BACKLOG as permanent scaffold fossils with no fill path.
- Inventing binding domain law without a Decision card and human rule.
- Averaging contradictory architectures into a fake consensus (codify).
- Proposing one bland default product framing as fact (propose).
- Auto-promoting BACKLOG items into feature folders (GATE I owns promotion).
- Writing Decision Ledger rows as free-form stand-up output (ledger is recurrence, not dump).
- Folding foundation/Nx/CI bootstrap into this ritual by default (see foundation method).

## Artifacts

| Item | Path / rule |
|------|-------------|
| Product ground truth | `context/PROJECT_CONTEXT.md` (scaffold; never clobbered on reinstall) |
| Idea pool | `context/BACKLOG.md` |
| Open questions | `context/OPEN_THREADS.md` — park unresolved strategic cards only |
| Memory map | `context/INDEX.md` + optional `context/topics/*` — pointer budget; not a second rulebook |
| Context status (recommended) | Near top of PROJECT_CONTEXT: `**Context status:** THIN \| SET \| PARTIAL` + date |
| Preflight | `gates.mjs project_standup_ready` |

## Entry modes (detect; operator may override)

0. **Model-free preflight (required):** `node …/tools/gates.mjs project_standup_ready`  
   Prints suggested `context_mode`, stub flags, and whether foundation bootstrap is invited.  
   Exit 1 only when the seam is unusable (missing state root / unreadable project.json with no repair path).  
   Exit 0 is normal even when context is still a stub — that is *why* stand-up exists.
1. Read `.spire/clusters/tech/project.json` (dirs and cmds). Fix broken paths before inventing architecture.
2. **context_mode:**
   - **refresh** — PROJECT_CONTEXT already has real §1–§2 substance; operator asked re-baseline or drift suspected.
   - **codify** — backend and/or frontend trees have real source evidence.
   - **propose** — greenfield / empty stubs / operator allows invention of product framing.
3. **scope** (default `both`):
   - **both** — context then backlog (recommended).
   - **context** — truth only.
   - **backlog** — pool only; refuse if context is pure scaffold (block: fill context first).

**Hybrid:** real BE + stub FE (or reverse) → codify the real side; Decision-card the undeclared side.

## Process (controller is not the product author of record)

You are the **controller**. Do not invent durable product identity in long conductor context. Detect mode, spawn workers, surface Decision cards, drive synthesizer + skeptic.

```text
preflight (project_standup_ready)
  → mode card (context_mode + scope) — human confirms or overrides
  → evidence / propose work
  → Decision cards ONE at a time (OPERATOR_REPORTS)
  → fresh synthesizer writes PROJECT_CONTEXT (+ topics if needed)
  → skeptic pass (required for propose; required for codify when contradictions existed or always if operator wants full rigor)
  → BACKLOG harvest + structure (if scope includes backlog)
  → light INDEX touch-up (budget)
  → Status card + next action
```

### Step A — Mode work

**Codify**

- Read entrypoints under `backend.dir` / `frontend.dir`, README, package manifests, tests, env *names* (never secret values).
- Prefer evidence quotes (paths, module names) over marketing adjectives.
- Every self-disagreement → **Decision card** (A/B + recommendation). Do not average.
- §3 / §5 always-load: only rules proven by code or explicitly ruled. Empty is honest.

**Propose**

- Default: one worker produces **exactly 2 or 3 complete rival product framings A/B/C**  
  (who, problem, non-goals, architecture sketch, data posture, what “works E2E” means for v0 = usually nothing yet).
- Framings must be true alternatives, not three skins of the same SaaS.
- **Stop for human pick** before synthesizing PROJECT_CONTEXT.
- Forbidden: invent domain math as fact; claim live E2E features that do not exist.

**Refresh**

- Diff current PROJECT_CONTEXT against code.
- Card only **material** changes.
- Do not silently reopen promoted invariants (OPEN_THREADS §9 / ledger promotions) — those need GATE Z or explicit human reopen.

### Step B — Synthesize PROJECT_CONTEXT

Spawn one **fresh** synthesizer (prefer `spire-tech-council-synthesizer` or equivalent write path). Preserve `<!-- shard: … -->` annotations and § numbering.

Write status line when done:

- `**Context status:** SET — <one-line product name>, decided <YYYY-MM-DD>` when §1–§2 real and always-load honest  
- `THIN` if deliberately minimal greenfield  
- `PARTIAL` if mid-cards abandoned with honest gaps  

Always-load (§3, §5) stays **minimal**. Push lore to non-always sections or `topics/` + INDEX.

### Step C — Skeptic / integrity

Spawn a **fresh** skeptic with a different model floor from the synthesizer when the host supports it (`spire-tech-council-skeptic`).

Checklist:

1. Placeholders / angle-brackets / `{PROJECT}` leftovers  
2. Invented binding domain rules without cards  
3. Silent averages of contradictions  
4. Always-load bloat (essays in §3/§5)  
5. Fake §6 “works E2E” list  
6. Secrets or machine-local absolute paths  

Critical → one rewrite (cap 2) → surface remainder to human.

### Step D — BACKLOG seed (if in scope)

- Harvest: OPEN_THREADS, deferred seams, friction the operator names, gaps from codify  
- Structure template sections A–D  
- Each ready/queued item: one-line **why it matters** (decision-impact or tooling value)  
- Blocked items name blockers  
- Do **not** run GATE I or create `contracts/{FEATURE}/`  
- Do **not** invent a fake “Last GATE I” history  

### Step E — INDEX touch-up

- Ensure INDEX points at canon files and any new topics  
- Stay within budget (≤200 lines or ≤25KB body)  
- Prefer `memory_query` later over re-reading archives  

### Step F — Close

Status card: mode, scope, cards ruled, skeptic verdict, paths written, **next action**:

1. Optional **foundation bootstrap** (`FOUNDATION_BOOTSTRAP_METHOD.md` / ``foundation/FOUNDATION_BOOTSTRAP_METHOD.md` (optional git/CI/monorepo; Nx opt-in)`) if greenfield or preflight invited it — **opt-in**, never silent  
2. **design-system** if UI and DESIGN_SYSTEM still UNSET  
3. **GATE I** when BACKLOG has material  

## Continuity

If context pressure hits mid-cards: GATE R with RESUME naming stand-up mode, pending cards, files dirty. Fresh cluster entry resumes stand-up, not delivery discovery.

## Kill signals

- Hand-fill is faster and higher quality on two real consumers → stop investing in automation.  
- Skeptic never rejects across first three real runs → redesign checklist.  
- Stand-up invents binding rules that GATE Q/Z reverse → tighten invent ban.

## Relationship to other onboarding

| Process | Job |
|---------|-----|
| **This method** | Product identity + idea pool |
| **Foundation bootstrap** | Optional git/CI/monorepo (Nx only if human chooses) |
| **Design-system** | Visual canon after product purpose exists |
| **Delivery ascent** | Features via GATE I → ship |
