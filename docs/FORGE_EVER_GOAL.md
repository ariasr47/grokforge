# Forge ever-evolving — use Forge to build Forge

**Opened:** 2026-09-08  
**Supersedes the launch block in** `docs/FORGE_PREFERRED_GOAL.md` (that file stays as the 31 Aug–8 Sep slice log).  
**Roadmap:** `docs/PRODUCT_ROADMAP.md` (living). Read §0 and §9 every cycle.  
**Pause:** only the operator. A green table is not STOP.

We are not a TUI skin, not a VS Code clone, not a second Grok Build marketplace, not a classifier auto-mode.

---

## 0. Launch (`/goal`)

```
/goal Forge ever-evolving (docs/FORGE_EVER_GOAL.md). Use Forge to build Forge. Whole app. grok-acp only — never grok.exe / grok agent stdio. Operator is the only STOP — do not ask to continue, do not treat a green table, a finished named job, or a quiet chrome pass as STOP. Each cycle: (1) read docs/PRODUCT_ROADMAP.md §0 and §9, (2) invent the next job that a daily Claude Code / Codex / Grok TUI user would do AND that changes this repo for real (apps/ or packages/, not docs/dogfood probe files unless the hunt is chrome-only), (3) drive it live on Forge Dev (prefer Desktop CDP :9222 else DEV web :5174, banner host :8788), (4) the job MUST hit at least one Gate if it writes or shells — click Allow / Allow for this session / Deny / Accept plan / Keep planning / Trust this folder / Edit command / ask-tier as the job requires, (5) observe, (6) elect ONE thing to challenge — a FAIL, a missing capability that is in-scope, a refinement, or a polish with a named before/after — rank: blocked function and honesty, then Gate/interaction, then complex-work gaps, then clip/shout, then polish/add, (7) smallest change; chrome/behavior that can silently regress needs a test that would have failed before; close the defect class not only the symptom, (8) prove (disk / Gate click log / png+json+txt / measured delta), (9) log §10; if the slice found a durable product gap, add one row to PRODUCT_ROADMAP.md §9, (10) immediately invent a harder job. Hunt for new things: decision cards, Keep planning, Trust this folder, ask-tier questions, queued Gates, keyboard ⏎/S/esc, multi-file features, follow-up memory, red-green, git via shell, Plan then do, Deny one path, composer/Home/Changes density, Chat glance after Code chrome. Never ask “next?”. One host :8788. Occupied: attach or kill that pid, never both. No KEEP series. No inventing MCP/skills/subagent/browser engines. Identity is Grok. Do not mutate docs/dogfood/ACP-A3.md. Harder means more real files, more Gate kinds, follow-up, Review, git, Plan — not a longer token prompt.
```

---

## 1. Why this exists

The preferred-platform loop proved the engine flip and a daily-job *floor*. It also taught two wrong lessons:

1. **Green twice = done.**
2. **Probe files count as building.** `KEEP.md` / `ACP-A3.md` / three-file fixtures are not “complex development.”

The product you want is the app you open first, all day, instead of Claude Code, Codex, Cursor, the Grok TUI, Claude.ai, or ChatGPT. That is not a finite table. It is a loop that **uses Forge to change Forge**, notices what is worse *or missing*, and makes a **measured** change — fix, enhance, add, refine, polish.

Exceed those tools. Do not copy their layout, their marketplace, or their classifier auto-mode.

---

## 2. Goal kind

`code-change` with **live dogfood** of the running app. Whole-app. Chat and Code both in play.

**Forge-builds-Forge is the default job.** A cycle that only overwrites a file under `docs/dogfood/` is a miss unless the elected defect is chrome-only and the probe is new (never `ACP-A3.md`, never KEEP).

---

## 3. What “better” means

A slice is done if **one axis** moved in a way a stranger could check.

| Axis | Better looks like | Prove with |
|------|-------------------|------------|
| **Function** | A daily job completes (send, Gate, Plan accept then edit, test, git via shell, follow-up, export, stop/retry/copy) | Disk / tool output / JSON |
| **Honesty** | Failures, identity, “not run”, Denied vs Answered, Plan members are real mutations | Shot + JSON; no Mini-Grok; no dump markers |
| **Interaction** | Every Gate kind the job needs actually asks and settles (Allow, session, Deny, Accept, Keep planning, Trust folder, Edit command, ask-tier, Recover) | Click log + composer + disk |
| **Complexity** | The job touched ≥2 real product files under `apps/` or `packages/`, or a follow-up on the same session changed the same feature | Paths on Changes + git-ish status via shell (do not commit unless asked) |
| **Hierarchy** | You / Thought / Plan / Changes / tools / Answered / Your turn / composer / Gate don’t cover each other | Layout flags + screenshot |
| **Voice** | Sentence-case; **Your turn**; **Waiting for model…**; Thought ≠ answer; Gate copy matches the data | Body text |
| **Density** | One coding turn scannable at 1440×900 | Screenshot at that size |
| **Add / refine** | A named in-scope capability exists that did not (or a named before/after on an existing one) | Test that would have failed before + recapture |
| **Motion / perf** | No max-update-depth; no black-crash | Console; `maxDepth: false` |
| **Desktop = web** | Same observables on Forge Dev | Banner `host :8788`; `:8810` down |
| **Roadmap** | Durable gaps get a §9 hunt row; they do not die in chat | Diff of `PRODUCT_ROADMAP.md` |

Unnamed “make it nicer” is not a slice. Taste with a named before/after is.

**Out:** MCP marketplace, vendor skills catalog as a Forge engine, computer use, Custom GPTs, voice, pixel-parity, classifier auto-mode, re-enabling `grok agent stdio`.

---

## 4. How to invent the next job (challenge hunt)

Do not wait for a Quality pass. Do not ask the operator. Pick the first that applies:

1. **Live FAIL** on the job you just ran (function / honesty / Gate).
2. **Roadmap §9** hunt that is still open and worse than polish.
3. **Forge-builds-Forge:** the smallest real improvement in `apps/` or `packages/` that would exercise a Gate kind we have not clicked this session (Keep planning, Trust folder, Edit command, ask-tier, queued Gates, ⏎/S/esc).
4. **Harder coding day:** more files, follow-up on the same session, red-green tests, git via shell, Plan then do, Deny one path keep the others.
5. **Chat glance** after Code chrome (shared surfaces).
6. **Polish** with a named before/after only if 1–5 are quiet.

**Challenge generators** (rotate; do not run the same one twice in a row):

- Plan-armed: propose 3 steps on a *real* shell file; click **Keep planning** once with a constraint; then **Accept**; then execute under Review.
- Write Gate: change two product files; **Deny** one path; **Allow for this session** the other; Retry the denied path and confirm it still cards.
- Shell Gate: run a real package test; try **Edit command** if the command is wrong; then Allow.
- Ask: if grok-acp or the UI can raise “Grok has a question”, answer it. If it never fires, that absence is a hunt — do not fake a catalog.
- Complex: implement the next in-scope polish *in Forge* (one function, tests, typecheck) rather than in this TUI session.
- Keyboard: settle a Gate with ⏎ / S / esc, not only the mouse.

---

## 5. The loop

Repeat until the operator says pause.

1. **Read** — `PRODUCT_ROADMAP.md` §0 and §9. One glance.
2. **Invent** — a job from §4. Name the Gate kinds it should hit.
3. **Drive** — Forge Dev. Prefer Desktop CDP `:9222`, else DEV web `:5174`. Banner **host :8788**.
4. **Observe** — shot, JSON, host log, Gate, Changes, composer, overlap flags, console.
5. **Evaluate** — rank as in the `/goal` block.
6. **Elect** — exactly one thing. FAIL, add, refine, or polish. Not five.
7. **Change** — smallest. Test that would have failed before if silence could hide a regression. Prefer grok-acp/server truth over shell lies. Close the class.
8. **Prove** — recapture the same job. Quote a measured delta. If you touched shared chrome, glance Chat once.
9. **Log** — one broke/fix/re-check (or add/refine) line in §10. If durable product gap: one new row in `PRODUCT_ROADMAP.md` §9.
10. **Harder** — go to 2. Never ask “next?”

**Host rules:** one `:8788`. Occupied: attach **or** kill that pid, never both. Never a second host. Scratch under temp. Never rewrite `ACP-A3.md`. Follow-up execute must click Gates, not wait for Your turn.

---

## 6. Constraints that stay

- grok-acp only. No vendor CLI for Code or Chat.
- Elect from the first FAIL / first hunt only.
- Chrome slices: a test that would have failed before.
- No KEEP overwrite series. No second host.
- Do not invent MCP / skills / subagent / browser engines.
- Do not “fix Code” by switching to Chat, or the reverse.
- Identity is first-class **Grok**.
- Do not commit / push / release unless asked.
- Do not rewrite `VISION.md` wholesale. Roadmap §1 is allowed to state the Code-engine ruling.

---

## 7. Non-goals

- Finishing old A*/C*/D*/E*/F* tables as a substitute for this loop.
- Q-clean STOP.
- Publishing 0.6.7 without the operator saying `release`.
- Building classifier auto-mode because Claude made it the default.

---

## 8. Acceptance / stop

There is no “current set green twice.”

The loop is succeeding when:

- each logged slice has a measured delta, **and**
- at least some slices this week changed `apps/` or `packages/`, **and**
- Gate kinds other than Allow once have been clicked on purpose, **and**
- the next cycle is already inventing a harder job.

**Stop** only when the operator says pause.

---

## 9. Seed hunts (starting — drop if live is worse)

Copied from `PRODUCT_ROADMAP.md` §9 so this file can run if the roadmap is unread. Prefer the roadmap if they disagree.

1. Changes ± for a `write_file` of an existing file (live: +301 −300 vs git +1).
2. Trust this folder from the write Gate.
3. Edit command from the shell Gate.
4. Ask-tier “Grok has a question” live.
5. Two live Gates queued.
6. Settle a Gate with ⏎ / S / esc.
7. A real multi-file change under `apps/` or `packages/` driven in Forge.

---

## 10. Slice log

- **Open / 2026-09-08:** Operator asked to keep looping with an ever-evolving goal, a living roadmap, and Forge-builds-Forge (decision cards + complex development were the named gaps). This file is the operating `/goal`. Roadmap living refresh is `docs/PRODUCT_ROADMAP.md` (same day). First hunt after open: invent a real Code job that hits a Gate kind other than Allow once — unless live dogfood shows worse. Do not STOP.
- **Home covers empty Code / 2026-09-08:** Drove DEV web `http://127.0.0.1:5174/` banner **host :8788**, Code, grokforge pinned, Grok · subscription. Clicked **New session**. Main stayed **Good morning** Home. Composer **PLAN** armed (`Explore and propose without applying edits.` / Plan armed). Fill of a Gate.test.tsx plan prompt did not stick; Send stayed disabled (`Type a message to send`). Footer: **Checking Grok agent…** then **No project instructions** (AGENTS.md missing). Identity Grok. Elect: empty Code New session must leave Home and load AGENTS.md — this is worse than Keep planning. Hunt row added to `PRODUCT_ROADMAP.md` §9. A green table is not STOP.
- **Home covers empty Code / fix:** Bound Code + workspace + empty session skips Home (`TranscriptBody`). Chat empty and Code-with-no-folder still land on Home. RED: `TranscriptBody.test.tsx` “a bound Code workspace with an empty session is the Code canvas, not Home” (heading present). GREEN: 7/7 TranscriptBody; 10/10 App.notFound. Recapture reload `:5174`: no Good morning; composer **Project instructions · AGENTS.md**; identity **Grok**; banner **host :8788**. A green table is not STOP. Next hunt: Keep planning.
- **Keep planning click / 2026-09-08:** Same Code session (grokforge 13), PLAN armed, Review. First Gate: **Waiting for you**, **Plan ready · 0 files would change** (plan-only, no mutations yet), **Accept plan** focused, **Keep planning** enabled. Clicked **Keep planning** as the chosen path. Post-click: dock gone; Plan region **Keeping plan open / Proposed edits were not applied.**; idle **Your turn**; composer re-enabled (Send disabled on empty draft); PLAN still armed. Identity **Grok**; banner **host :8788**. Not yet a full loop (constraint → second Plan Gate → Accept → write/shell). A green table is not STOP.
- **Keep planning full loop / 2026-09-08:** Same session after Keep planning. Constraint sent (PLAN still armed). Second Gate: first plan **Superseded by a newer plan**; **Plan ready · 1 file would change** `apps/shell/src/dock/Gate.test.tsx`; Send **Settle the card below**; **Accept plan** focused. Clicked **Accept plan**. Copy: **Plan accepted. Your next Code send continues under Policy: Review.** PLAN disarmed. Execute send → write Gate **Grok wants to write a file** `Gate.test.tsx` (Trust this folder visible, not clicked). **Allow**. Then pending **diff** (ActionDock empty; transcript **Settle this in the card below.**; Changes **+301 −300** whole-file `write_file`). **Accept** in Changes. Disk `git diff --stat`: **1 file, 1 insertion**. Idle **Your turn**; Changes chip **Accepted**; identity **Grok**; banner **host :8788**. `Gate.test.tsx` **18/18**. Elect: Changes ± is a whole-file rewrite for a 1-line edit. A green table is not STOP.

---

## 11. Related

`docs/PRODUCT_ROADMAP.md` · `docs/FORGE_PREFERRED_GOAL.md` (prior log) · `docs/ACP_CODE_GOAL.md` · `docs/CHAT_DAILY_GOAL.md` · `docs/DOGFOOD_EXPLAINER.html`
