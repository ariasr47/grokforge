---
description: Run the design council on one feature — R1 positions, R2 critique, R3 reconcile, R4 synthesis, then an adversarial review.
---
Run **GATE C — the design council** for the feature named in `$ARGUMENTS` (the kebab folder under
`.spire/clusters/tech/contracts/`). Read `.spire/clusters/tech/project.json` first, then that feature's `BRIEF.md`. If no BRIEF
exists, stop and say so — the council designs a chosen feature; choosing is GATE I's job.

You are the **controller**, not a voice. You never write a position, a critique, or the spec yourself.
Report to me throughout as operator cards per `.grok/OPERATOR_REPORTS.md`.

Create `.spire/clusters/tech/contracts/{FEATURE}/council/` for the round artifacts.

**R1 — positions (parallel, blind).** Spawn `spire-tech-architect`, `spire-tech-pm` and `spire-tech-ux`
**in a single message** so they run concurrently. Give each: the BRIEF, the context pack
(`node .grok/tools/gates.mjs context_for {FEATURE} --write` — this writes
`.spire/clusters/tech/contracts/{FEATURE}/_context-pack.md` and prints one line; hand each spawn that PATH, never
the pack's contents. Relaying it by value routes the whole pack through the conductor's own context,
which is the longest-lived context in the system), and the prompt in
`.grok/council/R1-position.md` with its role substituted. **Do not show any voice another's output.**

**R2 — cross-critique (parallel, sighted).** When all three positions exist, spawn three FRESH
instances of the same agents in one message, each given all three R1 files plus
`.grok/council/R2-critique.md`. Each returns one `json` block. Then merge and validate them with
`node .grok/tools/gates.mjs council_conflicts {FEATURE}` — it writes
`council/conflicts.json` (the union of every voice's `conflicts`, each entry keeping its `quote`,
`source`, `why`, `proposal`, `kind` and `raised_by`) and **rejects any conflict whose `quote` does not appear in the
named source position**. Do not merge the blocks by hand; the quote rule does not self-enforce, and
paraphrases have slipped a controller's eye before. A non-zero exit names the offending conflicts —
send each affected voice back once to restate it properly, then re-run the tool.

**R3 — reconcile (you, the controller).** Your input is `council/conflicts.json` (written by the
gate-check above) — read THAT, never the R2 files wholesale: the JSON already carries each
conflict's `quote`, `source`, `why`, `proposal`, `kind` and `raised_by`, and the R2 prose around them belongs to
the voices, not to your persistent context.
- `self_revision: true` → a voice quoting its **own** R1 to withdraw a claim it can no longer defend.
  Not a conflict: there is no opposing voice to re-spawn and nothing for me to rule on. Fold the
  retraction in and record it in `decisions.md`. Never send one of these back.
- `kind: "technical"` → re-spawn **only the two voices involved**, handing each the opposing
  conflict entry from `conflicts.json` plus the PATHS of the two R2 files (the spawn reads them —
  you don't), for exactly ONE resolution exchange. If they converge, fold the resolution in. If
  they do not, promote it to a product call.
- `kind: "product"` → **mine to decide.** Surface them to me **one at a time** as Decision cards
  (`OPERATOR_REPORTS.md` §3.3): the question in one sentence, then lettered options with a one-line
  consequence each and your recommendation marked. Never batch two questions into one message.
- Record every outcome — agent-resolved and human-ruled — in
  `.spire/clusters/tech/contracts/{FEATURE}/council/decisions.md` with the conflict that prompted it.
- **Loop cap: 2.** If R2 materially changed positions, run one more critique round, then decide and move
  on. An uncapped debate burns tokens without converging.

**R4 — synthesis.** Spawn ONE fresh `spire-tech-council-synthesizer` — never one of the three voices — with
`.grok/council/R4-synthesis.md`, all R1 + R2 artifacts, and `decisions.md`. It writes `SPEC.md` and
`INTERFACE_CONTRACT.md`.

**S2 — adversarial review.** Spawn one fresh `spire-tech-council-skeptic` with `.grok/council/S2-skeptic.md`.
Its agent file declares a different model from `spire-tech-council-synthesizer`, so the de-correlation this round
depends on holds without you arranging it — never override it at dispatch. Any **Critical** finding
loops back to R4 with the findings attached. Cap the loop at 2 passes, then surface what remains to me.

**Gate-check.** Run `node .grok/tools/gates.mjs contract_lint {FEATURE}`. A
structural ERROR blocks the handoff — fix it before reporting done.

**Report + hand off.** Close with a Status card: what the council decided, how many conflicts were
raised and how they were settled, and the skeptic's verdict. Then ask me to approve the spec. On
approval the next step is the plan (GATE PLAN), not the build.
