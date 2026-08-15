---
description: Optional repo foundation bootstrap — git hygiene, CI, monorepo shape; Nx only if the human chooses it.
---

Run the **foundation bootstrap** process only if the human opted in. Follow
`.grok/foundation/FOUNDATION_BOOTSTRAP_METHOD.md` as the authority. Report with operator cards per
`.grok/OPERATOR_REPORTS.md`.

You are the **controller**. Do not silently rewrite the tree. Surface Decision cards before scaffolding.

## Preconditions

1. Prefer product purpose first: if PROJECT_CONTEXT §1–§2 are pure scaffold, recommend ``standup/PROJECT_STANDUP_METHOD.md` (product context + backlog onboarding)`
   first (unless the human explicitly wants foundation-only).
2. Run model-free preflight:
   `node .grok/tools/gates.mjs foundation_ready`
   (or `node .grok/tools/foundation_ready.mjs`).
3. Optional `$ARGUMENTS`: `document-only` to force monorepo shape D (document existing tooling).

## Required Decision cards (serial)

1. **Monorepo shape:** A single package · B workspaces · C **Nx** · D document existing only  
   **Nx is never the default.** Only choose C after an explicit human letter.
2. **CI:** GitHub Actions / other / skip  
3. **Runtime pin** for CI if adding workflows  

Read method references as needed: `foundation/references/git-hygiene.md`,
`foundation/references/ci-github-actions.md`, `foundation/references/nx-opt-in.md`.

## Execute

After rulings, apply **only** ruled modules (git / CI / Nx / workspaces / document). Update
PROJECT_CONTEXT §2/§7 and INDEX when commands or layout change. Wire seam `serve_cmd` / `test_cmd`
to real commands (Windows-honest).

If Nx is chosen: verify the project graph does not error on duplicate names; if it lies or fails,
stop and Decision-card a fall back (workspaces / single package / document-only).

## Do not

- Force Nx on greenfield without a C ruling.
- Migrate a working non-Nx app to Nx without an explicit migration card.
- Mix product stand-up (context/backlog invent) into this command.
- Claim CI green proves a Spire delivery ascent finished.
- Commit secrets or force-push.
