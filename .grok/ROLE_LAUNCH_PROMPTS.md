# Role Launch Prompts (standing reference)

Reusable, generalized prompts to **open** each role-scoped session in the delivery pipeline. The
council lane (§1) runs three voices through blind positions, cross-critique, conductor reconciliation
and a fresh synthesis to produce `SPEC.md` + `INTERFACE_CONTRACT.md` — no per-role compressor hand-off;
the round artifacts under `council/` ARE the trail. The two build lanes (§2/§3) each read the constant
ground truth + those two artifacts, do only their lane's work, and ship code directly — no outbound
contract, so no compressor either. QA (§4) reads the same two artifacts and writes `QA_REPORT.md`, an
independent `conformance-receipt-qa.json`, and a failure bounce when either verification track fails.

Pipeline: **Discovery (GATE I, conductor-inline) → Design Council (GATE C) →
{Backend ‖ Frontend Executioners} → QA/Verify (GATE Q) → Ship.** Discovery has no launch prompt
below — it is the conductor's own inline opening move (ORCHESTRATOR §3 GATE I); the prompts here
cover the Council plus the two executioners + QA.

> To **automate** the hand-offs (audit → compress → write the next contract → route), open a session
> as the Orchestrator (`.grok/ORCHESTRATOR.md`) and announce the transition; it drives these
> prompts + the compressors for you instead of manual copy-paste.

> **Context retrieval (system-5):** instead of re-reading all of `PROJECT_CONTEXT.md`, a session can
> load the minimal pack — `node .grok/tools/gates.mjs context_for {FEATURE} --write`
> (the always-load invariant floor §3+§5 + the sections the BRIEF's `Context tags:` select). This writes
> `.spire/clusters/tech/contracts/{FEATURE}/_context-pack.md` and prints one line; hand the spawn that PATH, never the
> pack's contents — relaying it by value routes the whole pack through the caller's own context. Opt-in;
> the whole file stays valid + single-source. Decouples per-session token cost from canon size.

> **Per-role agents (system-4):** Grok emits all nine canonical role definitions under `.grok/agents/`.
> Frontmatter `tools` lists mechanically restrict tool availability when the host honors agent definitions.
> The installed `.grok/hooks/spire-path-guard.json` fence blocks structured write-tool targets outside the
> workspace root; it does not parse shell command strings. Role-path scope remains instruction-held.

Placeholders to fill before pasting:
- `{FEATURE}` = kebab folder name under `.spire/clusters/tech/contracts/` (e.g. `user-auth-flow`).
- `{GOAL}` = one short paragraph: what this feature must accomplish for the user/system.

> Convention (per COMPRESSOR_PROMPTS.md): reference files, don't paste; assume **no chat history** —
> the reader has only `PROJECT_CONTEXT.md` + the named contract(s). One feature = one folder.

---

## 0. The summary contract — what every spawned gate hands back
Every spawn in this file returns its report in ONE fixed shape. This is what makes a gate flippable
between inline and spawned without anything downstream noticing — and what keeps the conductor's
context lean: the conductor carries the summary, never the transcript.

- **Produced:** the artifact paths written (a spec, a plan, a report — never pasted contents).
- **Decided:** choices made that a reviewer should know, one line each.
- **Carry forward:** the few facts the conductor must hand the NEXT gate that the artifacts alone
  don't say.
- **Unresolved:** open questions, contradictions, bounces — or "none".

Hard cap: ~10 lines. A summary that grows with the work defeats its purpose; detail belongs in the
artifacts, which the next reader opens by PATH. Artifacts over prose — a conclusion without its
artifact is unverifiable, and unverifiable summaries are how judgement quietly degrades across
handoffs.

---

## Running a role — the LITE path (system-9-lite · ADOPTED 2026-06-23)
**Run each role as a FRESH spawn of its own role subagent, never a long-lived terminal.** Freshness
*is* the reliability: each session stays the pure function `output = role(ground_truth, inbound_contract)`
— no accumulated context to drift, self-contradict, or smuggle a stale detail into a new decision (and
no growing per-turn token cost). You (the human) still conduct — announce the transition, run the
mechanical gates + tools, route — but the ROLE work moves into a disposable subagent.

Per gateway, spawn the matching subagent with the launch prompt from the cited section + the sharded
context pack, let it write its one contract, then **discard it** (no reuse across roles or features):

| Gateway              | Spawn subagent        | Launch prompt | Writes                          |
|----------------------|-----------------------|---------------|---------------------------------|
| Council R1 (x3 parallel) | `spire-tech-architect` / `spire-tech-pm` / `spire-tech-ux` | §1 + `council/R1-position.md` | `council/R1-{role}.md` |
| Council R2 (x3 parallel) | the same three, fresh | §1 + `council/R2-critique.md` | `council/R2-{role}.md` |
| Council R4           | `spire-tech-council-synthesizer` (fresh) | `council/R4-synthesis.md` | `SPEC.md` + `INTERFACE_CONTRACT.md` |
| Council S2           | `spire-tech-council-skeptic` (fresh; its file declares a different model) | `council/S2-skeptic.md` | `council/S2-findings.md` |
| Backend (fan-out)    | `spire-tech-backend`   | §2            | server code (binds interface)   |
| Frontend (fan-out)   | `spire-tech-frontend`  | §3            | UI code (binds interface)       |
| QA / Verify (GATE Q) | `spire-tech-qa`          | §4            | QA_REPORT.md                    |

- **Discovery has no subagent:** GATE I (Discovery) runs **inline in the conductor**, not as a spawn —
  its output is a judgement, and it loads its planning surface at the gate (rationale:
  ORCHESTRATOR §3 GATE I). **R3 (Reconcile) is likewise the conductor's own work**, not a spawn: it
  collects the R2 conflicts, re-spawns only the two voices involved in a `technical` conflict for one
  exchange, and routes every `product` conflict to the human one at a time.
- **Lean context, not the whole canon:** give each spawn the pack —
  `node .grok/tools/gates.mjs context_for {FEATURE} --write` (always-load invariant floor
  + the BRIEF's `Context tags:`); it falls back to the floor if no tags. This writes
  `.spire/clusters/tech/contracts/{FEATURE}/_context-pack.md` and prints one line; hand the spawn that PATH, never the
  pack's contents — relaying it by value routes the whole pack through the conductor's own context, which
  is the longest-lived context in the system.
- **You still run the gates between spawns:** `contract_lint.mjs` at every gateway; at GATE Q
  `interface_conformance.mjs` + the `spire-tech-qa` spawn. Lanes are tool-fenced (the subagents)
  and structured write tools are workspace-fenced by `path_guard.js`; shell command strings are not parsed.
- **Translate hand-backs into cards:** when a spawn returns, report it to the operator per
  `OPERATOR_REPORTS.md` — a Re-orientation card for background completions, a Problem card for
  failures; the subagent's raw report is footer material, never pasted above the fold.
- **Discard, don't continue:** never reuse a subagent across gateways or features. The handoff is the
  written contract on disk, not a living session.
- **vs full system-9:** the *conductor is still you* (manual transitions + approvals). system-9 automates
  that into a Conductor agent spawning these same subagents + parallel feature lanes — parked behind the
  go-live gate. Lite = the freshness + lane-fencing win, no new infra, human review intact.

---

## 1. The Design Council (GATE C — replaces the Architect/PM/UX sessions)

Run it with ``ORCHESTRATOR.md` §3 GATE C plus `council/*` {FEATURE}`. The command is the authority; this section is the summary a human
needs to understand what is happening and where to intervene.

**Three voices, four rounds, one human touchpoint.**

| Round | Who | Sees | Produces |
|---|---|---|---|
| R1 Position | architect / pm / ux, in parallel | **nothing from the others** | `council/R1-{role}.md` |
| R2 Critique | the same three, fresh instances | all three positions | `council/R2-{role}.md` (structured conflicts) |
| R3 Reconcile | **the conductor** | everything | `council/decisions.md` |
| R4 Synthesis | `spire-tech-council-synthesizer`, none of the three | everything | `SPEC.md` + `INTERFACE_CONTRACT.md` |

Then **S2**: `spire-tech-council-skeptic` attacks the spec, de-correlated by construction — its file declares a
different model from the synthesizer's; Critical findings loop back to R4 (cap 2 passes).

**R1 blindness is load-bearing.** It is what structurally replaces the independence the three separate
tool-fenced sessions used to provide. If the positions are written with visibility into each other, the
council collapses into a single voice and the design is worse than the pipeline it replaced.

**The one hard rule of R2:** a conflict must quote the exact sentence it contradicts. Vague
disagreement is rejected and sent back.

**Where you come in:** R3 surfaces `product` conflicts — priority, scope, user value — to you one at a
time as A/B decision cards. `technical` conflicts are settled between the two voices involved. After
S2, you approve the spec; that is the last cheap moment to change direction.

**Feature too small for a council?** Use the fast paths instead — GATE M (server-side only, no UI) or
GATE V (visual only, no server change) — which skip the council entirely. The council is for features
with a real FE-to-BE seam.

## 2. Backend Executioner
```text
Read these files for full context, then implement the backend, acting as a backend engineer:
- .spire/clusters/tech/contracts/{FEATURE}/_context-pack.md                 (your slice of the standing ground truth — the always-load invariant floor + this feature's tagged sections. Regenerate it now, unconditionally, even if it already exists: `node .grok/tools/gates.mjs context_for {FEATURE} --write`, then read the file it names — it can be stale, since GATE M/V skip the council round that writes it and `PROJECT_CONTEXT.md` can change after GATE C)
- .spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md            (the single source of integration truth)
- .spire/clusters/tech/contracts/{FEATURE}/SPEC.md                          (§2 architecture + §7 testing strategy — your server work)
- .spire/clusters/tech/contracts/{FEATURE}/RESUME.md                        (ONLY if present with `**Resume status:** ACTIVE` — a prior lane hit its session budget and checkpointed; continue from exactly where it stopped instead of redoing done work)

Follow the lane boundaries, interface-binding rule, debugging/TDD method, and required conformance-
receipt exit discipline in your agent definition. Apply them to the feature-specific inputs above;
report the receipt path and verdict, and bounce an incorrect interface instead of diverging from it.
```

## 3. Frontend Executioner
```text
Read these files for full context, then implement the frontend, acting as a frontend engineer:
- .spire/clusters/tech/contracts/{FEATURE}/_context-pack.md                 (your slice of the standing ground truth — the always-load invariant floor + this feature's tagged sections. Regenerate it now, unconditionally, even if it already exists: `node .grok/tools/gates.mjs context_for {FEATURE} --write`, then read the file it names — it can be stale, since GATE M/V skip the council round that writes it and `PROJECT_CONTEXT.md` can change after GATE C)
- .spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md            (the single source of integration truth)
- .spire/clusters/tech/contracts/{FEATURE}/SPEC.md                          (§4 — component states, copy, design direction; your UI work)
- .spire/clusters/tech/contracts/{FEATURE}/RESUME.md                        (ONLY if present with `**Resume status:** ACTIVE` — a prior lane hit its session budget and checkpointed; continue from exactly where it stopped instead of redoing done work)

Follow the lane boundaries, interface-binding rule, required unit/component/flow-integration test
floor, degraded-state behavior, and visual-verification exit discipline in your agent definition.
Apply them to the feature-specific inputs above; report the states exercised and test result, and
bounce a missing interface field instead of inventing it.
```

## 4. QA / Verify (GATE Q — runs after BOTH executioners, before ship)
The teeth-having verification role (system-2). A **fresh session, NOT one of the builders** — it ends
"builders mark their own homework." It confirms every acceptance criterion point-by-point, **fixes
nothing**, and bounces any gap via GATE Z. It runs on the provider's decide tier against execute-tier
build lanes, so its blind spots are de-correlated from theirs by construction (system-6). Subagent:
`spire-tech-qa` (its agent file's name and format are the host's business, not this document's).
```text
Read these files for full context, then act as a strict QA / Verification engineer (a FRESH session,
deliberately NOT one of the builders — no one marks their own homework):
- .spire/clusters/tech/context/PROJECT_CONTEXT.md                                       (standing ground truth)
- .spire/clusters/tech/contracts/{FEATURE}/SPEC.md                               (§3 ACCEPTANCE CRITERIA — your checklist)
- .spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md                 (integration truth — what BE emits / FE consumes)
- .spire/clusters/tech/context/OPEN_THREADS.md §9 ONLY                                    (the "Resolved decisions — do NOT revisit" section: honor those promoted invariants. Read §9; do NOT read §1-§8 — they are open items and shipped history you do not verify against.)

Apply the verification-only boundary in your agent definition: observe every criterion point by
point, treat builder claims as unverified evidence, and bounce failures rather than fixing them.

Method:
- Run the project the standard way (backend `project.json` → `backend.serve_cmd`; frontend
  `project.json` → `frontend.serve_cmd`) and OBSERVE. The ACs are written to be observable without
  reading code — verify by observation first. Read code to explain an observed failure or to perform the
  mandatory criteria-independent changed-code Critical sweep; code reading never substitutes for runtime
  observation.
- For EACH acceptance criterion, verbatim and in order, assign exactly one verdict:
  PASS (observed to hold — cite evidence) · FAIL (observed not to hold — expected vs actual + repro) ·
  UNVERIFIABLE (couldn't exercise it — say precisely why).
- Verify INTERFACE_CONTRACT integration with the runtime conformance check (system-1): with the backend
  running, run `node .grok/tools/gates.mjs interface_conformance --contract
  .spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md --url <backend-base-url> --report
  .spire/clusters/tech/contracts/{FEATURE}/conformance-receipt-qa.json` — your own independent run, never trust the
  receipt the backend lane already wrote. Compare your `verdict` against the backend's
  `conformance-receipt.json` — yours is authoritative. Backend PASS against your FAIL is the serious
  case (drift, or the backend never ran it); a missing backend receipt is also a bounce. A conformance
  FAIL is a GATE Q FAIL → bounce to Backend.
- Also check the binding invariants (BRIEF "Invariant watch" + the promoted canon). A green AC list
  over a broken invariant is still a FAIL.
- Re-run the frontend test suite + verify AC coverage per its `Verify by` marking (standing rule — tests
  are part of the FE deliverable): run the configured frontend test command (`project.json` →
  `frontend.test_cmd`, plus any shared-lib test command if a shared client lib was touched); a failing
  suite is a GATE Q FAIL → bounce to Frontend. Then verify traceability (NOT a spot-check): every
  SPEC.md §3 AC marked `test` in its `Verify by` column maps to ≥1 named, passing test; every AC marked
  `review` is confirmed by inspection. A `test`-marked AC with no corresponding test is a FAIL even if the
  green suite passes — name the uncovered AC in the bounce.

Write .spire/clusters/tech/contracts/{FEATURE}/conformance-receipt-qa.json (produced by the tool above) and
.spire/clusters/tech/contracts/{FEATURE}/QA_REPORT.md: a table (AC verbatim · verdict · evidence), a summary
(n PASS / n FAIL / n UNVERIFIABLE), then apply the overall GATE Q verdict rule from `spire-tech-qa`; do not
restate or weaken it here. On any FAIL, ALSO append an "Amendments bounced to {owner}" section (failing
AC · observed vs expected · owning lane Backend|Frontend).

Stay in lane: QA_REPORT.md, conformance-receipt-qa.json, and the bounce on failure are your ONLY writes — no code, no contract
edits, no fixes. Run no compressor; the Orchestrator routes on your verdict (PASS → GATE S; FAIL →
GATE Z, then GATE Q re-runs on the fix). Then stop.
```

## 5. Planner (GATE PLAN — after spec approval, before the lanes)
The largest generative task that used to run inline in the conductor (~24K of context for work that
needs zero conductor state — `SPEC.md` is required to stand alone). Spawn ONE fresh
`spire-tech-planner` subagent; hand it only the three paths below. It writes `PLAN.md` and reports
per the summary contract (§0).
```text
Act as the delivery planner for {FEATURE}. Read these files, then produce the implementation plan:
- .spire/clusters/tech/contracts/{FEATURE}/SPEC.md                          (approved design — plan this, change nothing)
- .spire/clusters/tech/contracts/{FEATURE}/INTERFACE_CONTRACT.md            (integration truth — copy its Conformance spec into the plan's Global Constraints verbatim)
- .spire/clusters/tech/contracts/{FEATURE}/_context-pack.md                 (your slice of ground truth; if absent: `node .grok/tools/gates.mjs context_for {FEATURE} --write`)

Follow .grok/plan/PLAN_METHOD.md and write PLAN.md to .spire/clusters/tech/contracts/{FEATURE}/PLAN.md with
backend, frontend and verification tracks. If the spec cannot be planned as written, stop and
report the contradiction — never plan around it.
```
**Loop rule (binding — from the dispatcher-minus-one spec §1.2.3):** this fresh spawn is for the
FIRST plan of a feature. If the plan bounces and must be revised **within the same conductor
session**, CONTINUE the same planner agent with the revision feedback — its context already holds
the spec and its own reasoning, which is exactly what a revision needs. Never re-spawn cold per
revision (2–4× the cost; subagents run on the 5-minute cache TTL, so every fresh spawn is cold by
construction). A fresh spawn is correct again once the original agent is gone (a later session).

---
### Notes
- **Backend and Frontend run in parallel** — both bind to the same `INTERFACE_CONTRACT.md`, so neither
  blocks the other. That decoupling is the whole point of the council's R4 Synthesis output.
- **The Council's R4 Synthesis writes SPEC.md + INTERFACE_CONTRACT.md directly — no compressor step.**
  A fresh synthesis agent (none of the three voices) reads every R1/R2 position and critique plus the
  conductor's R3 decisions, then authors both files as its one write. S2's Critical findings loop back
  into at most 2 more synthesis passes before you approve.
- Executioners have **no outbound contract** (they ship code, not a handoff) and therefore run **no
  compressor** — the pipeline ends at integration.
- If a role finds its inbound contract wrong or incomplete, the fix is a **contract amendment** (bounce
  back to the owning role), not a silent in-lane workaround.
- `PROJECT_CONTEXT.md` stays the single canon everything derives from. QA reads it in full — D1: its
  independence rests on seeing the whole file, since the context pack is itself derived from the
  BRIEF's `Context tags:` and a pack-fed QA would be blind in exactly the spot it exists to catch. The
  two build lanes read the sharded context pack instead (system-5). The per-feature contracts are the
  variable. Archive a feature's folder when it ships.
