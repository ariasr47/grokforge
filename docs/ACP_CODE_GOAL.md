# Code on grok-acp — beat Claude Code / Codex, retire vendor CLI for Forge Code

**Surface:** Forge **Code** tab. Engine is **in-house grok-acp** — never `grok.exe agent stdio`.  
**Log:** append one broke/fix/re-check/shot line per slice below.  
**Launch:** paste the `/goal` block in §0.

This is an **operator ruling**. It supersedes `docs/VISION.md` §5 for Code’s engine only. Chat stays grok-acp. We are not a TUI skin and not a second Grok Build marketplace.

**Operating loop (2026-08-31):** `docs/FORGE_PREFERRED_GOAL.md` — whole-app continuous improvement. This file’s Q-clean STOP is **not** the destination. Use §12 as evidence, not as a finish line.

---

## 0. Launch (`/goal`)

```
/goal Code tab on in-house grok-acp (docs/ACP_CODE_GOAL.md). Stay on Code. grok-acp only — do not spawn grok.exe / grok agent stdio for Code (vendor Code is retired in Forge). Named journeys A0–A8 and dogfood D1–D3 must PASS on DEV web once and on Desktop twice in a row (png+json+txt each). After that, run Quality pass Q against the Claude Code / Codex rubric (function + Voidglass UX). If Q finds an in-scope daily-coding or UX blocker, add exactly one named journey (Q1, then Q2 … Q5 max) and recapture; if Q finds only out-of-scope or taste-only gaps, STOP. Pause is first-class. One host :8788. No KEEP series. No second host. No inventing MCP/skills/subagent/browser engines. Chrome slices need a test that would have failed before the fix. Elect from the first FAIL only. Identity is first-class Grok on grok-acp — not Mini-Grok consolation, not a Grok CLI badge.
```

---

## 1. Why this exists

Vendor `grok agent stdio` was the “guest brain” bet: hard jobs use xAI’s CLI; grok-acp is Chat + fallback. That split made Forge a house. It also made **our** agent second-class on the tab that pays the bills.

The more valuable enterprise is the opposite: **Forge Code is grok-acp**. We own the coding loop (tools, Review diffs, plan, shell, confinement). We dogfood it by actually building. We stop when a daily Claude Code / Codex day fits in Voidglass **and** the chrome does not look like a consolation CLI wrapper.

**Exceed, don’t clone:** Review (ask-before-edit), File changes you can inspect, Thought ≠ answer, honest fallback-that-is-no-longer-fallback. If those work, we beat YOLO terminals. If Code still says “Mini-Grok · Grok CLI not found” while grok-acp is the intended engine, we lose on sight.

---

## 2. Goal kind

`code-change` with live **Code** dogfood. Engine **grok-acp**. Host must not start `grok.exe` / `grok.cmd` `agent stdio` for Code sessions.

Record the ruling in `docs/VISION.md` §5 as part of **A0** (one paragraph: Code engine is grok-acp; vendor CLI is out of Forge Code). Do not rewrite the whole vision.

---

## 3. Competitor bar (observable — not vibes)

Rows are a **coding day** (Claude Code, Codex CLI/IDE). **Forge must** is the Code-on-acp observable. **Out** is refused even if they have it.

### 3a Function

| # | Daily job | Forge must | Out |
|---|----------------|------------|-----|
| 1 | Open a repo, obvious Code empty | Code continuum empty; Open folder; composer enabled; **not** Chat-with-Grok | Welcome wizard covering a known project |
| 2 | First send streams and finishes | Streamed Grok text; tools visible if used; **Answered**; **Your turn**; composer enabled | Thought shown as the answer; 120s RPC kill of a live turn |
| 3 | Follow-up remembers the repo turn | Second send uses first-turn fact or file; not a new-session amnesia | Invented memory product |
| 4 | Edit a file under Review | Dock **Allow once** (or Trusted auto); File changes lists the path; disk matches after accept | Silent write; YOLO because `~/.grok/config.toml` |
| 5 | Run tests / typecheck | `run_shell` output on the turn; failure is readable; agent can retry | Fake green |
| 6 | Multi-file change | ≥2 paths in File changes **or** honest single-file with reason; no writes outside workspace | Computer use / extra-workspace |
| 7 | Plan before a bigger change | On-screen plan body (1./2./3. or equivalent) below You and above composer **or** grok-acp says it will just do the small job | Vendor `enter_plan_mode` dependency |
| 8 | @file / mention | You shows `@path` not the dump; answer uses the bytes | Fake @ with no read |
| 9 | Stop / retry / copy | Stop → Stopped by you; Retry resends; Copy on the answer | Fork/rewind product |
| 10 | Fail honestly | Engine-stopped / Run failed copy; conversation saved; Try again when allowed | “Grok Code” badge on a dead vendor spawn |
| 11 | Git-shaped close | Agent can status/diff/commit **via shell** when asked; File changes still the write inspector | Invented Git GUI / GitHub app |
| 12 | Identity is first-class | Composer/run provenance is **not** Mini-Grok-as-missing-CLI; **not** vendor “Grok Code” CLI chip; Code is grok-acp on purpose | ACP jargon in empty/error copy |

### 3b UX / style (Voidglass — beat the TUI, don’t look like VS Code)

| # | Bar | Forge must | Out |
|---|-----|------------|-----|
| 13 | Hierarchy | You / Grok / tools / File changes / composer don’t collide or clip; Your turn not covered | Pixel-parity with Claude Code |
| 14 | Voice | Idle **Your turn**; no shouty uppercase instruction; Thought collapsed or not the answer | Marketing slogans |
| 15 | Density | One coding turn scannable at 1440×900 without hunting | IDE clone, activity bar, LSP editor |
| 16 | Desktop = web | Same observables on Forge Dev; banner **host :8788**; no second host | Skinning the Grok TUI |
| 17 | Motion / chrome | No max-update-depth; no black-crash after send | Animation theater |

Quality pass **Q** walks 1–17 against the last green shots + one live Code session. In-scope miss → one new journey. Out or taste (“make it prettier” with no hidden job) → list and continue only if a daily job is actually blocked.

---

## 4. Named journeys (the efficient set)

Each journey: one Code send-path on **DEV web** (`:5174`) and **Desktop** (Forge Dev). Artifacts: `{SCRATCH}/web-A{n}.{png,json,txt}` / `{SCRATCH}/desktop-run{1,2}-A{n}.*` and `{SCRATCH}/web-D{n}.*` likewise. `PASS` whose JSON contradicts the named observable is **FAIL**. Console `Maximum update depth exceeded` is **FAIL**. JSON must show **no** `grok.exe` / `agent stdio` spawn for the session (`starting agent` source is grok-acp / oauth, not vendor).

| ID | Job | Prompt / action (fixed) | Named observables |
|----|-----|-------------------------|-------------------|
| **A0 Engine** | Code is grok-acp | Open this repo. Click Code. Do not install/require Grok CLI. | Mode Code; composer identity first-class (not Mini-Grok CLI-missing, not vendor Grok Code chip); host log/session has no `command: …grok.exe` + `agent stdio`; empty is Code continuum |
| **A1 Open** | Empty → first send | `Reply with exactly ACP-A1-OK and stop. Do not edit files.` | Stream; **ACP-A1-OK**; Answered; Your turn; composer enabled; Thought not the answer |
| **A2 Follow-up** | Thread + repo | A1 then: `What exact token did I ask for? Token only.` | Second You; answer contains `ACP-A1-OK` |
| **A3 Write** | Review edit | Write `docs/dogfood/ACP-A3.md` containing `ACP-A3-OK` (Allow once if Review). | Dock or Trusted auto; File changes has `ACP-A3.md`; file on disk has the token; You not overlapping File changes |
| **A4 Test** | Shell loop | `Run the grok-acp unit tests that are already in packages/grok-acp (the package test script or node --test). Report pass/fail. Do not invent a runner.` | `run_shell` (or equivalent) visible; output mentions pass or fail honestly |
| **A5 Check** | Typecheck/lint the agent | `Typecheck packages/grok-acp. Quote the command you ran and whether it exited 0.` | Command visible in tools; honest exit |
| **A6 Plan** | Plan then small do | Arm Plan if Code still has a Plan control **or** ask grok-acp to propose 3 steps then do step 1 only: add a one-line comment in `docs/dogfood/ACP-A3.md`. | Plan body 1./2./3. on screen **or** three-step markdown above the edit; File changes still inspectable; no vendor plan RPC required |
| **A7 @file** | Mention | `@docs/dogfood/ACP-A3.md` Quote the token in that file. | You shows `@`/`ACP-A3.md` not `[Attached file contents…]`; answer has `ACP-A3-OK` |
| **A8 Stop** | Controls | Long prompt; Stop if streaming; Copy last Grok; Retry if offered. | Stopped-by-you or completed; Copy ok; Retry resends if offered |

### Dogfood projects (self-improving loop — still named, not KEEP)

After A0–A8 are green on web, run **D1 then D2 then D3**. Each is a real build through Code on grok-acp. Any friction (wrong edit, missing dock, ugly clip, agent stuck, UX lie) is the **first FAIL** — fix that chrome/agent slice with a test, then recapture **that D**, not a new KEEP file.

| ID | Build | Done when |
|----|--------|-----------|
| **D1 Fixture lib** | In `docs/dogfood/acp-code/d1-id/` (create the folder): a tiny JS module `id.js` exporting `ok()` returning `'D1-OK'`, plus `id.test.js` that asserts it. Run the test via shell. | Files on disk; test output pass; File changes shows the files; no vendor spawn |
| **D2 Repair** | Break `ok()` on purpose (return `'D1-BAD'`), send “the test is red, fix it.” Agent must restore `'D1-OK'` and re-run. | Test green again; File changes shows the repair; no extra scope |
| **D3 Polish** | Same fixture: add a one-screen README (what it is, how to run). Hierarchy: heading, short paragraph, command fence. | README on disk; Open or readable markdown in the turn; still grok-acp |

Do **not** add journeys for: MCP marketplace, vendor skills catalog, computer use, Chat tab, Grok CLI re-enable, KEEP-TEN overwrites, `/always-approve`.

### Wave 2 (operator 2026-08-31 — continue past Q STOP)

Wave 1 (A0–A8 + D1–D3 + Q) ran and met the written stop bar. Operator then asked to **keep looping**: more complex Code dogfood, leftover UX (Plan chip, live identity), git-shaped close, hierarchy. Still grok-acp only. Still one `:8788`. Still elect from the first FAIL. Still no MCP/skills/subagent engines. Still chrome slices need a test that would have failed before.

| ID | Job | Prompt / action (fixed) | Named observables |
|----|-----|-------------------------|-------------------|
| **E0 Live identity** | Streaming Code is Grok | Long prompt; capture while streaming or Stop mid-turn. | Run chip **Grok**, not “Confirming which agent ran…”, not Mini-Grok, not Grok Code |
| **E1 Plan chip** | Arm Plan, then write | Arm Plan. `Propose 3 numbered steps then do step 1 only: add a one-line HTML comment in docs/dogfood/ACP-A3.md.` | Plan body on screen (1./2./3.) **and** Accept plan (or Keep planning); after Accept, File changes inspectable **or** honest “edits wait until you Accept plan” |
| **E2 Git** | Status then diff | `Run git status --short and git diff --stat in this repo. Quote the commands and whether they exited 0. Do not commit.` | `run_shell` visible; honest status/diff; no invented Git GUI |
| **E3 Multi-file** | Two-path change | In `docs/dogfood/acp-code/e3/` create `a.js` exporting `n=1` and `b.js` importing it. | File changes ≥2 paths; disk matches; no extra-workspace |
| **E4 Same-file repair** | Red then green | Break `docs/dogfood/acp-code/d1-id/id.js` to `'E4-BAD'`, send “test is red, fix it.” | Repair to `D1-OK`; File changes the repair; `node --test` honest |
| **E5 Hierarchy** | Long tools list | A4-like test run; expand tools. | You / tools / File changes / Your turn don’t cover each other; no max-update-depth |
| **E6 Export** | Live turn export | Send a short Code turn; Export. | Export includes the live You + Grok; no dump marker |

Dogfood D4–D6 (after E0–E6 green on web): slightly larger fixture in `docs/dogfood/acp-code/d4-sum/` — `sum.js` + test, then red-green, then README. Same first-FAIL rule.

### Wave 3 (operator 2026-08-31 — keep looping: harder dogfood + UX attacks)

Claude Code plan mode: Shift+Tab → research-only (no source edits) → **Approve** / **Keep planning** → then execute. Codex is the same job without a VS Code skin. Forge must beat that on grok-acp: Plan chip actually gates writes, Accept plan is first-class, then a follow-up execute does the Review write. Still no MCP/skills/subagent/browser engines. Still one `:8788`. Elect from the first FAIL.

| ID | Job | Prompt / action (fixed) | Named observables |
|----|-----|-------------------------|-------------------|
| **F0 Plan→do** | Accept then execute | After E1 Accept: send `Do step 1 now.` (Plan off). | File changes `ACP-A3.md`; Allow once or Trusted auto; disk has the HTML comment; no vendor spawn |
| **F1 Voice** | Idle/streaming copy | Long Code turn; capture mid-stream + Your turn. | No shouty `WAITING FOR GROK…`; idle **Your turn**; Thought not the answer |
| **F2 Hierarchy** | Composer vs answer | Same long turn as F1; expand tools. | Answered / Your turn not covered by composer; You / tools / File changes don’t collide; no max-update-depth |
| **F3 Deny then retry** | Review refuse | Write a new line in `docs/dogfood/ACP-A3.md`; click **Deny**; Retry if offered. | Deny sticks (disk unchanged); Retry resends or honest Your turn; no silent write |
| **F4 Revert** | Undo an accepted edit | After a small accepted write, click **Revert edit**. | File restored; File changes reflects revert; conversation saved |
| **F5 Pause** | Pause is first-class | Start a long Code turn; Pause if offered, else Cancel. | Paused/Stopped by you; composer enabled after; no second host |
| **F6 Nested test** | Windows path + `node --test` | In `docs/dogfood/acp-code/f6-nested/mod.js` export `n=1` + `mod.test.js`. Run `node --test`. | File changes both; test output honest; no `npm test` walk-up |
| **F7 Busy** | Second send while running | Send a long turn; try a second send before Your turn. | Honest busy / composer disabled; no overlapping max-depth; first turn still owned |

Dogfood D7–D9 (after F0–F7 green on web): a tiny parser in `docs/dogfood/acp-code/d7-parse/` — `parse.js` + tests for `1,2,3` → `[1,2,3]`, then red-green a failing case, then README. Same first-FAIL rule.

Q again after two desktop greens on the current set. Q1–Q5 still cap in-scope blockers. Pause still first-class.

---

## 5. Acceptance criteria

1. **A0** — Code never spawns `grok agent stdio`. Identity chrome is first-class grok-acp. VISION §5 Code-engine sentence updated to match.
2. **A1–A8** — Each has png+json+txt on DEV web and two desktop runs; JSON matches named observables.
3. **D1–D3** — Same artifacts; disk + test output match the table.
4. **Code is Code** — No journey paints Chat-with-Grok as Code empty. No Plan/File changes **as Chat chrome**. Code Plan/File changes **may** exist when grok-acp actually proposed edits.
5. **Quality pass Q** — After two consecutive desktop greens on the current set (A0–A8 + D1–D3 + any Qn), walk §3 against last green shots + one live Code session. `{SCRATCH}/quality-Q.md`: each row Pass / Blocker / Out. Blocker → **one** journey (Q1…Q5 max) + chrome test if chrome + recapture. Out/taste → list. Repeat Q until no in-scope blocker **or** Q5 is spent (then list leftovers and STOP — do not invent Q6).
6. **Stop bar** — Current set green **twice in a row on desktop**, **and** Q has no in-scope blocker, **or** the operator says pause. No KEEP series. No overlapping schedulers. One driver owns `:8788` (wrapper death ≠ down if health 200). Never a second host. Banner on desktop shots is **host :8788**. Chrome slices have a test that would have failed before the fix. Do not spawn Grok CLI for Code. Do not invent MCP/skills/subagent engines.

---

## 6. Verification plan

1. **gating (units):** Tests on **shipped** functions: Code empty is Code continuum; Code agent projection for grok-acp-first-class (not Mini-Grok CLI-missing when acp is intended); `visibleUserPrompt` hides dump; File changes / allow dock still work with acp diffs; no vendor spawn helper used on the Code path under test. `{SCRATCH}/unit-acp-code.log`.
2. **gating (host):** One host. `http://127.0.0.1:8788/api/health` 200. `{SCRATCH}/host-health.txt`. Never a second `:8788`. After `packages/acp-client` or `packages/grok-acp` change: rebuild dist, restart the **one** host.
3. **gating (spawn):** Host log / journey JSON must not contain vendor spawn (`grok.exe` + `agent stdio`) for A*/D*/Q*. If it does, that journey is FAIL even if the token appeared.
4. **gating (DEV web Code):** Mode **Code**, this repo. A0–A8 then D1–D3 then Qn. `{SCRATCH}/web-A{n}.png|json|txt` (and D/Q). Max-update-depth is FAIL.
5. **gating (Desktop Code):** Forge Dev. Same set **twice**. `{SCRATCH}/desktop-run{1,2}-A{n}.*`. Banner `:8788`. Honest `{SCRATCH}/desktop-launch.txt` if undrivable (do not fabricate pixels).
6. **gating (Q):** `{SCRATCH}/quality-Q.md`. Blocker → one journey only.
7. **evidence:** One broke/fix/re-check/shot line per slice in **this file**. Visual budget: one shot per journey per slice.

---

## 7. Non-goals

- Re-enabling vendor `grok agent stdio` for Forge Code.
- Chat C1–C10 (already a separate goal). Do not “fix Code” by switching tabs to Chat.
- Inventing MCP servers, a skills marketplace, computer use, Custom GPTs, voice.
- Growing grok-acp into a clone of Grok Build’s full tool surface “because Claude has it” — only tools that already exist (read/list/grep/write/patch/shell/delete/rename + Review) plus chrome/UX around them, unless Q names a **blocker** that is a missing **house** capability (inspect/diff/stop), not a missing **guest catalog**.
- KEEP overwrite series; second `:8788`; commit/push unless asked.
- Pixel-parity with Claude Code’s VS Code skin.

---

## 8. Assumed scope

DEV web `:5174` + one DEV host `:8788` + `desktop:dev`. Code workspace `C:\Dev\grokforge`. grok-acp tools as shipped. Review default. Playwright dogfood may grow `FORGE_CODE=1` / `FORGE_ACP=1` (click Code, do not click Chat; do not require vendor). `docs/dogfood/acp-code/` is the dogfood sandbox.

---

## 9. Implementation approach

1. **A0 first** — Host Code path always `resolveAgentSpawn("grok-acp")`. Delete or dead-code vendor acquire on Code (do not leave a silent `grok.exe` spawn). Chrome: first-class identity; tests that fail if Mini-Grok CLI-missing or vendor chip still paint when acp is the engine. Update VISION §5 one paragraph.
2. **A1–A8** — Elect from first FAIL. Prefer grok-acp server/tool fixes over shell lies.
3. **D1–D3** — Real files + tests through the UI. The agent dogfoods grok-acp by building the fixture; any product friction is the next slice.
4. **Q** — Review §3. One new journey per blocker, cap 5. Taste-only STOP.

---

## 10. Task checklist

- [x] A0: Code spawn is grok-acp only; identity chrome first-class; VISION §5 Code sentence; units; host-health.
- [x] Units for A1–A8 / D observables; `{SCRATCH}/unit-acp-code.log`.
- [x] Web A0–A8 then D1–D3; elect from first FAIL.
- [x] Desktop twice; banner `:8788`; elect from first FAIL.
- [x] Quality pass Q; `{SCRATCH}/quality-Q.md`; Q1–Q5 only for in-scope blockers.
- [x] Log a line per slice here. Stop on two consecutive desktop greens **and** Q clean, or pause.

---

## 11. Risks

- This **reverses** the guest-brain bet. Skills/MCP/subagents the TUI has will be **absent** until we show them from grok-acp (we will not fake a vendor catalog). Q must mark those **Out** unless they hide an A/D daily job.
- Live turns need grok-acp + auth. Honest failure, never a fake token.
- Desktop CDP origin `localhost:5174`. Occupied `:8788`: attach or kill the owned listener; never both.
- Pause overrides “green twice.”
- “Perfection” is **Q clean on §3**, not an unbounded KEEP diary.

---

## 12. Slice log

- **A0 Engine / broke:** Code acquired `grok.exe agent stdio` when CLI was on PATH; composer painted **Grok Code** or **Mini-Grok · Grok CLI not found**.
- **A0 Engine / fix:** `acquireCodeAgent` / `eagerResolveCodeAgent` only start grok-acp and stamp `identity: house`. Composer/run copy **Grok** (not Mini-Grok, not vendor chip). VISION §5 Code row updated. Units: stamp house; composer house; run provenance house.
- **A0 Engine / re-check:** Units stamp/composer/provenance house PASS. Live `{SCRATCH}/web-A0.*` mode Code, empty Code continuum, composer **Grok**, no Mini-Grok, banner `:8788`. Host after restart: workspace open code with **no** `grok.exe agent stdio`.
- **A1 Open / web:** PASS — `ACP-A1-OK`, Answered, Your turn, Thought not the answer. `{SCRATCH}/web-A1.*`
- **A2 Follow-up / web:** PASS — second You; token remembered. `{SCRATCH}/web-A2.*`
- **A3 Write / web:** PASS — Allow once; File changes `ACP-A3.md` Accepted; disk `ACP-A3-OK`. `{SCRATCH}/web-A3.*` Next: A4 Test.
- **A4 Test / broke:** First send ran repo-root `npm test` (120s timeout, retry, no report). Recapture after prompt: `node dist` died (`pdf-extract` `extract.js` ENOENT) → Couldn't start an agent for Code.
- **A4 Test / fix:** grok-acp prompt+run_shell copy: named-package tests via `cd <path>` / `npm test -w`; don't retry the same timed-out command. Host `resolveGrokAcp` prefers tsx `src/index.ts` over `dist/index.js` so workspace TS packages load.
- **A4 Test / re-check:** Units: prompt/tool description; spawn prefers tsx src. Live `{SCRATCH}/web-A4.*` — `cd packages\grok-acp && npm test` Failed exit 1 honest; Your turn; no vendor spawn.
- **A5 Check / web:** PASS — `cd packages/grok-acp && npm run typecheck`; Exit code 0 quoted; Answered. `{SCRATCH}/web-A5.*`
- **A6 Plan / broke:** Plan-armed turn refused writes with no plan card; unarmed turn treated step 1 as a read.
- **A6 Plan / fix:** grok-acp prompt: step 1 of plan-then-do is the named write, not a read. Dogfood disarms leftover Plan before send.
- **A6 Plan / re-check:** `{SCRATCH}/web-A6.*` — 1./2./3. markdown; File changes `ACP-A3.md` Accepted with HTML comment.
- **A7 @file / web:** PASS — You `@docs/dogfood/ACP-A3.md` not dump; answer `ACP-A3-OK`. `{SCRATCH}/web-A7.*`
- **A8 Stop / web:** PASS — Stopped by you; Retry resends; Copy on the completed retry. `{SCRATCH}/web-A8.*`
- **D1 Fixture / web:** PASS — `id.js` + `id.test.js`; File changes both; `node --test` pass 1/1. `{SCRATCH}/web-D1.*`
- **D2 Repair / broke:** First send repaired `id.js` then `npm test` in the fixture folder walked up to repo-root tests (120s timeout).
- **D2 Repair / fix:** grok-acp prompt: nested folders without a package test script use `node --test <file>`, never `npm test` that walks up.
- **D2 Repair / re-check:** `{SCRATCH}/web-D2.*` — File changes D1-BAD→D1-OK; `node --test id.test.js` Completed; passing.
- **D3 Polish / web:** PASS — README.md heading + paragraph + command fence; File changes Accepted. `{SCRATCH}/web-D3.*`
- **Desktop run1 / web→desk:** A0–A8 + D1–D3 PASS on Forge Dev CDP `:9222`, banner `host :8788`, `:8810` down. `{SCRATCH}/desktop-run1-A*|D*.*`
- **Desktop run2:** A0–A8 + D1–D3 PASS, same banner `:8788`. `{SCRATCH}/desktop-run2-A*|D*.*`
- **Quality pass Q:** `{SCRATCH}/quality-Q.md` — §3 rows 1–17 Pass. Leftovers listed. Written STOP. Operator then asked to keep looping (Wave 2).
- **E0 Live identity / broke:** Live Code run chip said **Confirming which agent ran…** when the session was already house grok-acp.
- **E0 Live identity / fix:** `projectCodeRunProvenance` inherits session `house` on a live unstamped run (never invents vendor). Unit would have failed before.
- **E0 Live identity / re-check:** Units PASS. `{SCRATCH}/desktop-run1-E0-mid.png` waiting-for-Grok, no hydrating copy; composer **Grok**. Next: E1 Plan chip.
- **E1 Plan chip / broke:** Plan-armed desktop send still did `write_file` + Allow once; `planSection`/`planDock` null. `/api/state` showed Plan engaged on the **legacy singleton**; the shell prompt is a **registry session** (`sessionFor(msg.sessionId)`). Composer POST without `sessionId` never armed the session that admitted.
- **E1 Plan chip / fix:** Host mirrors composer Plan onto the prompting session at `/api/prompt` and WS `prompt`. Shell Plan POST includes `sessionId`. Unit: `E1 composer Plan POST without sessionId still plans the shell-session prompt` (was `execute`); `E1 Plan chip POST includes the prompting sessionId`.
- **E1 Plan chip / re-check:** Host plan-mode integration 7/7; shell plan-mode 9/9. `{SCRATCH}/web-E1.*` + `{SCRATCH}/desktop-run1-E1.*` + `{SCRATCH}/desktop-run2-E1.*` — Plan 1./2./3.; dock **Accept plan** / **Keep planning**; writes `not run`; FILES —; disk `ACP-A3-OK`; banner `host :8788`. Accept leak: later shell session is execute (was plan). Next: E2 Git.
- **E2 Git / re-check:** `{SCRATCH}/web-E2.*` + `{SCRATCH}/desktop-run1-E2.*` + `{SCRATCH}/desktop-run2-E2.*` — `git status --short` + `git diff --stat` Completed; exit 0; no commit; banner `:8788`. Next: E3.
- **E3 Multi-file / re-check:** `{SCRATCH}/web-E3.*` + `{SCRATCH}/desktop-run1-E3.*` + `{SCRATCH}/desktop-run2-E3.*` — File changes `a.js`+`b.js` Accepted; disk matches; banner `:8788`. Leftover: `list_dir` ENOENT on missing `e3/` (honest, writes still create). Hierarchy clip on expanded tools (E5).
- **E4 Repair / re-check:** `{SCRATCH}/web-E4.*` + `{SCRATCH}/desktop-run1-E4.*` + `{SCRATCH}/desktop-run2-E4.*` — File changes `id.js` E4-BAD→D1-OK; `node --test` 1 pass 0 fail; banner `:8788`.
- **E5 Hierarchy / broke:** FILES jump used `scrollIntoView(start)` so File changes stuck under sticky You (`fileHeadBelowYou` false).
- **E5 Hierarchy / fix:** FILES jump nudges below You (`filesJumpNeedsStart` + `scrollDeltaBelowYou`). `.file-changes` `scroll-margin-top` uses `--run-file-stick-below`.
- **E5 Hierarchy / re-check:** Units PASS. `{SCRATCH}/desktop-run1-E5.*` — File changes below You; tools below You; Your turn not covered; banner `:8788`. Thought still can tuck under You (F2 leftover).
- **F1 Voice / fix:** Wait copy locked to **Waiting for model…**; thinking-placeholder heading not uppercase; App no longer sets `Waiting for Grok (heavy effort)…`.
- **F1 Voice / re-check:** Units PASS. `{SCRATCH}/desktop-run1-F1.*` — Your turn; no WAITING FOR GROK; Stopped by you.
- **list_dir missing / fix:** Missing folder → `{entries:[], missing:true}` succeeded, not Failed ENOENT.
- **E6 Export / re-check:** `{SCRATCH}/desktop-run1-E6.*` + export.md — You + Grok + `E6-OK`; no dump marker.
- **F0 Plan→do / broke:** Accept plan dock can become **Couldn’t record that plan decision** (Keep planning/Accept race). Composer stays **Settle the card below**. A failed Accept leaked onto the next plan dock.
- **F0 Plan→do / fix (partial):** New session / new plan requestId clears the error dock (unit). Dogfood no longer clicks Keep planning when Accept is the goal. Live Accept still does not dismiss the dock after 15s — host log shows no `/api/plan` settle. Execute-after-Accept still blocked.
- **D4 Fixture / desktop-run1:** `{SCRATCH}/desktop-run1-D4.*` — `sum.js`+`sum.test.js`; `node --test` pass; `list_dir` on missing folder **Completed** (not ENOENT). Expanded long turn still clips File changes over You (E5 not fully closed).
