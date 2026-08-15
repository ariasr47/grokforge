# FOUNDATION_BOOTSTRAP_METHOD — optional repo foundation

> Provider-neutral process for **optional** repository foundation work: git hygiene, CI, and monorepo
> tooling. Claude adapter: ``foundation/FOUNDATION_BOOTSTRAP_METHOD.md` (optional git/CI/monorepo; Nx opt-in)`. Not product-truth stand-up; not design-system; not a mega skill.
>
> **Nx is opt-in via Decision card — never default-forced.** Spire kit itself is non-Nx (measured kill
> 2026-08-09); consumers may still choose Nx for *their* product monorepos.

## What this makes impossible

- Silently rewriting an existing working app into Nx during codify.
- Treating Nx (or any monorepo tool) as mandatory Spire law.
- One “onboarding skill” that mixes git + CI + Nx + PROJECT_CONTEXT + BACKLOG.
- Claiming selection receipts or CI green equal full delivery ascent proof.
- Putting monorepo-tool-specific ports/paths into framework role prose as hard requirements.

## When to run

| Situation | Default |
|-----------|---------|
| Greenfield after product stand-up (or thin context SET/THIN) | **Invite** foundation |
| Existing app with working package scripts + CI | **Skip** unless operator asks |
| Codify stand-up of non-Nx monorepo | **Document only** unless human chooses migration |
| Operator says “set up Nx/CI/git” | Run this process |

Prefer **after** PROJECT_CONTEXT §1–§2 exist (so scripts and layout match a known product). May run standalone if operator only wants foundation.

## Preflight

`node …/tools/gates.mjs foundation_ready` — model-free hints (git present? workflows? lockfile? nx config?).  
Exit 0 always when seam exists; findings are invitations, not hard blocks (unless `.spire` missing).

## Decision cards (required before scaffolding)

Surface **one card at a time**:

1. **Monorepo shape**  
   - A) Single package (no monorepo tool)  
   - B) npm/pnpm/yarn workspaces  
   - C) **Nx**  
   - D) Already structured — **document only** (codify foundation into PROJECT_CONTEXT §2/§7)  
2. **CI host** (if not D): GitHub Actions / other / skip CI  
3. **Package manager** pin if ambiguous  
4. **Node (or runtime) pin** for CI — consumer choice; do not blindly copy Spire kit pins unless they match  

Only after rulings may workers write files.

## Modules (run only what was ruled)

### M1 — Git hygiene (if no `.git` or operator asks)

- `git init` only when absent; never force-rewrite remotes.  
- Ensure LF-friendly ignores; do not fight tool-specific ignore files without a card.  
- Do not create secrets files.

### M2 — CI (if ruled)

- Add workflow under the host’s conventional path (e.g. GitHub Actions).  
- Jobs should run the **same test/serve commands** the seam will use (`project.json` test_cmd / package scripts).  
- If Nx chosen: prefer affected-aware jobs **only** when the graph is correct; otherwise full test is more honest.  
- Never claim Spire install selection proves tests ran.

### M3 — Nx (only if monorepo shape = C)

- Scaffold or document apps/libs layout matching Decision card.  
- Wire `project.json` `serve_cmd` / `test_cmd` to real Nx targets (Windows-honest: `.cmd` / `npx` forms as needed).  
- Update PROJECT_CONTEXT §2/§7 with layout and commands.  
- Stop conditions: graph name collisions, multiple projects same name, broken affected — **do not ship a lying graph**; fall back to document-only or non-Nx after human card.

### M4 — Workspaces (if B)

- Root workspace config; package scripts; seam cmds.

### M5 — Document only (if D)

- Write foundation notes into PROJECT_CONTEXT §2/§7 and INDEX pointers.  
- No tree rewrite.

## Process shape

```text
preflight (foundation_ready)
  → Decision cards (shape → CI → pins)
  → apply modules (workers) under human-ruled scope
  → update PROJECT_CONTEXT conventions + INDEX if needed
  → Status card: what changed, what was skipped, how to run tests
```

Controller does not invent monorepo taste. Prefer fresh workers for large file writes.

## Skeptic / integrity (lightweight)

After apply:

- Seam cmds still run as written?  
- CI YAML references scripts that exist?  
- No secrets committed?  
- If Nx: `show projects` (or equivalent) does not error on name collisions  

## Stop conditions

- Operator declines foundation → exit cleanly.  
- Existing complex monorepo + migrate-to-Nx request → require explicit migration card; prefer D document-only if risk high.  
- Any module would destroy uncommitted work → stop and report.

## Reference routing

| Topic | File |
|-------|------|
| Git hygiene | [references/git-hygiene.md](references/git-hygiene.md) |
| GitHub Actions shape | [references/ci-github-actions.md](references/ci-github-actions.md) |
| Nx opt-in | [references/nx-opt-in.md](references/nx-opt-in.md) |

## Skills posture

Do **not** author a kitchen-sink onboarding skill package. If trials show process-only failure on a **single** craft (e.g. Nx graph layout), add a **bounded** named skill later — not one skill that owns git + CI + monorepo + product truth.

## Relationship

| Process | Job |
|---------|-----|
| Project stand-up | Product identity + BACKLOG |
| **This method** | Optional repo foundation (Nx opt-in) |
| Design-system | Visual canon |
| Delivery | Features |
